/** Persistent store in LUXE_MEDIA_DIR:
 *   manifest.json        the admin's changes (atomic writes: temp file + rename)
 *   uploads/<uuid>.webp  normalised photos, written once and never overwritten
 *   backups/             the previous manifest before every change (last 200)
 *   cache/               admin thumbnails (disposable)
 * Uploads are immutable, so a failed replacement never touches the photo it replaces;
 * backing up the folder (tar) is a complete backup of everything the admin changed. */
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile, open } from 'node:fs/promises';
import { join } from 'node:path';
import { emptyManifest, isUploadFile, parseManifest, type MediaManifest, type UploadRef } from '../lib/media-manifest.ts';
import { OperationError } from './photo-model.ts';
import type { ProcessedImage } from './image-intake.ts';

const BACKUPS_KEPT = 200;

export class MediaStore {
  private queue: Promise<unknown> = Promise.resolve();

  readonly dir: string;

  constructor(dir: string) { this.dir = dir; }

  get manifestFile() { return join(this.dir, 'manifest.json'); }
  get uploadsDir() { return join(this.dir, 'uploads'); }
  get backupsDir() { return join(this.dir, 'backups'); }
  get cacheDir() { return join(this.dir, 'cache'); }

  uploadPath(file: string): string {
    if (!isUploadFile(file)) throw new OperationError('Archivo inválido.', 400);
    return join(this.uploadsDir, file);
  }

  async read(): Promise<MediaManifest> {
    try {
      return parseManifest(JSON.parse(await readFile(this.manifestFile, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyManifest();
      throw error;
    }
  }

  /** Writes a processed photo under a fresh server-generated name. */
  async saveUpload(image: ProcessedImage): Promise<UploadRef> {
    await mkdir(this.uploadsDir, { recursive: true });
    const file = `${randomUUID()}.webp`;
    const target = this.uploadPath(file);
    const temp = `${target}.${process.pid}.tmp`;
    await writeDurable(temp, image.data);
    await rename(temp, target);
    return { file, width: image.width, height: image.height };
  }

  /** Serialised read-modify-write. `expectedRevision` rejects edits made from a stale view. */
  update(expectedRevision: number | undefined, change: (current: MediaManifest) => MediaManifest | Promise<MediaManifest>): Promise<MediaManifest> {
    const run = async () => {
      const current = await this.read();
      if (expectedRevision !== undefined && expectedRevision !== current.revision) {
        throw new OperationError('Hubo otro cambio mientras editabas. Recargá el panel para ver la versión actual.', 409);
      }
      const next = await change(current);
      await this.backup(current);
      await mkdir(this.dir, { recursive: true });
      const temp = `${this.manifestFile}.${process.pid}.tmp`;
      await writeDurable(temp, `${JSON.stringify(next, null, 2)}\n`);
      await rename(temp, this.manifestFile);
      return next;
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async backup(current: MediaManifest) {
    if (current.revision === 0 && current.updatedAt === null) return;
    await mkdir(this.backupsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await writeFile(join(this.backupsDir, `manifest-r${String(current.revision).padStart(6, '0')}-${stamp}.json`), JSON.stringify(current, null, 2), { flag: 'wx' });
    const backups = (await readdir(this.backupsDir)).filter((name) => name.startsWith('manifest-')).sort();
    await Promise.all(backups.slice(0, Math.max(0, backups.length - BACKUPS_KEPT)).map((name) => rm(join(this.backupsDir, name), { force: true })));
  }
}

async function writeDurable(path: string, data: string | Buffer) {
  const handle = await open(path, 'wx');
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
