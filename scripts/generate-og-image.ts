/** Renders the social preview card (public/og-image.jpg, 1200×630) shown by WhatsApp,
 * Facebook and X: the hero composition (wordmark + reception image) in brand colors.
 * Run once after changing the reception image or the brand copy: npm run og-image
 * The public repository renders it from the demo reception illustration. */
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import { receptionPhoto } from '../src/data/media-catalog.ts';

const WIDTH = 1200;
const HEIGHT = 630;
const photo = await readFile(new URL(`../${receptionPhoto.source}`, import.meta.url));
// Downscale before embedding: the photo panel is 680 px wide (×2 for a crisp render).
const photoUri = `data:image/jpeg;base64,${(await sharp(photo).resize({ width: 1360 }).jpeg({ quality: 90 }).toBuffer()).toString('base64')}`;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin: 0; box-sizing: border-box; }
  body { width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; background: #0a211b; color: #f1eadf; font-family: 'Segoe UI', Arial, sans-serif; position: relative; }
  .photo { position: absolute; inset: 0 0 0 auto; width: 680px; background: url(${photoUri}) center 78% / cover no-repeat; }
  .photo::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, #0a211b 0%, #0a211bcc 14%, #0a211b00 42%), linear-gradient(0deg, #0a211b99 0%, #0a211b00 30%); }
  .copy { position: absolute; left: 72px; top: 0; bottom: 0; width: 600px; display: flex; flex-direction: column; justify-content: center; }
  .eyebrow { font-size: 15px; letter-spacing: .24em; text-transform: uppercase; color: #c5a36a; }
  .mark { font-family: 'Bodoni MT', 'Didot', 'Times New Roman', serif; font-size: 168px; line-height: .9; letter-spacing: -.01em; margin: 22px 0 18px -6px; }
  .mark span { color: #c5a36a; }
  .sub { font-size: 16px; letter-spacing: .32em; text-transform: uppercase; }
  .rule { width: 64px; height: 1px; background: #c5a36a; margin: 34px 0 26px; }
  .tagline { font-family: 'Bodoni MT', 'Didot', 'Times New Roman', serif; font-size: 36px; line-height: 1.2; }
  .tagline em { color: #c5a36a; }
  .place { margin-top: 22px; font-size: 18px; color: #c1c6bd; }
</style></head><body>
  <div class="photo"></div>
  <div class="copy">
    <p class="eyebrow">Belleza · Estilo · Bienestar</p>
    <p class="mark">LUXE<span>.</span></p>
    <p class="sub">Centro de Belleza Familiar</p>
    <div class="rule"></div>
    <p class="tagline">Tu estilo. Tu momento. <em>Tu espacio.</em></p>
    <p class="place">Concepción, La Unión, Cartago</p>
  </div>
</body></html>`;

// Playwright's Chromium by default; OG_BROWSER_CHANNEL=msedge (or chrome) uses an installed browser.
const browser = await chromium.launch({ channel: process.env.OG_BROWSER_CHANNEL });
try {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  const png = await page.screenshot({ type: 'png' });
  // JPEG: universally supported by link-preview crawlers; kept well under WhatsApp's ~300 KB limit.
  const jpg = await sharp(png).jpeg({ quality: 84, mozjpeg: true }).toBuffer();
  await writeFile(new URL('../public/og-image.jpg', import.meta.url), jpg);
  console.log(`public/og-image.jpg written (${WIDTH}×${HEIGHT}, ${Math.round(jpg.length / 1024)} KB).`);
} finally {
  await browser.close();
}
