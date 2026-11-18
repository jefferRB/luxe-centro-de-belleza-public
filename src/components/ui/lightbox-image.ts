import type { ImageMetadata } from 'astro';
import { getImage } from 'astro:assets';

/** Data attributes that let any gallery hand a photo (or a clip, with its poster) to the
 * shared lightbox. The large variants are generated at build time but only requested when
 * the viewer opens; a clip is only requested when the viewer plays it. */
export async function lightboxAttributes(image: ImageMetadata, alt: string, caption: string, video?: string): Promise<Record<string, string>> {
  const widths = [...new Set([960, 1440, 2000].filter((width) => width < image.width).concat(Math.min(2000, image.width)))];
  const large = await getImage({ src: image, widths, format: 'webp', quality: 82 });
  return {
    'data-full-src': large.src,
    'data-full-srcset': large.srcSet.attribute,
    'data-full-width': String(image.width),
    'data-full-height': String(image.height),
    'data-full-alt': alt,
    'data-full-caption': caption,
    ...(video ? { 'data-full-video': video } : {}),
  };
}
