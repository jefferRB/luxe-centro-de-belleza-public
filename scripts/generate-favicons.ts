/** Renders public/favicon.svg into the raster icons browsers and Google still request.
 * The public repository ships a neutral demo mark (a ringed sphere), not the business logo.
 * Run once after changing the SVG: npm run favicons */
import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const publicDir = new URL('../public/', import.meta.url);
const svg = await readFile(new URL('favicon.svg', publicDir));
const png = (size: number) => sharp(svg, { density: Math.ceil((72 * size) / 64) * 2 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();

for (const [name, size] of [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512], ['favicon-48.png', 48]] as const) {
  await writeFile(new URL(name, publicDir), await png(size));
}

// ICO container with embedded PNG frames (16, 32, 48): supported by every current browser.
const frames = await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(size) })));
const header = Buffer.alloc(6 + frames.length * 16);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(frames.length, 4);
let offset = header.length;
frames.forEach(({ size, data }, index) => {
  const entry = 6 + index * 16;
  header.writeUInt8(size, entry);
  header.writeUInt8(size, entry + 1);
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(data.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += data.length;
});
await writeFile(new URL('favicon.ico', publicDir), Buffer.concat([header, ...frames.map((frame) => frame.data)]));
console.log('Favicons written to public/.');
