/** Validates and normalises an uploaded photograph. The declared name and MIME type are
 * ignored: the real format comes from the file's signature and from decoding it. The
 * stored master is a re-encoded WebP (EXIF orientation applied, metadata such as GPS
 * stripped), so no original byte from the upload is ever served. */
import sharp, { type Metadata } from 'sharp';

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const MIN_SHORT_SIDE = 600;
const MAX_INPUT_PIXELS = 60_000_000;
const MASTER_LONG_SIDE = 2400;

export class ImageRejected extends Error {}

type Signature = 'jpeg' | 'png' | 'webp' | 'avif';

/** Magic bytes of the accepted raster formats; SVG, GIF, HTML, PDF and the rest fail here. */
export function sniffFormat(bytes: Uint8Array): Signature | undefined {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes.length < 16) return undefined;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes[0] === 0x89 && ascii(1, 4) === 'PNG' && bytes[4] === 0x0d && bytes[5] === 0x0a) return 'png';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  if (ascii(4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii(8, 12))) return 'avif';
  return undefined;
}

export interface ProcessedImage { readonly data: Buffer; readonly width: number; readonly height: number }

export async function processUpload(bytes: Uint8Array): Promise<ProcessedImage> {
  if (bytes.byteLength === 0) throw new ImageRejected('El archivo está vacío.');
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new ImageRejected('La fotografía supera los 15 MB.');
  const signature = sniffFormat(bytes);
  if (!signature) throw new ImageRejected('Formato no admitido. Usá una fotografía JPG, PNG, WebP o AVIF.');
  const input = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let metadata: Metadata;
  try {
    metadata = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  } catch {
    throw new ImageRejected('No se pudo leer la fotografía: el archivo está dañado o no es una imagen.');
  }
  const format = metadata.format === 'heif' ? 'avif' : metadata.format;
  if (format !== signature) throw new ImageRejected('El contenido del archivo no coincide con su formato.');
  if ((metadata.pages ?? 1) > 1) throw new ImageRejected('Las imágenes animadas no están permitidas.');
  const swap = (metadata.orientation ?? 1) >= 5;
  const width = swap ? metadata.height : metadata.width;
  const height = swap ? metadata.width : metadata.height;
  if (!width || !height) throw new ImageRejected('No se pudieron leer las dimensiones de la fotografía.');
  if (Math.min(width, height) < MIN_SHORT_SIDE) throw new ImageRejected(`La fotografía es muy pequeña: necesita al menos ${MIN_SHORT_SIDE} px en su lado más corto.`);
  try {
    const { data, info } = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize({ width: MASTER_LONG_SIDE, height: MASTER_LONG_SIDE, fit: 'inside', withoutEnlargement: true })
      .toColorspace('srgb')
      .webp({ quality: 90, effort: 4 })
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  } catch {
    throw new ImageRejected('No se pudo procesar la fotografía. Probá con otra copia del archivo.');
  }
}

/** Small preview for the admin grid. */
export function thumbnail(source: string | Buffer, width = 360): Promise<Buffer> {
  return sharp(source, { limitInputPixels: MAX_INPUT_PIXELS }).rotate().resize({ width, height: width, fit: 'inside', withoutEnlargement: true }).webp({ quality: 72 }).toBuffer();
}
