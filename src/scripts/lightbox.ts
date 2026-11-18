/** Shared LUXE lightbox. Galleries describe photos with data-full-* attributes (see
 * components/ui/lightbox-image.ts) and call openLightbox(); they never touch the dialog. */
import { formatCounter, wrapIndex } from '../lib/showcase-state';
import { onSwipe } from './swipe';

export interface LightboxItem {
  readonly src: string;
  readonly srcset: string;
  readonly width: number;
  readonly height: number;
  readonly alt: string;
  readonly caption: string;
  /** A clip: played here with controls; `src` is then its poster. */
  readonly video?: string;
}

/** Reads a photo description from an element carrying data-full-* attributes. */
export function readLightboxItem(element: Element | null | undefined): LightboxItem | undefined {
  const data = (element as HTMLElement | null | undefined)?.dataset;
  if (!data?.fullSrc) return undefined;
  return {
    src: data.fullSrc,
    srcset: data.fullSrcset ?? '',
    width: Number(data.fullWidth) || 0,
    height: Number(data.fullHeight) || 0,
    alt: data.fullAlt ?? '',
    caption: data.fullCaption ?? '',
    ...(data.fullVideo ? { video: data.fullVideo } : {}),
  };
}

class LuxeLightbox extends HTMLElement {
  private items: readonly LightboxItem[] = [];
  private index = 0;
  private opener?: HTMLElement;
  private cleanup?: () => void;

  connectedCallback() {
    this.cleanup?.();
    const dialog = this.querySelector<HTMLDialogElement>('dialog');
    const shell = this.querySelector<HTMLElement>('[data-lightbox-shell]');
    const frame = this.querySelector<HTMLElement>('[data-lightbox-frame]');
    const close = this.querySelector<HTMLButtonElement>('[data-lightbox-close]');
    if (!dialog || !shell || !frame || !close) return;
    const controller = new AbortController();
    const { signal } = controller;
    close.addEventListener('click', () => dialog.close(), { signal });
    for (const button of this.querySelectorAll<HTMLButtonElement>('[data-lightbox-step]')) {
      button.addEventListener('click', () => this.step(Number(button.dataset.lightboxStep)), { signal });
    }
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight') { event.preventDefault(); this.step(1); }
      if (event.key === 'ArrowLeft') { event.preventDefault(); this.step(-1); }
      if (event.key === 'Tab') {
        // The modal already makes the page inert; Tab also cycles instead of leaving for the browser UI.
        const focusable = [...dialog.querySelectorAll<HTMLButtonElement>('button:not([hidden])')];
        const first = focusable[0];
        const last = focusable.at(-1);
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }, { signal });
    // A click on the dark surround (not the photo or a control) closes, like Escape.
    dialog.addEventListener('click', (event) => {
      const target = event.target as Element;
      if (target === dialog || target === shell || target === frame) dialog.close();
    }, { signal });
    onSwipe(frame, (delta) => this.step(delta), signal);
    dialog.addEventListener('close', () => {
      const opener = this.opener;
      this.opener = undefined;
      const image = this.querySelector<HTMLImageElement>('[data-lightbox-image]');
      image?.removeAttribute('src');
      image?.removeAttribute('srcset');
      this.stopVideo();
      this.dispatchEvent(new CustomEvent('lightbox:close', { bubbles: true }));
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    }, { signal });
    this.cleanup = () => {
      controller.abort();
      if (dialog.open) dialog.close();
    };
  }

  disconnectedCallback() { this.cleanup?.(); }

  show(items: readonly LightboxItem[], index: number, opener?: HTMLElement) {
    const dialog = this.querySelector<HTMLDialogElement>('dialog');
    if (!dialog || !items.length) return;
    this.items = items;
    this.opener = opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : undefined);
    this.render(wrapIndex(index, items.length), false);
    if (!dialog.open) dialog.showModal();
    this.querySelector<HTMLButtonElement>('[data-lightbox-close]')?.focus();
  }

  private step(delta: number) {
    if (this.items.length < 2) return;
    this.render(wrapIndex(this.index + delta, this.items.length), true);
  }

  /** Releases the clip entirely: no download continues once it is no longer shown. */
  private stopVideo() {
    const video = this.querySelector<HTMLVideoElement>('[data-lightbox-video]');
    if (!video) return;
    video.pause();
    if (video.hasAttribute('src')) { video.removeAttribute('src'); video.load(); }
    video.hidden = true;
  }

  private render(index: number, announce: boolean) {
    const item = this.items[index];
    const image = this.querySelector<HTMLImageElement>('[data-lightbox-image]');
    const video = this.querySelector<HTMLVideoElement>('[data-lightbox-video]');
    if (!item || !image) return;
    this.index = index;
    const count = this.items.length;
    image.alt = item.alt;
    if (item.width && item.height) { image.width = item.width; image.height = item.height; }
    image.sizes = '(min-width: 48rem) 86vw, 100vw';
    image.srcset = item.srcset;
    image.src = item.src;
    this.stopVideo();
    if (item.video && video) {
      // Silent and with its own controls; plays by itself only when motion is welcome.
      video.poster = item.src;
      video.setAttribute('aria-label', item.alt);
      video.src = item.video;
      video.hidden = false;
      image.hidden = true;
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) video.play().catch(() => { /* Controls stay available. */ });
    } else {
      image.hidden = false;
    }
    const set = (selector: string, text: string) => { const element = this.querySelector(selector); if (element) element.textContent = text; };
    set('[data-lightbox-caption]', item.caption || item.alt);
    set('[data-lightbox-counter]', count > 1 ? formatCounter(index, count) : '');
    set('[data-lightbox-status]', announce ? `${item.video ? 'Video' : 'Fotografía'} ${index + 1} de ${count}. ${item.caption || item.alt}` : '');
    for (const button of this.querySelectorAll<HTMLButtonElement>('[data-lightbox-step]')) button.hidden = count < 2;
    const shown = item.video && video ? video : image;
    if (announce && !matchMedia('(prefers-reduced-motion: reduce)').matches && typeof shown.animate === 'function') {
      shown.animate([{ opacity: 0, transform: 'scale(.985)' }, { opacity: 1, transform: 'none' }], { duration: 280, easing: 'cubic-bezier(.22, 1, .36, 1)' });
    }
  }
}

if (!customElements.get('luxe-lightbox')) customElements.define('luxe-lightbox', LuxeLightbox);

/** Opens the shared viewer. Returns false when the page has no lightbox (e.g. a module failed). */
export function openLightbox(items: readonly LightboxItem[], index: number, opener?: HTMLElement): boolean {
  const viewer = document.querySelector('luxe-lightbox');
  if (!(viewer instanceof LuxeLightbox) || !items.length) return false;
  viewer.show(items, index, opener);
  return true;
}
