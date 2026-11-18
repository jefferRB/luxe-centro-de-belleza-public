/** Publishes the public site exactly as the admin does (build → checks → atomic switch),
 * for the first deploy, a code update or after restoring a manifest backup.
 *
 *   LUXE_MEDIA_DIR=/var/lib/app/media LUXE_SITE_DIR=/var/lib/app/site npm run site:publish
 */
import { resolveMediaDir } from '../src/integrations/managed-media.ts';
import { MediaStore } from '../src/server/media-store.ts';
import { Publisher } from '../src/server/publisher.ts';

const siteDir = process.env.LUXE_SITE_DIR?.trim();
if (!siteDir || !process.env.LUXE_MEDIA_DIR?.trim()) {
  console.error('Definí LUXE_MEDIA_DIR y LUXE_SITE_DIR.');
  process.exit(1);
}
const projectRoot = process.env.LUXE_PROJECT_ROOT?.trim() || process.cwd();
const store = new MediaStore(resolveMediaDir(projectRoot));
const publisher = new Publisher({ projectRoot, mediaDir: store.dir, siteDir, currentRevision: async () => (await store.read()).revision, log: console.log });
await publisher.request();
const status = await publisher.describe();
if (status.state !== 'idle') {
  console.error(status.error ?? 'No se pudo publicar.');
  process.exit(1);
}
console.log(`Sitio publicado en ${siteDir}/current (revisión ${status.publishedRevision}).`);
