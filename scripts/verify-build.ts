import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { outboundAllowlist, publicLinks } from '../src/data/links.ts';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mediaCatalog, canUseMedia, videoCatalog, canUseVideo, isPublishable, receptionPhoto, showsDemoMedia } from '../src/data/media-catalog.ts';
import { activeUploads, emptyManifest, HERO_ID, parseManifest } from '../src/lib/media-manifest.ts';
import { resolveMediaDir } from '../src/integrations/managed-media.ts';

/** Deployment guard: publishable media must ship; anything else must remain absent.
 * Checks the public (static) output: dist/client, or LUXE_VERIFY_DIR when the admin publishes. */
const root = process.env.LUXE_VERIFY_DIR ? pathToFileURL(join(process.env.LUXE_VERIFY_DIR, '/')) : new URL('../dist/client/', import.meta.url);
const files = await readdir(root, { recursive: true });
const html = await readFile(new URL('index.html', root), 'utf8');
const manifestFile = join(resolveMediaDir(process.cwd()), 'manifest.json');
const manifest = existsSync(manifestFile) ? parseManifest(JSON.parse(await readFile(manifestFile, 'utf8'))) : emptyManifest();

// SEO: an indexable public page on the canonical domain, with icons, sitemap and robots.
const ORIGIN = 'https://www.luxecentrobelleza.com/';
assert.ok(!/noindex/.test(html), 'The public page must be indexable');
assert.ok(html.includes(`<link rel="canonical" href="${ORIGIN}">`), 'Missing canonical URL');
assert.ok(html.includes(`<meta property="og:image" content="${ORIGIN}og-image.jpg">`), 'Missing social image');
for (const tag of ['og:title', 'og:description', 'og:image', 'og:url', 'og:type', 'twitter:card', 'twitter:image']) assert.equal(html.split(`"${tag}"`).length - 1, 1, `Expected exactly one ${tag}`);
for (const file of ['og-image.jpg', 'favicon.ico', 'favicon.svg', 'apple-touch-icon.png', 'site.webmanifest', 'robots.txt', 'sitemap.xml']) assert.ok(files.includes(file), `Missing ${file}`);
assert.ok((await readFile(new URL('robots.txt', root), 'utf8')).includes(`Sitemap: ${ORIGIN}sitemap.xml`), 'robots.txt must point to the sitemap');
assert.ok((await readFile(new URL('sitemap.xml', root), 'utf8')).includes(`<loc>${ORIGIN}</loc>`), 'Sitemap must list the home page');
assert.ok(!files.some((file) => /^admin(?:[\\/]|\.html$)/.test(file)), 'The admin must never be published as static files');
assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
// Crawlers read the raw HTML: brand and location must survive as plain text.
const textOf = (fragment: string) => fragment.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
assert.match(html, /<title>LUXE Centro de Belleza \| [^<]*Concepción<\/title>/, 'Title must carry the brand and Concepción');
assert.equal(textOf(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)![1]!), 'Bienvenidos a LUXE Centro de Belleza', 'H1 text must read as a phrase');
assert.ok(html.includes(`"@type":"WebSite"`) && html.includes(`"@type":"BeautySalon"`), 'Missing WebSite or BeautySalon structured data');
assert.ok(html.includes('<link rel="icon" href="/icon-192.png" type="image/png" sizes="192x192">') && files.includes('icon-192.png'), 'Missing PNG favicon for Google');
assert.ok(!/hreflang|name="keywords"/.test(html), 'No hreflang (single language) and no meta keywords');
for (const id of ['servicios', 'trabajos', 'espacio', 'ubicacion']) assert.ok(html.includes(`id="${id}"`), `Missing section: ${id}`);

// Fase 3.2: outbound links are allowed only when they match the confirmed configuration exactly.
const hrefs = [...html.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)].map((match) => match[1]!.replaceAll('&amp;', '&'));
for (const href of hrefs) {
  if (href.startsWith('#') || href === '/') continue;
  assert.ok(outboundAllowlist.includes(href), `Outbound link outside the confirmed allowlist: ${href}`);
}
assert.ok(!/dragocr\.com\/(?:fidelidad|opinar)\b/.test(html), 'Unconfirmed Drago modules must not ship');
for (const match of html.matchAll(/https?:\/\/(?:www\.)?dragocr\.com[^"'\s<)]*/g)) assert.equal(match[0], publicLinks.booking, 'Only the confirmed booking URL may ship');
if (publicLinks.booking) assert.ok(hrefs.filter((href) => href === publicLinks.booking).length >= 3, 'Booking must be reachable from header, sections and footer');
for (const tag of html.match(/<a\b[^>]*target="_blank"[^>]*>/g) ?? []) assert.match(tag, /rel="noopener noreferrer"/, `Unsafe new-tab link: ${tag}`);

if (!mediaCatalog.some((item) => canUseMedia(item, false))) {
  assert.match(html, /data-showcase-empty/, 'Production must expose the elegant empty showcase state');
  assert.ok(!/data-showcase-item|role="tablist"|data-step=/.test(html), 'No showcase works or controls without approved images');
}
// Publication policy (src/data/media-catalog.ts): nothing below 'approved' or 'demo' may ship.
const restrictedNames = [...mediaCatalog.filter((item) => !canUseMedia(item, false)), ...videoCatalog.filter((item) => !canUseVideo(item, false))]
  .map((item) => item.source.split('/').at(-1)!.split('.')[0]!);
for (const file of files) {
  assert.ok(!restrictedNames.some((name) => file.includes(name)), `Restricted filename: ${file}`);
  if (/\.(html|js|css|json|map)$/.test(file)) {
    const content = await readFile(new URL(file.replaceAll('\\', '/'), root), 'utf8');
    assert.ok(!restrictedNames.some((name) => content.includes(name)), `Restricted asset reference in ${file}`);
    assert.ok(!/\/src\/server\/|LUXE_ADMIN_|PASSWORD_HASH/.test(content), `Server-only code or admin configuration in ${file}`);
  }
}
const shipped = [...mediaCatalog.filter((item) => canUseMedia(item, false)), ...videoCatalog.filter((item) => canUseVideo(item, false))];
for (const item of shipped) assert.ok(isPublishable(item.permission), `Media shipped without approval or demo provenance: ${item.id}`);
if (showsDemoMedia([...shipped, receptionPhoto])) assert.match(html, /data-demo-media/, 'Demo media must be labelled as illustrative on the page');
const shippedText = (await Promise.all(files.filter((file) => /\.(html|js|css)$/.test(file)).map((file) => readFile(new URL(file.replaceAll('\\', '/'), root), 'utf8')))).join('\n');
// Catalog photos the admin retired or replaced are no longer expected; their uploads are.
const changed = (id: string) => Boolean(manifest.edits[id]?.removed || manifest.edits[id]?.replacement);
for (const item of [...mediaCatalog.filter((item) => canUseMedia(item, false) && !changed(item.id)), ...videoCatalog.filter((item) => canUseVideo(item, false))]) {
  const stem = item.source.split('/').at(-1)!.replace(/\.[^.]+$/, '');
  assert.ok(files.some((file) => file.includes(stem)), `Selected media missing from dist: ${item.id}`);
  assert.ok(shippedText.includes(stem), `Selected media not referenced by the site: ${item.id}`);
}
assert.ok(!/@fs\/|localhost:\d+|127\.0\.0\.1:\d+/.test(shippedText), 'Development URL found in production');
for (const upload of activeUploads(manifest)) assert.ok(files.some((file) => file.includes(upload.file.replace('.webp', ''))), `Managed upload missing from dist: ${upload.file}`);
const heroStem = receptionPhoto.source.split('/').at(-1)!.replace(/\.[^.]+$/, '');
if (!changed(HERO_ID) && isPublishable(receptionPhoto.permission)) assert.ok(files.some((file) => file.includes(heroStem)), 'Reception image missing');
console.log('Build checks passed: publishable media included, restricted media absent, links verified.');
