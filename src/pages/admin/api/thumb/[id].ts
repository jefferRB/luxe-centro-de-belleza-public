import type { APIRoute } from 'astro';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { isPhotoId } from '../../../../lib/media-manifest.ts';
import { adminContext, handle, HttpError } from '../../../../server/http.ts';
import { thumbnail } from '../../../../server/image-intake.ts';
import { siteModel } from '../../../../server/photo-model.ts';

export const prerender = false;

/** Admin preview of a photo's current image (catalog file or upload), cached on disk. */
export const GET: APIRoute = ({ params }) => handle(async () => {
  const { store, config } = adminContext();
  const id = params.id;
  if (!isPhotoId(id)) throw new HttpError(404, 'Esa fotografía no existe.');
  const photo = Object.values(siteModel(await store.read()).sections).flat().find((candidate) => candidate.id === id);
  if (!photo) throw new HttpError(404, 'Esa fotografía no existe.');
  const source = photo.source.kind === 'upload' ? store.uploadPath(photo.source.file) : resolve(config.projectRoot, photo.source.path);
  if (photo.source.kind === 'file' && !source.startsWith(config.projectRoot + sep)) throw new HttpError(404, 'Esa fotografía no existe.');
  const cached = join(store.cacheDir, `${id}-${photo.source.kind === 'upload' ? photo.source.file.slice(0, 8) : 'original'}.webp`);
  let data: Buffer;
  try {
    data = await readFile(cached);
  } catch {
    data = await thumbnail(source);
    await mkdir(store.cacheDir, { recursive: true });
    await writeFile(cached, data);
  }
  return new Response(new Uint8Array(data), { headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=31536000, immutable' } });
});
