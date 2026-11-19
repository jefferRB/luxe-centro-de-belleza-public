/** Leak guard for the public repository: every image or video in the project must be either a
 * generated demo file recorded (by hash) in src/assets/demo/manifest.json, a README capture of
 * the local demo build recorded in showcase/manifest.json, a production screenshot or recording
 * recorded in showcase/production.json (publication gated by scripts/verify-publication.ts), or
 * one of the generated site icons. A client photo copied in by mistake fails here. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { mediaCatalog, receptionPhoto, videoCatalog } from '../src/data/media-catalog.ts';

const MEDIA = /\.(png|jpe?g|webp|avif|gif|tiff?|heic|mp4|mov|webm|m4v|ico)$/i;
const ARCHIVES = /\.(zip|rar|7z|tar|gz|tgz|bz2)$/i;
const IGNORED = new Set(['node_modules', '.git', 'dist', '.astro', '.luxe-media', '.luxe-build', 'test-results', 'playwright-report']);
const PUBLIC_ICONS = ['apple-touch-icon.png', 'favicon-48.png', 'favicon.ico', 'icon-192.png', 'icon-512.png', 'og-image.jpg'];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (IGNORED.has(name)) return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [relative('.', path).replaceAll('\\', '/')];
  });
}

const files = walk('.');
type Manifest = { files: Record<string, { sha256: string }> };
const manifest = JSON.parse(readFileSync('src/assets/demo/manifest.json', 'utf8')) as Manifest;
const showcase = JSON.parse(readFileSync('showcase/manifest.json', 'utf8')) as Manifest & { source: string };
const production = JSON.parse(readFileSync('showcase/production.json', 'utf8')) as Manifest;
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

test('every media file is a recorded demo asset, a recorded showcase or production capture, or a generated site icon', () => {
  const unexpected = files.filter((file) => MEDIA.test(file))
    .filter((file) => !(file.startsWith('src/assets/demo/') && manifest.files[file.slice('src/assets/demo/'.length)]))
    .filter((file) => !(file.startsWith('showcase/production/') && production.files[file.slice('showcase/production/'.length)]))
    .filter((file) => !(file.startsWith('showcase/') && !file.startsWith('showcase/production/') && showcase.files[file.slice('showcase/'.length)]))
    .filter((file) => !PUBLIC_ICONS.some((icon) => file === `public/${icon}`));
  assert.deepEqual(unexpected, []);
});

test('production screenshots match their recorded hashes and never feed the application', () => {
  // The folder is git-ignored until authorization is recorded, so a fresh clone may not have it.
  for (const [file, { sha256 }] of Object.entries(production.files)) {
    const path = `showcase/production/${file}`;
    if (existsSync(path)) assert.equal(sha(path), sha256, path);
  }
  const sources = files.filter((file) => /^(src|public)\//.test(file) && /\.(ts|astro|mjs|css|json|svg|webmanifest)$/.test(file));
  assert.deepEqual(sources.filter((file) => readFileSync(file, 'utf8').includes('showcase/production')), []);
});

test('demo files match the hashes written by scripts/generate-demo-media.ts', () => {
  for (const [file, { sha256 }] of Object.entries(manifest.files)) assert.equal(sha(`src/assets/demo/${file}`), sha256, file);
});

test('showcase captures match the hashes written by scripts/capture-showcase.ts (local demo build only)', () => {
  assert.match(showcase.source, /demo build/i);
  for (const [file, { sha256 }] of Object.entries(showcase.files)) assert.equal(sha(`showcase/${file}`), sha256, file);
});

test('every catalog source, poster and thumbnail is a recorded demo file', () => {
  const sources = [...mediaCatalog.flatMap((item) => [item.source, item.thumbSource ?? []].flat()), ...videoCatalog.flatMap((video) => [video.source, video.poster]), receptionPhoto.source];
  for (const source of sources) assert.ok(manifest.files[source.replace('src/assets/demo/', '')], source);
});

test('no archives, environment files or private document folders in the repository', () => {
  assert.deepEqual(files.filter((file) => ARCHIVES.test(file)), []);
  // `.env.admin` is the local, git-ignored credential file written by `npm run admin:password -- --local`.
  assert.deepEqual(files.filter((file) => /(^|\/)\.env/.test(file) && !['.env.example', '.env.admin'].includes(file)), []);
  const ignored = readFileSync('.gitignore', 'utf8').split(/\r?\n/);
  for (const rule of ['.env.*', '!.env.example', '.luxe-media/', '.luxe-site/', 'dist/', '*.zip', '*.tar.gz']) assert.ok(ignored.includes(rule), `.gitignore must contain ${rule}`);
  assert.deepEqual(files.filter((file) => /^(Documentos|originales-sin-modificar|design-references|fotos|videos|posters)\//.test(file)), []);
});
