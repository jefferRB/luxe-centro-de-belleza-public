/** The interior view of «Entrar a LUXE»: once the camera reaches the plane of the photo,
 * the real photograph takes over in 2D, whole and in its own proportion (no invented
 * architecture, no deformation). It starts exactly where the portal's photo is on screen
 * and settles into the view; leaving runs the same movement backwards.
 *
 * A modal <dialog>: focus moves inside and returns to the opener, Escape leaves (through
 * the same reverse transition), and nothing global is locked: the page cannot scroll behind
 * it only while it is open, through listeners on the dialog itself. */
import type { LightboxItem } from './lightbox';

export interface InteriorView {
  readonly item: LightboxItem;
  readonly area: string;
  readonly title: string;
  readonly description: string;
  /** Tiny blurred echo of the photo, as a CSS image value (the portal's backdrop). */
  readonly backdrop: string;
  /** The photo already decoded in the portal: shown at once, under the large one. */
  readonly preview: string;
}

export interface SpaceInteriorOptions {
  /** Escape or «Volver al mundo LUXE»: the owner runs the way back, then calls close(). */
  readonly onRequestClose: () => void;
  /** The browser closed the dialog by itself (e.g. a forced Escape). */
  readonly onDismissed: () => void;
  readonly onZoom: (opener: HTMLElement) => void;
}

const SETTLE = 'cubic-bezier(.22, 1, .36, 1)';
const GLIDE = 'cubic-bezier(.65, 0, .35, 1)';

export class SpaceInterior {
  private readonly dialog: HTMLDialogElement;
  private readonly controller = new AbortController();
  private readonly photo: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly preview: HTMLImageElement;
  private readonly full: HTMLImageElement;
  private readonly background: HTMLElement;
  private readonly info: HTMLElement;
  private readonly back: HTMLButtonElement;
  private aspect = 1;
  private closing = false;
  private preloaded = '';
  /** Where the dialog lived in the section (it is lifted to <body> while connected). */
  private readonly home: Comment;
  private running: Animation[] = [];

  static from(dialog: HTMLDialogElement | null, options: SpaceInteriorOptions): SpaceInterior | undefined {
    if (!dialog || typeof dialog.showModal !== 'function') return undefined;
    const need = ['[data-interior-photo]', '[data-interior-stage]', '[data-interior-preview]', '[data-interior-full]', '[data-interior-bg]', '[data-interior-info]', '[data-interior-back]'];
    return need.every((selector) => dialog.querySelector(selector)) ? new SpaceInterior(dialog, options) : undefined;
  }

  private constructor(dialog: HTMLDialogElement, options: SpaceInteriorOptions) {
    this.dialog = dialog;
    const get = <T extends Element>(selector: string) => dialog.querySelector<T>(selector)!;
    this.photo = get('[data-interior-photo]');
    this.stage = get('[data-interior-stage]');
    this.preview = get('[data-interior-preview]');
    this.full = get('[data-interior-full]');
    this.background = get('[data-interior-bg]');
    this.info = get('[data-interior-info]');
    this.back = get('[data-interior-back]');
    // Lifted to <body>: the section's containment would otherwise be the reference box of
    // the dialog's fixed layout when predict() measures it closed.
    this.home = document.createComment('tour-interior');
    dialog.replaceWith(this.home);
    document.body.append(dialog);
    const { signal } = this.controller;
    this.back.addEventListener('click', () => options.onRequestClose(), { signal });
    const zoom = dialog.querySelector<HTMLButtonElement>('[data-interior-zoom]');
    zoom?.addEventListener('click', () => options.onZoom(zoom), { signal });
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); options.onRequestClose(); }, { signal });
    dialog.addEventListener('close', () => { if (!this.closing) { this.reset(); options.onDismissed(); } }, { signal });
    // The page does not scroll behind the interior; the interior itself may (short screens).
    const hold = (event: Event) => { if (dialog.scrollHeight <= dialog.clientHeight + 1) event.preventDefault(); };
    dialog.addEventListener('wheel', hold, { signal, passive: false });
    dialog.addEventListener('touchmove', hold, { signal, passive: false });
    this.full.addEventListener('load', () => this.full.toggleAttribute('data-loaded', true), { signal });
    addEventListener('resize', () => { if (dialog.open) this.fit(); }, { signal });
  }

  get isOpen() { return this.dialog.open; }

  /** Where the photo will rest in the interior view (viewport px), measured once before a
   * dive so the camera can land the portal's photo exactly there. */
  predict(item: InteriorView['item']): DOMRect | undefined {
    if (this.dialog.open) return undefined;
    this.preload(item);
    this.aspect = item.width > 0 && item.height > 0 ? item.width / item.height : 1;
    const { style } = this.dialog;
    style.display = 'block';
    style.visibility = 'hidden';
    this.fit();
    const rect = this.photo.getBoundingClientRect();
    style.removeProperty('display');
    style.removeProperty('visibility');
    return rect.width > 0 && rect.height > 0 ? rect : undefined;
  }

  async open(view: InteriorView, from: DOMRect | undefined, reduced: boolean) {
    this.cancelRunning();
    this.closing = false;
    const slot = (name: string) => this.dialog.querySelector<HTMLElement>(`[data-interior-${name}]`);
    const area = slot('area');
    const title = slot('title');
    const description = slot('description');
    if (area) area.textContent = view.area;
    if (title) title.textContent = view.title;
    if (description) description.textContent = view.description;
    this.background.style.setProperty('--interior-backdrop', view.backdrop);
    this.aspect = view.item.width > 0 && view.item.height > 0 ? view.item.width / view.item.height : 1;
    this.preview.src = view.preview || view.item.src;
    this.full.removeAttribute('data-loaded');
    this.full.alt = view.item.alt;
    this.full.sizes = '(min-width: 64rem) 62vw, 100vw';
    this.full.srcset = view.item.srcset;
    this.full.src = view.item.src;
    if (this.full.complete && this.full.naturalWidth > 0) this.full.toggleAttribute('data-loaded', true);
    this.dialog.showModal();
    this.fit();
    this.back.focus({ preventScroll: true });
    if (reduced || !from || typeof this.photo.animate !== 'function') return;
    const to = this.photo.getBoundingClientRect();
    if (to.width < 1 || to.height < 1) return;
    const start = `translate(${(from.left - to.left).toFixed(2)}px, ${(from.top - to.top).toFixed(2)}px) scale(${(from.width / to.width).toFixed(4)}, ${(from.height / to.height).toFixed(4)})`;
    this.running = [
      this.photo.animate([{ transform: start, borderRadius: '0px' }, { transform: 'none' }], { duration: 760, easing: SETTLE }),
      this.background.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 560, easing: 'ease-out' }),
      this.info.animate([{ opacity: 0, transform: 'translateY(.9rem)' }, { opacity: 1, transform: 'none' }], { duration: 620, delay: 300, easing: SETTLE, fill: 'backwards' }),
    ];
    await Promise.allSettled(this.running.map((animation) => animation.finished));
    this.running = [];
  }

  /** Runs the reverse movement towards where the portal's photo is now, then closes. */
  async close(to: () => DOMRect | undefined, reduced: boolean) {
    if (!this.dialog.open) return;
    this.cancelRunning();
    this.closing = true;
    const target = reduced ? undefined : to();
    const from = this.photo.getBoundingClientRect();
    if (target && from.width > 0 && typeof this.photo.animate === 'function') {
      const end = `translate(${(target.left - from.left).toFixed(2)}px, ${(target.top - from.top).toFixed(2)}px) scale(${(target.width / from.width).toFixed(4)}, ${(target.height / from.height).toFixed(4)})`;
      this.running = [
        this.photo.animate([{ transform: 'none' }, { transform: end, borderRadius: '0px' }], { duration: 620, easing: GLIDE, fill: 'forwards' }),
        this.background.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 560, delay: 60, easing: 'ease-in', fill: 'forwards' }),
        this.info.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(.6rem)' }], { duration: 260, easing: 'ease-in', fill: 'forwards' }),
      ];
      await Promise.allSettled(this.running.map((animation) => animation.finished));
    }
    this.dialog.close();
    this.reset();
  }

  /** Fetches and decodes the large photo while the camera flies, so the hand-off to 2D
   * does not stall on it. */
  private preload(item: InteriorView['item']) {
    if (!item.src || this.preloaded === item.src) return;
    this.preloaded = item.src;
    const image = new Image();
    image.decoding = 'async';
    image.sizes = '(min-width: 64rem) 62vw, 100vw';
    image.srcset = item.srcset;
    image.src = item.src;
    image.decode().catch(() => { /* the dialog shows the portal's photo meanwhile */ });
  }

  /** The photo box takes the photo's proportion, as large as the stage allows. */
  private fit() {
    const width = this.stage.clientWidth;
    // A capped stage (phones) grows with the photo; otherwise the stage's own height rules.
    const cap = Number.parseFloat(getComputedStyle(this.stage).maxHeight);
    const height = Number.isFinite(cap) ? cap : this.stage.clientHeight;
    if (width <= 0 || height <= 0) return;
    const fitted = Math.min(width, height * this.aspect);
    this.photo.style.width = `${Math.floor(fitted)}px`;
    this.photo.style.height = `${Math.floor(fitted / this.aspect)}px`;
  }

  private cancelRunning() {
    this.running.forEach((animation) => animation.cancel());
    this.running = [];
  }

  private reset() {
    this.cancelRunning();
    this.closing = false;
    this.full.removeAttribute('srcset');
    this.full.removeAttribute('src');
    this.full.removeAttribute('data-loaded');
    this.preview.removeAttribute('src');
  }

  dispose() {
    this.controller.abort();
    if (this.dialog.open) { this.closing = true; this.dialog.close(); }
    this.reset();
    this.home.replaceWith(this.dialog);
  }
}
