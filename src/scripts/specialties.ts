/** El Mundo LUXE: the specialties selector and the globe of real photos and clips stay in
 * sync. The visitor arrives on the welcome clip in front, with its editorial line beneath;
 * choosing a specialty turns the globe to its representative photo; choosing a piece on the
 * globe (or letting a drag come to rest near one) brings it forward with a gold reveal and
 * selects its specialty; a second tap on the piece in front opens the shared viewer (clips
 * play there with controls). Without JS the list, copy and a static 3D globe stay complete. */
import type { Orientation } from '../lib/sphere';
import { frontmost } from '../lib/globe-media';
import { HOVER_INTENT_MS, HoverIntent } from '../lib/signature-state';
import { GlobeRotor } from './globe-rotor';
import { GlobeVideos } from './globe-video';
import { openLightbox, readLightboxItem, type LightboxItem } from './lightbox';

interface SpecialtyData {
  readonly id: string;
  readonly number: string;
  readonly name: string;
  readonly description: string;
  readonly message: string;
  readonly category: string;
  readonly works: boolean;
  readonly featured: string;
}
interface IntroData { readonly eyebrow: string; readonly title: string; readonly message: string }
interface GlobeData {
  readonly initial: Orientation;
  readonly specialties: readonly SpecialtyData[];
  readonly hero?: string;
  readonly intro: IntroData;
}

const SETTLE = 'cubic-bezier(.22, 1, .36, 1)';
/** One key press or button tap turns the globe this much (screen degrees). */
const KEY_STEP = 24;
/** The welcome plays once, when the globe first comes into view; then it is simply there. */
const INTRO_MS = 2_400;

/** Ambient sway only where it is cheap and welcome: fine pointers and capable devices. */
function idleWelcome(): boolean {
  const cores = navigator.hardwareConcurrency ?? 8;
  return !saveData() && cores > 4 && matchMedia('(hover: hover) and (pointer: fine)').matches;
}
function saveData(): boolean {
  return Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData);
}

class LuxeSpecialties extends HTMLElement {
  private cleanup?: () => void;

  connectedCallback() {
    this.cleanup?.();
    const rows = [...this.querySelectorAll<HTMLElement>('[data-specialty-row]')];
    const list = this.querySelector<HTMLElement>('[data-specialty-list]');
    const index = this.querySelector<HTMLElement>('[data-specialty-index]');
    const stage = this.querySelector<HTMLElement>('[data-globe-stage]');
    const rotor = this.querySelector<HTMLElement>('[data-globe-rotor]');
    const controls = this.querySelector<HTMLElement>('[data-globe-controls]');
    const zoom = this.querySelector<HTMLButtonElement>('[data-globe-zoom]');
    const zoomLabel = zoom?.querySelector<HTMLElement>('[data-globe-zoom-label]');
    const hint = this.querySelector<HTMLElement>('[data-globe-hint]');
    const indicator = this.querySelector<HTMLElement>('[data-specialty-indicator]');
    const status = this.querySelector<HTMLElement>('[data-specialty-status]');
    const copy = this.querySelector<HTMLElement>('[data-globe-copy]');
    const panels = [...this.querySelectorAll<HTMLElement>('[data-globe-panel]')];
    const slot = (name: string) => this.querySelector<HTMLElement>(`[data-specialty-slot="${name}"]`);
    const slots = {
      index: slot('index'), name: slot('name'), rule: slot('rule'), description: slot('description'),
      message: slot('message'), caption: slot('caption'), works: slot('works'),
    };
    let data: GlobeData | undefined;
    try { data = JSON.parse(this.querySelector('[data-globe-data]')?.textContent ?? '') as GlobeData; } catch { /* Static content stays. */ }
    if (!data || !list || !index || !stage || !rotor || !controls || !status || !panels.length || rows.length !== data.specialties.length) return;
    const { specialties, intro } = data;
    const total = String(specialties.length).padStart(2, '0');

    const controller = new AbortController();
    const { signal } = controller;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const intent = new HoverIntent<number>(HOVER_INTENT_MS);
    const textMotion = new Set<Animation>();
    const byKey = new Map(panels.map((panel) => [panel.dataset.key ?? '', panel]));
    const hero = data.hero ? byKey.get(data.hero) : undefined;
    /** -1: the welcome (no specialty chosen yet, or a piece without one). */
    let selected = hero ? -1 : 0;
    let featured: HTMLElement | undefined;
    let videos: GlobeVideos | undefined;
    let introTimer = 0;

    const rotorControl = new GlobeRotor({
      stage, rotor, panels, initial: data.initial,
      reducedMotion: () => motion.matches,
      onInteract: () => { hint?.setAttribute('hidden', ''); },
      onPanel: (panel) => choosePanel(panel),
      onRender: () => videos?.update(),
      onRest: () => settleFront(),
    });
    const clips = panels.flatMap((panel, position) => (panel.dataset.kind === 'video' ? [{ index: position, panel }] : []));
    if (clips.length) {
      videos = new GlobeVideos({
        clips,
        depth: (position) => rotorControl.depth(position),
        onScreen: () => rotorControl.onScreen,
        stillOnly: () => motion.matches || saveData(),
      });
    }

    // The heading text moves into a real button; cleanup moves it back.
    const buttons = rows.map((row, position) => {
      const heading = row.querySelector<HTMLElement>('[data-specialty-name]')!;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'signature-trigger';
      button.setAttribute('aria-controls', 'specialty-panel');
      button.setAttribute('aria-pressed', String(position === selected));
      button.append(...heading.childNodes);
      heading.append(button);
      return button;
    });

    const revealChip = () => {
      const row = rows[selected];
      if (!row || index.scrollWidth <= index.clientWidth) return;
      index.scrollTo({ left: row.offsetLeft - (index.clientWidth - row.offsetWidth) / 2, behavior: motion.matches ? 'auto' : 'smooth' });
    };
    const updateMore = () => list.toggleAttribute('data-more', index.scrollLeft + index.clientWidth < index.scrollWidth - 4);
    const placeIndicator = () => {
      const row = rows[selected];
      indicator?.toggleAttribute('data-none', !row);
      if (!row || !indicator) return;
      indicator.style.setProperty('--y', `${row.offsetTop}px`);
      indicator.style.setProperty('--h', String(row.offsetHeight));
    };
    const markActive = () => {
      rows.forEach((row, position) => row.toggleAttribute('data-active', position === selected));
      buttons.forEach((button, position) => button.setAttribute('aria-pressed', String(position === selected)));
      placeIndicator();
      revealChip();
    };

    const animateText = (element: Element | null | undefined, keyframes: Keyframe[], options: KeyframeAnimationOptions) => {
      if (!element || motion.matches || typeof element.animate !== 'function') return;
      try {
        const animation = element.animate(keyframes, { fill: 'backwards', easing: SETTLE, ...options });
        textMotion.add(animation);
        animation.finished.then(() => textMotion.delete(animation), () => textMotion.delete(animation));
      } catch { /* Text stays in its final, readable state. */ }
    };
    const cancelText = () => { textMotion.forEach((animation) => animation.cancel()); textMotion.clear(); };
    const riseCopy = () => {
      // Text changes at once; only a soft rise follows, so the piece is always labelled.
      animateText(slots.name, [{ opacity: .2, transform: 'translateY(.3em)' }, { opacity: 1, transform: 'none' }], { duration: 420 });
      animateText(slots.rule, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: 460, delay: 80 });
      animateText(slots.message, [{ opacity: .25 }, { opacity: 1 }], { duration: 360, delay: 60 });
    };
    const write = (copyText: { index: string; name: string; description: string; message: string; works?: string }, mode: 'intro' | 'specialty', animate: boolean) => {
      cancelText();
      if (slots.index) slots.index.textContent = copyText.index;
      if (slots.name) slots.name.textContent = copyText.name;
      if (slots.description) slots.description.textContent = copyText.description;
      if (slots.message) slots.message.textContent = copyText.message;
      if (slots.works) {
        slots.works.hidden = !copyText.works;
        if (copyText.works) slots.works.dataset.showcaseLink = copyText.works;
      }
      if (copy) copy.dataset.mode = mode;
      if (animate) riseCopy();
    };
    const showSpecialty = (specialty: SpecialtyData, animate: boolean) => write({
      index: `${specialty.number} / ${total}`, name: specialty.name, description: specialty.description, message: specialty.message, works: specialty.works ? specialty.category : undefined,
    }, 'specialty', animate);
    const showIntro = (animate: boolean) => write({ index: intro.eyebrow, name: intro.title, description: '', message: intro.message }, 'intro', animate);

    const isMedia = (panel: HTMLElement | undefined) => panel?.dataset.kind === 'photo' || panel?.dataset.kind === 'video';
    /** Plays the gold reveal of a piece once (restarting it if it already ran). */
    const reveal = (panel: HTMLElement) => {
      panel.removeAttribute('data-reveal');
      void panel.offsetWidth;
      panel.setAttribute('data-reveal', '');
    };
    /** Raise one panel and bring it to the front; the rest of the globe stays as it is. */
    const feature = (panel: HTMLElement, travel = true) => {
      if (featured !== panel) {
        featured?.removeAttribute('data-featured');
        featured?.removeAttribute('data-reveal');
        reveal(panel);
      }
      featured = panel;
      panel.setAttribute('data-featured', '');
      if (slots.caption) slots.caption.textContent = panel.dataset.caption ?? '';
      if (zoom) zoom.hidden = !isMedia(panel);
      if (zoomLabel) zoomLabel.textContent = panel.dataset.kind === 'video' ? 'Ver video' : 'Ampliar';
      if (travel) rotorControl.face({ lat: Number(panel.dataset.lat) || 0, lon: Number(panel.dataset.lon) || 0 });
    };

    const select = (next: number, panel?: HTMLElement) => {
      intent.cancel();
      next = (next + specialties.length) % specialties.length;
      const specialty = specialties[next]!;
      const changed = next !== selected;
      selected = next;
      markActive();
      showSpecialty(specialty, changed);
      feature(panel ?? byKey.get(specialty.featured) ?? panels[0]!);
      status.textContent = `${specialty.name}. ${specialty.description}`;
    };
    /** Back to the welcome clip: no specialty chosen, the editorial line returns. */
    const welcome = (panel: HTMLElement) => {
      const changed = selected !== -1;
      selected = -1;
      markActive();
      showIntro(changed);
      feature(panel);
      status.textContent = `${intro.eyebrow}. ${intro.title}`;
    };

    const media = () => panels.filter((panel) => isMedia(panel));
    const openViewer = (panel: HTMLElement, opener: HTMLElement) => {
      const items = media().map((piece) => readLightboxItem(piece)).filter((item): item is LightboxItem => Boolean(item));
      if (!openLightbox(items, media().indexOf(panel), opener)) return;
      // The clip on the sphere rests while the viewer is open; the world keeps its position.
      videos?.suspend(true);
      document.querySelector('luxe-lightbox')?.addEventListener('lightbox:close', () => videos?.suspend(false), { once: true, signal });
    };

    /** A tap on the globe: raise that piece (and select its specialty); tap it again to enlarge. */
    const choosePanel = (panel: HTMLElement) => {
      if (panel === featured && isMedia(panel)) { openViewer(panel, stage); return; }
      const owner = specialties.findIndex((specialty) => specialty.id === panel.dataset.specialty);
      if (owner >= 0) select(owner, panel);
      else if (panel === hero) welcome(panel);
      else {
        // An interior belongs to no specialty: it comes forward, the chosen specialty stays.
        feature(panel);
        status.textContent = panel.dataset.caption ?? '';
      }
    };

    /** A drag that comes to rest near a piece settles it in front, with its reveal. This is
     * motion: with reduced motion the world stays exactly where the visitor left it. */
    const settleFront = () => {
      if (motion.matches) return;
      const pieces = panels.flatMap((panel, position) => (isMedia(panel) || panel.dataset.kind === 'emblem' ? [{ index: position, depth: rotorControl.depth(position) }] : []));
      const front = panels[frontmost(pieces)];
      if (!front || front === featured) return;
      choosePanel(front);
    };

    buttons.forEach((button, position) => {
      button.addEventListener('click', () => select(position), { signal });
      button.addEventListener('keydown', (event) => {
        const last = buttons.length - 1;
        const target = ({ ArrowDown: position + 1, ArrowRight: position + 1, ArrowUp: position - 1, ArrowLeft: position - 1, Home: 0, End: last } as Record<string, number>)[event.key];
        if (target === undefined) return;
        event.preventDefault();
        const next = (target + buttons.length) % buttons.length;
        buttons[next]!.focus({ preventScroll: true });
        select(next);
      }, { signal });
    });
    // Hover only with a mouse that really moves and rests: crossing rows or scrolling changes nothing.
    rows.forEach((row, position) => {
      row.addEventListener('pointermove', (event) => {
        if (event.pointerType === 'mouse' && (event.movementX || event.movementY)) intent.enter(position, (key) => { if (key !== selected) select(key); });
      }, { signal });
      row.addEventListener('pointerleave', () => intent.leave(position), { signal });
    });
    // Screen terms, like a drag: «arriba» rolls the front of the globe upwards, without limit.
    const turns: Record<string, readonly [number, number]> = { left: [-KEY_STEP, 0], right: [KEY_STEP, 0], up: [0, -KEY_STEP], down: [0, KEY_STEP] };
    for (const button of controls.querySelectorAll<HTMLButtonElement>('[data-globe-turn]')) {
      const [yaw, pitch] = turns[button.dataset.globeTurn ?? ''] ?? [0, 0];
      button.addEventListener('click', () => rotorControl.nudge(yaw, pitch), { signal });
    }
    zoom?.addEventListener('click', () => { if (featured && isMedia(featured)) openViewer(featured, zoom); }, { signal });
    stage.addEventListener('keydown', (event) => {
      if (event.target !== stage) return;
      const keys: Record<string, readonly [number, number]> = { ArrowLeft: turns.left!, ArrowRight: turns.right!, ArrowUp: turns.up!, ArrowDown: turns.down! };
      const turn = keys[event.key];
      if (turn) { event.preventDefault(); rotorControl.nudge(turn[0], turn[1]); return; }
      if ((event.key === 'Enter' || event.key === ' ') && featured && isMedia(featured)) { event.preventDefault(); openViewer(featured, stage); }
    }, { signal });
    // The globe never competes with the visitor: no sway while hovering or focusing it.
    const pause = () => rotorControl.setIdle(false);
    const resume = () => rotorControl.setIdle(idleWelcome() && !motion.matches);
    stage.addEventListener('pointerenter', pause, { signal });
    stage.addEventListener('pointerleave', resume, { signal });
    stage.addEventListener('focusin', pause, { signal });
    stage.addEventListener('focusout', resume, { signal });
    index.addEventListener('scroll', updateMore, { passive: true, signal });
    // Photos and clips mount as the globe approaches (inline loader); nothing may be moving then.
    stage.addEventListener('globe:mounted', () => videos?.update(), { signal });
    motion.addEventListener('change', (event) => {
      if (event.matches) { rotorControl.settle(); rotorControl.setIdle(false); cancelText(); finishIntro(); }
      else resume();
      videos?.update();
    }, { signal });

    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { placeIndicator(); updateMore(); }) : undefined;
    resize?.observe(this);

    /** The welcome, once: the world arrives with depth, the clip settles in front, the line
     * rises and a gold glint crosses the diamond. Never blocks: everything responds meanwhile. */
    const finishIntro = () => {
      window.clearTimeout(introTimer);
      introTimer = 0;
      if (this.dataset.intro) this.dataset.intro = 'done';
    };
    let introObserver: IntersectionObserver | undefined;
    const below = stage.getBoundingClientRect().top > window.innerHeight;
    if (hero && below && !motion.matches && 'IntersectionObserver' in window && typeof Element.prototype.animate === 'function') {
      this.dataset.intro = 'pending';
      introObserver = new IntersectionObserver((records) => {
        if (!records.some((record) => record.isIntersecting)) return;
        introObserver?.disconnect();
        this.dataset.intro = 'play';
        introTimer = window.setTimeout(finishIntro, INTRO_MS);
        // The clip's gold reveal plays with the arrival (delayed by CSS while the intro runs).
        if (featured) reveal(featured);
      }, { threshold: .25 });
      introObserver.observe(stage);
    }

    stage.tabIndex = 0;
    stage.setAttribute('aria-roledescription', 'globo giratorio');
    stage.setAttribute('aria-describedby', 'globe-help');
    controls.hidden = false;
    if (hint) hint.hidden = false;
    this.dataset.ready = '';
    const first = hero ?? byKey.get(specialties[0]!.featured);
    if (first) { featured = first; first.setAttribute('data-featured', ''); }
    if (zoom) zoom.hidden = !isMedia(first);
    if (zoomLabel) zoomLabel.textContent = first?.dataset.kind === 'video' ? 'Ver video' : 'Ampliar';
    markActive();
    updateMore();
    resume();
    videos?.update();

    this.cleanup = () => {
      controller.abort();
      intent.cancel();
      resize?.disconnect();
      introObserver?.disconnect();
      window.clearTimeout(introTimer);
      delete this.dataset.intro;
      rotorControl.dispose();
      videos?.dispose();
      cancelText();
      rotor.style.transform = `rotateX(${data!.initial.pitch}deg) rotateY(${data!.initial.yaw}deg)`;
      panels.forEach((panel) => { panel.removeAttribute('data-featured'); panel.removeAttribute('data-reveal'); });
      selected = hero ? -1 : 0;
      if (hero) showIntro(false);
      else showSpecialty(specialties[0]!, false);
      if (slots.caption && first) slots.caption.textContent = first.dataset.caption ?? '';
      status.textContent = '';
      rows.forEach((row) => row.removeAttribute('data-active'));
      buttons.forEach((button) => { button.parentElement?.append(...button.childNodes); button.remove(); });
      list.removeAttribute('data-more');
      stage.removeAttribute('tabindex');
      stage.removeAttribute('aria-roledescription');
      stage.removeAttribute('aria-describedby');
      controls.hidden = true;
      if (hint) hint.hidden = true;
      delete this.dataset.ready;
    };
  }

  disconnectedCallback() { this.cleanup?.(); }
}

if (!customElements.get('luxe-specialties')) customElements.define('luxe-specialties', LuxeSpecialties);
