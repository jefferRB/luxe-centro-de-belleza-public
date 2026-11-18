/** «El espacio»: a walk through the real photos of LUXE. An orbital crown of view cards
 * (space-crown.ts) turns by click, drag, arrows, swipe or keys; the portal changes its
 * photo with a short depth transition, the caption follows, and the shared lightbox shows
 * any view in full.
 *
 * Double buffer: the photo on screen stays until the next one has really loaded and
 * decoded (load/error events, no arbitrary timeout); only then do they cross. Finished
 * transitions are cancelled, never left filling forwards, so a view shown again can never
 * inherit an old "faded out" state. A photo that fails shows a fallback with a retry.
 * Only the selected view and its two ring neighbours are fetched ahead of time. */
import { wrapOffset } from '../lib/orbit-layout';
import { formatCounter } from '../lib/showcase-state';
import { neighbours } from '../lib/space-orbit';
import { openLightbox, readLightboxItem, type LightboxItem } from './lightbox';
import { SpaceCrown } from './space-crown';
import { SpaceExplore } from './space-explore';
import { SpaceInterior } from './space-interior';
import { SpaceScene } from './space-scene';
import { onSwipe } from './swipe';

const SETTLE = 'cubic-bezier(.22, 1, .36, 1)';
/** Only a cue: if a photo takes longer than this, a discreet loading mark appears. */
const LOADING_CUE_MS = 350;
const REVEAL_ANIMATIONS = /^tour-(crown-in|ring-draw|portal-in|sweep|photo-in)$/;

/** Resolves when the photo can paint (true) or has failed (false). Starts the fetch if a
 * lazy image had not started it yet. */
function whenImageReady(image: HTMLImageElement | null): Promise<boolean> {
  if (!image) return Promise.resolve(true);
  image.loading = 'eager';
  if (image.complete && image.naturalWidth > 0) return image.decode().then(() => true, () => true);
  if (image.complete && image.currentSrc) return Promise.resolve(false);
  return new Promise((resolve) => {
    const finish = (ok: boolean) => {
      image.removeEventListener('load', loaded);
      image.removeEventListener('error', failed);
      resolve(ok);
    };
    const loaded = () => { image.decode().then(() => finish(true), () => finish(image.naturalWidth > 0)); };
    const failed = () => finish(false);
    image.addEventListener('load', loaded);
    image.addEventListener('error', failed);
  });
}

/** Fetch a hidden view's photo ahead of time, without showing it. */
function warm(view: HTMLElement | undefined) {
  const image = view?.querySelector('img');
  if (image && image.loading !== 'eager') image.loading = 'eager';
}

/** The camera draws through matrix3d(); without it the crown stays as the server composed it. */
const supports3d = () => typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('transform', 'matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)');

/** Low-end devices or data saving: no ambient motion, no parallax. */
function constrained() {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  return (nav.hardwareConcurrency ?? 8) <= 2 || (nav.deviceMemory ?? 8) <= 2 || Boolean(nav.connection?.saveData);
}

class LuxeSpaceTour extends HTMLElement {
  private cleanup?: () => void;
  /** The entrance plays once per page, however often the visitor scrolls past. */
  private revealed = false;

  connectedCallback() {
    this.cleanup?.();
    const stage = this.querySelector<HTMLElement>('[data-tour-stage]');
    const crownBand = this.querySelector<HTMLElement>('[data-tour-crown]');
    const ring = this.querySelector<HTMLElement>('[data-tour-ring]');
    const list = this.querySelector<HTMLElement>('[data-tour-thumbs]');
    const nav = this.querySelector<HTMLElement>('[data-tour-nav]');
    const zoom = this.querySelector<HTMLButtonElement>('[data-tour-zoom]');
    const counter = this.querySelector<HTMLElement>('[data-tour-counter]');
    const status = this.querySelector<HTMLElement>('[data-tour-status]');
    const glow = this.querySelector<HTMLElement>('[data-tour-glow]');
    const views = [...this.querySelectorAll<HTMLElement>('[data-tour-view]')];
    const thumbs = [...this.querySelectorAll<HTMLElement>('[data-tour-thumb]')];
    const dots = [...this.querySelectorAll<HTMLElement>('[data-tour-dot]')];
    const slot = (name: string) => this.querySelector<HTMLElement>(`[data-tour-slot="${name}"]`);
    const slots = { area: slot('area'), title: slot('title'), description: slot('description') };
    if (!stage || !crownBand || !ring || !list || !nav || !status || !views.length || views.length !== thumbs.length) return;

    const controller = new AbortController();
    const { signal } = controller;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const lite = constrained();
    const running = new Set<Animation>();
    /** The selected view (cards, counter, caption) and the view actually on screen. */
    let current = 0;
    let displayed = 0;
    let token = 0;
    let cue = 0;

    const animate = (element: Element | null | undefined, keyframes: Keyframe[], options: KeyframeAnimationOptions) => {
      if (!element || motion.matches || typeof element.animate !== 'function') return undefined;
      try {
        const animation = element.animate(keyframes, options);
        running.add(animation);
        animation.finished.then(() => running.delete(animation), () => running.delete(animation));
        return animation;
      } catch { return undefined; }
    };
    /** Ends every transition now: only the displayed view stays, with no leftover effects. */
    const settle = () => {
      running.forEach((animation) => animation.cancel());
      running.clear();
      views.forEach((view, index) => {
        view.getAnimations().forEach((animation) => animation.cancel());
        if (index !== displayed && view.dataset.state !== 'preparing') view.hidden = true;
      });
    };
    const loading = (on: boolean) => {
      window.clearTimeout(cue);
      if (on) stage.setAttribute('aria-busy', 'true');
      else stage.removeAttribute('aria-busy');
      if (on) cue = window.setTimeout(() => stage.toggleAttribute('data-loading', true), LOADING_CUE_MS);
      else stage.removeAttribute('data-loading');
    };
    /** Limited preloading: the selected view and its neighbours on the ring. */
    const warmAround = (index: number) => neighbours(index, views.length).forEach((at) => warm(views[at]));

    const markThumbs = () => {
      thumbs.forEach((thumb, index) => {
        thumb.setAttribute('aria-selected', String(index === current));
        thumb.tabIndex = index === current ? 0 : -1;
      });
      dots.forEach((dot, index) => dot.toggleAttribute('data-active', index === current));
    };
    const writeCaption = (thumb: HTMLElement) => {
      if (slots.area) slots.area.textContent = thumb.dataset.area ?? '';
      if (slots.title) slots.title.textContent = thumb.dataset.title ?? '';
      if (slots.description) slots.description.textContent = thumb.dataset.description ?? '';
    };

    /** Prepares a view invisibly and resolves once its photo is ready (or has failed). */
    const prepare = async (view: HTMLElement) => {
      view.getAnimations().forEach((animation) => animation.cancel());
      view.dataset.state = 'preparing';
      view.hidden = false;
      const ok = await whenImageReady(view.querySelector('img'));
      view.toggleAttribute('data-failed', !ok);
      return ok;
    };

    const show = async (next: number) => {
      if (next === current) return;
      const thumb = thumbs[next]!;
      // Circular: from the last view to the first is one step forward, not four back.
      const forward = wrapOffset(next - current, views.length) >= 0 ? 1 : -1;
      current = next;
      const mine = ++token;
      markThumbs();
      if (counter) counter.textContent = formatCounter(current, views.length);
      writeCaption(thumb);
      status.textContent = `${current + 1} de ${views.length}. ${thumb.dataset.area}: ${thumb.dataset.title}`;
      settle();
      // The copy moves with the crown, at once; the photo follows as soon as it is ready.
      [slots.area, slots.title, slots.description].forEach((element, order) => animate(element, [{ opacity: 0, transform: `translate(${forward * .6}rem, .3rem)` }, { opacity: 1, transform: 'none' }], { duration: 460, delay: order * 55, easing: SETTLE, fill: 'backwards' }));
      warmAround(current);
      // A view still preparing for an earlier, abandoned choice goes back to sleep.
      views.forEach((view, index) => {
        if (view.dataset.state === 'preparing' && index !== next) { delete view.dataset.state; view.hidden = true; }
      });
      if (next === displayed) { loading(false); return; }
      const incoming = views[next]!;
      const previous = views[displayed]!;
      loading(true);
      await prepare(incoming);
      if (mine !== token) {
        if (views.indexOf(incoming) !== current) { delete incoming.dataset.state; incoming.hidden = true; }
        return;
      }
      loading(false);
      delete incoming.dataset.state;
      displayed = next;
      // Walking into the next room: the current one opens past the visitor, the next comes forward.
      const exit = animate(previous, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${-forward * 2.5}%) scale(1.07)` }], { duration: 460, easing: SETTLE, fill: 'forwards' });
      animate(incoming, [{ opacity: 0, transform: `translateX(${forward * 3}%) scale(.93)` }, { opacity: 1, transform: 'none' }], { duration: 640, easing: SETTLE });
      animate(glow, [{ opacity: .8, transform: 'none' }, { opacity: 1, transform: 'scale(1.06)', offset: .35 }, { opacity: .8, transform: 'none' }], { duration: 900, easing: 'ease-out' });
      // Hide first, then drop the effect: no flash, and nothing is left filling forwards.
      // Only for this transition: if a newer choice interrupted it (settle() cancels the exit,
      // which also runs this), the outgoing view may be that newer choice and must stay.
      const retire = () => {
        if (mine === token && views.indexOf(previous) !== displayed) previous.hidden = true;
        exit?.cancel();
      };
      if (exit) exit.finished.then(retire, retire);
      else retire();
    };

    // ——— The camera (scene, immersive mode, «Entrar a LUXE», interior view) ———
    let scene: SpaceScene | undefined;
    let explore: SpaceExplore | undefined;
    let interior: SpaceInterior | undefined;
    const orbit = this.querySelector<HTMLElement>('[data-tour-orbit]');
    const portal = this.querySelector<HTMLElement>('[data-tour-portal]');
    const layerBack = this.querySelector('[data-tour-rings="back"]');
    const layerFront = this.querySelector('[data-tour-rings="front"]');
    const modes = this.querySelector<HTMLElement>('[data-tour-modes]');

    const crown = new SpaceCrown({
      stage: crownBand,
      cards: thumbs,
      ring,
      onFront: (index) => { void show(index); explore?.onSelect(); },
      reducedMotion: () => motion.matches,
      // In the immersive mode a drag moves the camera; cards, arrows and keys still turn the crown.
      dragEnabled: () => !explore || explore.currentMode === 'home',
      onRender: (position) => scene?.setCrown(position),
    });

    /** A failed photo can be fetched again; the view stays selected meanwhile. */
    const retry = async (view: HTMLElement) => {
      const picture = view.querySelector('picture');
      if (!picture) return;
      const fresh = picture.cloneNode(true) as HTMLElement;
      picture.replaceWith(fresh);
      view.removeAttribute('data-failed');
      const ok = await whenImageReady(fresh.querySelector('img'));
      view.toggleAttribute('data-failed', !ok);
    };

    const openViewer = (opener: HTMLElement) => {
      const items = views.map((view) => readLightboxItem(view)).filter((item): item is LightboxItem => Boolean(item));
      if (items.length === views.length) openLightbox(items, displayed, opener);
    };

    list.setAttribute('role', 'tablist');
    thumbs.forEach((thumb, index) => {
      thumb.setAttribute('role', 'tab');
      thumb.setAttribute('aria-controls', 'tour-stage');
      thumb.setAttribute('aria-label', `${thumb.dataset.area}: ${thumb.dataset.title}`);
      thumb.addEventListener('keydown', (event) => {
        const steps: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
        const jumps: Record<string, number> = { Home: 0, End: thumbs.length - 1 };
        if (steps[event.key] !== undefined) crown.step(steps[event.key]!, 'key');
        else if (jumps[event.key] !== undefined) crown.goTo(jumps[event.key]!, 'key');
        else if (event.key === 'Enter' || event.key === ' ') crown.goTo(index, 'key');
        else return;
        event.preventDefault();
        thumbs[crown.index]?.focus({ preventScroll: true });
      }, { signal });
      // Intent to look: fetch that view before it is chosen.
      thumb.addEventListener('pointerenter', () => warm(views[index]), { signal });
      thumb.addEventListener('focus', () => warm(views[index]), { signal });
    });
    for (const button of nav.querySelectorAll<HTMLButtonElement>('[data-tour-step]')) {
      button.addEventListener('click', () => crown.step(Number(button.dataset.tourStep)), { signal });
    }
    stage.addEventListener('click', (event) => {
      const target = event.target as Element;
      const retryButton = target.closest<HTMLElement>('[data-tour-retry]');
      if (retryButton) { void retry(retryButton.closest<HTMLElement>('[data-tour-view]')!); return; }
      const view = target.closest<HTMLElement>('[data-tour-view]');
      if (view && !view.hasAttribute('data-failed')) openViewer(stage);
    }, { signal });
    zoom?.addEventListener('click', () => openViewer(zoom), { signal });
    onSwipe(stage, (delta) => { if (!explore || explore.currentMode === 'home') crown.step(delta); }, signal);

    let measureFrame = 0;
    const resize = typeof ResizeObserver === 'function' && orbit ? new ResizeObserver(() => {
      cancelAnimationFrame(measureFrame);
      measureFrame = requestAnimationFrame(() => scene?.measure());
    }) : undefined;
    if (orbit && portal && layerBack instanceof SVGSVGElement && layerFront instanceof SVGSVGElement && supports3d()) {
      scene = new SpaceScene({ root: orbit, portal, ring, cards: thumbs, views, layers: { back: layerBack, front: layerFront }, profile: () => crown.currentProfile, displayed: () => displayed, lite });
      resize?.observe(orbit);
      interior = SpaceInterior.from(this.querySelector<HTMLDialogElement>('[data-tour-interior]'), {
        onRequestClose: () => { void explore?.leaveInterior(); },
        onDismissed: () => explore?.dismissedInterior(),
        onZoom: (opener) => openViewer(opener),
      });
      const button = (name: string) => modes?.querySelector<HTMLButtonElement>(`[data-space-${name}]`) ?? null;
      const exploreButton = button('explore');
      const enterButton = button('enter');
      const viewpointBox = modes?.querySelector<HTMLElement>('[data-space-viewpoints]');
      if (interior && modes && exploreButton && enterButton && viewpointBox) {
        const demoButton = button('demo') ?? undefined;
        explore = new SpaceExplore({
          host: this,
          surface: orbit,
          scene,
          interior,
          explore: exploreButton,
          enter: enterButton,
          // A recorded flight is pure motion: not offered on constrained devices.
          demo: lite ? undefined : demoButton,
          viewpoints: viewpointBox,
          announce: (message) => { status.textContent = message; },
          reducedMotion: () => motion.matches,
          current: () => crown.index,
          ready: (index) => whenImageReady(views[index]?.querySelector('img') ?? null),
          describe: (index) => {
            const view = views[index]!;
            const thumb = thumbs[index]!;
            return {
              item: readLightboxItem(view)!,
              area: thumb.dataset.area ?? '',
              title: thumb.dataset.title ?? '',
              description: thumb.dataset.description ?? '',
              backdrop: view.querySelector<HTMLElement>('.tour-backdrop')?.style.getPropertyValue('--backdrop') ?? '',
              preview: view.querySelector('img')?.currentSrc ?? '',
            };
          },
        });
        if (demoButton) demoButton.hidden = lite;
        modes.hidden = false;
      }
    }

    // ——— Entrance, ambient motion and parallax ———
    const finishReveal = () => { if (this.dataset.reveal) delete this.dataset.reveal; };
    const reveal = () => {
      if (this.revealed) return;
      this.revealed = true;
      if (this.dataset.reveal !== 'pending' || motion.matches) { finishReveal(); return; }
      this.dataset.reveal = 'run';
      crown.enter();
      const effects = this.getAnimations({ subtree: true }).filter((animation) => animation instanceof CSSAnimation && REVEAL_ANIMATIONS.test(animation.animationName));
      void Promise.allSettled(effects.map((animation) => animation.finished)).then(() => { if (this.dataset.reveal === 'run') finishReveal(); });
    };
    const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver((entries) => {
      for (const entry of entries) {
        this.toggleAttribute('data-inview', entry.isIntersecting);
        explore?.setInView(entry.isIntersecting);
        if (!entry.isIntersecting) continue;
        warmAround(current);
        reveal();
      }
    }, { threshold: .2 }) : undefined;
    if (observer && !this.revealed && !motion.matches) {
      // Only something not yet seen waits for its entrance; nothing on screen disappears.
      const box = this.getBoundingClientRect();
      if (box.top > innerHeight || box.bottom < 0) this.dataset.reveal = 'pending';
      else this.revealed = true;
    }
    observer?.observe(this);
    this.toggleAttribute('data-ambient', !lite);
    this.toggleAttribute('data-lite', lite);

    let frame = 0;
    let pointer = { x: 0, y: 0 };
    const applyParallax = () => {
      frame = 0;
      this.style.setProperty('--px', pointer.x.toFixed(3));
      this.style.setProperty('--py', pointer.y.toFixed(3));
    };
    const parallax = !lite && matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (parallax) {
      const clamp = (value: number) => Math.max(-1, Math.min(1, value));
      this.addEventListener('pointermove', (event) => {
        if (event.pointerType !== 'mouse' || motion.matches) return;
        const box = this.getBoundingClientRect();
        pointer = { x: clamp(((event.clientX - box.left) / box.width) * 2 - 1), y: clamp(((event.clientY - box.top) / box.height) * 2 - 1) };
        if (!frame) frame = requestAnimationFrame(applyParallax);
      }, { signal });
      this.addEventListener('pointerleave', () => {
        pointer = { x: 0, y: 0 };
        if (!frame) frame = requestAnimationFrame(applyParallax);
      }, { signal });
    }
    motion.addEventListener('change', (event) => {
      if (!event.matches) return;
      settle();
      crown.settle();
      explore?.reduceMotion();
      finishReveal();
      pointer = { x: 0, y: 0 };
      applyParallax();
    }, { signal });

    // The first view can fail too: watch it like any other.
    void whenImageReady(views[0]!.querySelector('img')).then((ok) => { if (!ok) views[0]!.setAttribute('data-failed', ''); });

    stage.setAttribute('role', 'tabpanel');
    stage.setAttribute('aria-label', 'Fotografía del ambiente');
    markThumbs();
    nav.hidden = views.length < 2;
    if (zoom) zoom.hidden = false;
    this.dataset.ready = '';

    this.cleanup = () => {
      controller.abort();
      observer?.disconnect();
      resize?.disconnect();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(measureFrame);
      explore?.dispose();
      interior?.dispose();
      scene?.dispose();
      if (modes) modes.hidden = true;
      crown.dispose();
      token++;
      displayed = 0;
      settle();
      loading(false);
      views.forEach((view, index) => { view.hidden = index > 0; delete view.dataset.state; });
      current = 0;
      markThumbs();
      list.removeAttribute('role');
      writeCaption(thumbs[0]!);
      if (counter) counter.textContent = formatCounter(0, views.length);
      thumbs.forEach((thumb) => ['role', 'aria-controls', 'aria-label', 'aria-selected', 'tabindex'].forEach((name) => thumb.removeAttribute(name)));
      stage.removeAttribute('role');
      stage.removeAttribute('aria-label');
      nav.hidden = true;
      if (zoom) zoom.hidden = true;
      status.textContent = '';
      finishReveal();
      this.style.removeProperty('--px');
      this.style.removeProperty('--py');
      for (const name of ['data-inview', 'data-ambient', 'data-lite', 'data-ready']) this.removeAttribute(name);
    };
  }

  disconnectedCallback() { this.cleanup?.(); }
}

if (!customElements.get('luxe-space-tour')) customElements.define('luxe-space-tour', LuxeSpaceTour);
