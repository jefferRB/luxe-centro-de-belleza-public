/** Publishes the admin's changes by rebuilding the static site, so the public page stays
 * plain HTML served by nginx (no runtime rendering, same SEO and performance).
 *
 *   1. `astro build` into a staging folder (LUXE_MEDIA_DIR is read at build time)
 *   2. the deployment checks (scripts/verify-build.ts) on that output
 *   3. move it to <siteDir>/releases/<id> and switch the `current` link atomically
 *
 * Any failure leaves the previous release online. Requests while a build runs are merged
 * into one follow-up build. Without LUXE_SITE_DIR (local work) nothing is built: the dev
 * server already shows each change on reload. */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cp, mkdir, readdir, readlink, rename, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';

export type PublishState = 'idle' | 'building' | 'error' | 'preview';

export interface PublishStatus {
  readonly state: PublishState;
  /** Manifest revision the public site shows (null: not published from the admin yet). */
  readonly publishedRevision: number | null;
  readonly publishedAt: string | null;
  readonly building: number | null;
  readonly error: string | null;
}

const BUILD_TIMEOUT_MS = 10 * 60 * 1000;
const RELEASES_KEPT = 3;

export interface PublisherOptions {
  readonly projectRoot: string;
  readonly mediaDir: string;
  readonly siteDir?: string;
  /** Reads the manifest revision a build is about to include. */
  readonly currentRevision: () => Promise<number>;
  readonly log?: (message: string) => void;
}

export class Publisher {
  private status: PublishStatus;
  private running: Promise<void> | null = null;
  private again = false;

  private readonly options: PublisherOptions;

  constructor(options: PublisherOptions) {
    this.options = options;
    this.status = { state: options.siteDir ? 'idle' : 'preview', publishedRevision: null, publishedAt: null, building: null, error: null };
  }

  /** Current status; after a restart, the published revision is read back from the
   * release that `current` points to (its name ends in -r<revision>). */
  async describe(): Promise<PublishStatus> {
    if (this.status.publishedRevision === null && this.options.siteDir) {
      try {
        const target = await readlink(join(this.options.siteDir, 'current'));
        const match = /-r(\d+)[\\/]?$/.exec(target);
        if (match) this.status = { ...this.status, publishedRevision: Number(match[1]) };
      } catch { /* not published from the admin yet */ }
    }
    return this.status;
  }

  /** Starts (or queues) a publish; resolves when the site shows the latest saved state. */
  request(): Promise<void> {
    if (!this.options.siteDir) return Promise.resolve();
    if (this.running) { this.again = true; return this.running; }
    this.status = { ...this.status, state: 'building', error: null };
    this.running = this.loop().finally(() => { this.running = null; });
    return this.running;
  }

  private async loop() {
    do {
      this.again = false;
      await this.publishOnce();
    } while (this.again);
  }

  private async publishOnce() {
    const siteDir = this.options.siteDir!;
    const revision = await this.options.currentRevision();
    this.status = { ...this.status, state: 'building', building: revision, error: null };
    const id = `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-r${revision}`;
    // Built inside the project: prerendering imports its chunks, which must resolve node_modules.
    const staging = join(this.options.projectRoot, '.luxe-build', id);
    try {
      await mkdir(join(siteDir, 'releases'), { recursive: true });
      const env = { ...process.env, LUXE_MEDIA_DIR: this.options.mediaDir };
      await this.run([astroBin(this.options.projectRoot), 'build', '--outDir', staging], env, 'build');
      await this.run([join(this.options.projectRoot, 'scripts', 'verify-build.ts')], { ...env, LUXE_VERIFY_DIR: join(staging, 'client') }, 'verify');
      const release = join(siteDir, 'releases', id);
      await moveDir(join(staging, 'client'), release);
      await switchCurrent(siteDir, release);
      await this.prune(siteDir, release);
      // With a newer save waiting, the panel keeps showing "publishing" until it is live too.
      this.status = { state: this.again ? 'building' : 'idle', publishedRevision: revision, publishedAt: new Date().toISOString(), building: null, error: null };
      this.options.log?.(`Published revision ${revision} (${id})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.status = { ...this.status, state: this.again ? 'building' : 'error', building: null, error: message };
      this.options.log?.(`Publish failed for revision ${revision}: ${message}`);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  private run(args: string[], env: NodeJS.ProcessEnv, step: string): Promise<void> {
    return new Promise((done, fail) => {
      const child = spawn(process.execPath, args, { cwd: this.options.projectRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      const keep = (chunk: Buffer) => { output = (output + chunk.toString()).slice(-4000); };
      child.stdout.on('data', keep);
      child.stderr.on('data', keep);
      const timer = setTimeout(() => child.kill('SIGKILL'), BUILD_TIMEOUT_MS);
      child.on('error', (error) => { clearTimeout(timer); fail(error); });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) done();
        else {
          this.options.log?.(`${step} output:\n${output}`);
          fail(new Error(step === 'build' ? 'No se pudo generar el sitio. La versión anterior sigue publicada.' : 'La verificación del sitio falló. La versión anterior sigue publicada.'));
        }
      });
    });
  }

  private async prune(siteDir: string, keep: string) {
    const releases = (await readdir(join(siteDir, 'releases'))).sort();
    const old = releases.slice(0, Math.max(0, releases.length - RELEASES_KEPT)).map((name) => join(siteDir, 'releases', name)).filter((path) => path !== keep);
    await Promise.all(old.map((path) => rm(path, { recursive: true, force: true })));
  }
}

function astroBin(root: string): string {
  const pkg = JSON.parse(readFileSync(join(root, 'node_modules', 'astro', 'package.json'), 'utf8')) as { bin: Record<string, string> };
  return join(root, 'node_modules', 'astro', pkg.bin.astro!);
}

/** Rename when both folders share a disk; otherwise copy to a temporary name and rename,
 * so a release folder is never seen half-written. */
async function moveDir(from: string, to: string) {
  try {
    await rename(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    const temp = `${to}.partial`;
    await cp(from, temp, { recursive: true });
    await rename(temp, to);
  }
}

/** Points <siteDir>/current at the new release: a new link renamed over the old one, which
 * is atomic on Linux, so nginx never sees a half-published site. */
async function switchCurrent(siteDir: string, release: string) {
  const link = join(siteDir, 'current');
  const temp = join(siteDir, `.current-${process.pid}-${Date.now()}`);
  await symlink(release, temp, process.platform === 'win32' ? 'junction' : 'dir');
  try {
    await rename(temp, link);
  } catch (error) {
    // Windows cannot rename over an existing junction: replace it (local testing only).
    if (process.platform !== 'win32') throw error;
    await rm(link, { recursive: false, force: true });
    await rename(temp, link);
  }
}
