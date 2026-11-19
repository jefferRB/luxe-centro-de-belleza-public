/** Captures the README showcase (showcase/*.webp) from the local demo build — never from the
 * production site, so only the generated demonstration media can appear in the images.
 *
 *   npm run build && npm run showcase
 *
 * Serves dist/client on a random loopback port, drives Chromium with Playwright and writes
 * optimised WebP stills and short animated WebP loops. Set SHOWCASE_BROWSER_CHANNEL=chrome
 * to use an installed Chrome instead of Playwright's Chromium. */
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import sharp from 'sharp';

const ROOT = resolve('dist', 'client');
const OUT = resolve('showcase');
const MIME: Record<string, string> = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.webp': 'image/webp', '.avif': 'image/avif', '.jpg': 'image/jpeg', '.png': 'image/png', '.ico': 'image/x-icon', '.webm': 'video/webm',
  '.xml': 'application/xml', '.txt': 'text/plain', '.webmanifest': 'application/manifest+json',
};

function serve(): Promise<{ server: Server; origin: string }> {
  const server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    const file = resolve(ROOT, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(ROOT + sep)) { response.writeHead(403).end(); return; }
    try {
      response.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' }).end(await readFile(file));
    } catch { response.writeHead(404).end(); }
  });
  return new Promise((done) => server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    done({ server, origin: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}` });
  }));
}

const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Hashes of every capture: tests/media-policy.test.ts accepts only these files in showcase/. */
const written: Record<string, { sha256: string; bytes: number }> = {};

async function save(name: string, data: Buffer, note: string) {
  await writeFile(resolve(OUT, name), data);
  written[name] = { sha256: createHash('sha256').update(data).digest('hex'), bytes: data.length };
  console.log(`  showcase/${name} (${note}${Math.round(data.length / 1024)} KB)`);
}

async function still(png: Buffer, name: string, width?: number, quality = 82) {
  const image = width ? sharp(png).resize({ width }) : sharp(png);
  await save(name, await image.webp({ quality, effort: 6 }).toBuffer(), '');
}

async function loop(frames: Buffer[], name: string, width: number, delay: number) {
  const resized = await Promise.all(frames.map((frame) => sharp(frame).resize({ width }).png().toBuffer()));
  const data = await sharp(resized, { join: { animated: true } }).webp({ quality: 62, effort: 6, loop: 0, delay: resized.map(() => delay) }).toBuffer();
  await save(name, data, `${frames.length} frames, `);
}

/** Scrolls a section to the top of the viewport, as the header links do, and lets it settle. */
async function scene(page: Page, id: string, settle = 1800) {
  await page.evaluate((target) => document.getElementById(target)!.scrollIntoView({ block: 'start' }), id);
  await pause(settle);
}

async function open(page: Page, origin: string) {
  await page.addInitScript(() => sessionStorage.setItem('luxe:intro:seen:v1', '1'));
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.locator('luxe-specialties[data-ready]').waitFor();
  await page.evaluate(() => document.fonts.ready);
}

/** The cover: the desktop page with the phone layout in front, on the site's own palette. */
async function cover(desktop: Buffer, mobile: Buffer) {
  const W = 1600;
  const H = 900;
  const background = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs><radialGradient id="g" cx="30%" cy="20%" r="90%"><stop offset="0" stop-color="#1d5a49"/><stop offset="1" stop-color="#0a211b"/></radialGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#g)"/>
    <ellipse cx="${W / 2}" cy="${H * .56}" rx="${W * .48}" ry="${H * .17}" fill="none" stroke="#c5a36a" stroke-opacity=".35" stroke-width="2" transform="rotate(-6 ${W / 2} ${H / 2})"/>
    <text x="70" y="${H - 34}" font-family="Segoe UI, Arial, sans-serif" font-size="17" letter-spacing="3" fill="#e5c891">PUBLIC DEMO BUILD · ILLUSTRATIONS STAND IN FOR THE STUDIO'S PHOTOGRAPHY</text></svg>`);
  const frame = async (shot: Buffer, width: number, radius: number) => {
    const resized = await sharp(shot).resize({ width }).png().toBuffer();
    const { height = 0 } = await sharp(resized).metadata();
    const mask = Buffer.from(`<svg width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="${radius}" fill="#fff"/></svg>`);
    const rounded = await sharp(resized).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
    const border = Buffer.from(`<svg width="${width}" height="${height}"><rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="${radius}" fill="none" stroke="#c5a36a" stroke-opacity=".7" stroke-width="2"/></svg>`);
    return { image: await sharp(rounded).composite([{ input: border }]).png().toBuffer(), height };
  };
  const big = await frame(desktop, 1180, 14);
  const phone = await frame(mobile, 300, 28);
  const shadow = (w: number, h: number, r: number) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w + 80}" height="${h + 80}"><defs><filter id="b"><feGaussianBlur stdDeviation="18"/></filter></defs><rect x="40" y="52" width="${w}" height="${h}" rx="${r}" fill="#000" fill-opacity=".55" filter="url(#b)"/></svg>`);
  const png = await sharp(background).composite([
    { input: shadow(1180, big.height, 14), left: 70 - 40, top: 70 - 40 },
    { input: big.image, left: 70, top: 70 },
    { input: shadow(300, phone.height, 28), left: W - 70 - 300 - 40, top: H - 50 - phone.height - 40 },
    { input: phone.image, left: W - 70 - 300, top: H - 50 - phone.height },
  ]).png().toBuffer();
  await still(png, 'cover.webp', undefined, 84);
}

await mkdir(OUT, { recursive: true });
const { server, origin } = await serve();
const browser = await chromium.launch({ channel: process.env.SHOWCASE_BROWSER_CHANNEL });
console.log(`Capturing the demo build from ${origin}`);
try {
  // ---------------------------------------------------------------- desktop
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'es-CR', reducedMotion: 'no-preference' });
  await open(desktop, origin);
  await pause(1200);
  // The README presents the production site (showcase/production/); the demo captures below
  // only document what a clone shows, and the space views that have no production recording.
  const hero = await desktop.screenshot();

  await scene(desktop, 'espacio', 2600);

  // Orbital loop: the crown turns to the next views, the portal follows.
  const orbit = (await desktop.locator('[data-tour-orbit]').boundingBox())!;
  const orbitClip = { x: orbit.x - 30, y: Math.max(0, orbit.y - 20), width: orbit.width + 60, height: Math.min(900 - Math.max(0, orbit.y - 20), orbit.height + 40) };
  const orbitFrames: Buffer[] = [];
  for (let turn = 0; turn < 3; turn++) {
    await desktop.getByRole('button', { name: 'Ambiente siguiente' }).click();
    for (let step = 0; step < 12; step++) { orbitFrames.push(await desktop.screenshot({ clip: orbitClip })); await pause(45); }
    for (let step = 0; step < 4; step++) { orbitFrames.push(await desktop.screenshot({ clip: orbitClip })); await pause(120); }
  }
  await loop(orbitFrames, 'space-orbit.webp', 600, 70);

  // «Explorar en 3D»: the camera leaves the rest pose; a drag orbits around the rings.
  await desktop.getByRole('button', { name: 'Ambiente anterior' }).click();
  await pause(900);
  await desktop.getByRole('button', { name: /Explorar en 3D/ }).click();
  await pause(1600);
  await desktop.mouse.move(orbit.x + orbit.width * .7, orbit.y + orbit.height * .45);
  await desktop.mouse.down();
  await desktop.mouse.move(orbit.x + orbit.width * .45, orbit.y + orbit.height * .38, { steps: 18 });
  await pause(250);
  await desktop.mouse.up();
  await pause(1400);
  await still(await desktop.screenshot(), 'space-3d.webp', 1440);
  await desktop.close();

  // ---------------------------------------------------------------- mobile
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'es-CR', reducedMotion: 'no-preference' });
  await open(mobile, origin);
  await pause(1200);
  const heroMobile = await mobile.screenshot();
  const strip: Buffer[] = [];
  for (const id of ['servicios', 'trabajos', 'espacio']) { await scene(mobile, id, 2200); strip.push(await sharp(await mobile.screenshot()).resize({ width: 390 }).png().toBuffer()); }
  const responsive = await sharp(strip, { join: { across: 3, shim: 24, background: '#0a211b' } }).png().toBuffer();
  await still(responsive, 'responsive-mobile.webp', 1200);
  await mobile.close();

  await cover(hero, heroMobile);
} finally {
  await browser.close();
  server.close();
}
await writeFile(resolve(OUT, 'manifest.json'), `${JSON.stringify({
  generator: 'scripts/capture-showcase.ts',
  source: 'Local demo build (dist/client) with the generated demonstration media; never the production site.',
  files: Object.fromEntries(Object.entries(written).sort(([a], [b]) => a.localeCompare(b))),
}, null, 2)}\n`);
console.log('Showcase updated (showcase/manifest.json).');
