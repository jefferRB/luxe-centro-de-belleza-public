/** Standalone "ampliar" buttons (e.g. the facade): each opens the lightbox with the photo
 * described by its closest [data-full-src] element. Buttons stay hidden without JS. */
import { openLightbox, readLightboxItem } from './lightbox';

for (const trigger of document.querySelectorAll<HTMLButtonElement>('[data-zoom-trigger]')) {
  const item = readLightboxItem(trigger.closest('[data-full-src]'));
  if (!item) continue;
  trigger.hidden = false;
  trigger.addEventListener('click', () => openLightbox([item], 0, trigger));
}
