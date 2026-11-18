/** Controller for the works crown: places cards with CSS 3D transforms
 * (geometry in lib/orbit-layout.ts), and turns them by drag, buttons, keys or a card click.
 * The DOM is written once per animation frame at most; nothing runs while the stage is idle. */
import { dragUnit, easeOutCubic, frontIndex, poseFor, poseTransform, resistBeyond, settleTarget, shortestTarget, swipeTarget, tweenDuration, type OrbitProfile } from '../lib/orbit-layout';
import { wrapIndex } from '../lib/showcase-state';
import { SWIPE_DISTANCE } from './swipe';

export type OrbitSource = 'drag' | 'step' | 'key' | 'card' | 'select';

export interface OrbitStageOptions {
  /** Receives pointer and keyboard input; also the 3D viewport. */
  readonly stage: HTMLElement;
  /** Layout for the current stage and card size (cards are sized in CSS). */
  readonly profile: (stageWidth: number, cardWidth: number) => OrbitProfile;
  /** The front item changed: copy, counters and selection follow. */
  readonly onFront: (index: number, source: OrbitSource) => void;
  /** The front card was activated (click, Enter or Space): e.g. open the lightbox. */
  readonly onActivate: (index: number, card: HTMLElement) => void;
  /** Any direct manipulation: lets the owner cancel an entrance or a reveal. */
  readonly onInteract?: () => void;
  readonly reducedMotion: () => boolean;
  /** Most items one drag can travel. */
  readonly maxThrow?: number;
}

interface DragState {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  from: number;
  /** The item in front (or arriving) when the gesture began. */
  readonly base: number;
  /** Touch and pen page like a native gallery, one item per swipe; a mouse drag stays free. */
  readonly paged: boolean;
  active: boolean;
  lastX: number;
  lastTime: number;
  velocity: number;
}

const DRAG_THRESHOLD = 8;
/** The click a drag's release may still produce (on touch it can arrive a moment after
 * pointerup, in a task of its own) is swallowed within this window; one click at most. */
const CLICK_GUARD_MS = 300;

export class OrbitStage {
  private readonly options: OrbitStageOptions;
  private readonly controller = new AbortController();
  private readonly resize?: ResizeObserver;
  private cards: HTMLElement[] = [];
  private profile: OrbitProfile;
  private position = 0;
  private target = 0;
  private tween = 0;
  private pending = 0;
  private drag?: DragState;
  private clickGuard = 0;

  constructor(options: OrbitStageOptions) {
    this.options = options;
    this.profile = this.measure();
    const { stage } = options;
    const { signal } = this.controller;
    stage.addEventListener('pointerdown', (event) => this.pointerDown(event), { signal });
    stage.addEventListener('pointermove', (event) => this.pointerMove(event), { signal });
    stage.addEventListener('pointerup', (event) => this.pointerUp(event), { signal });
    stage.addEventListener('pointercancel', (event) => this.pointerUp(event, true), { signal });
    // Only the stage's own capture counts: on touch the photo holds an implicit capture, and its
    // lostpointercapture (bubbling up when the stage takes over) is not the end of the gesture.
    stage.addEventListener('lostpointercapture', (event) => { if (event.target === stage && this.drag?.id === event.pointerId) this.pointerUp(event, true); }, { signal });
    stage.addEventListener('click', (event) => this.click(event), { signal });
    stage.addEventListener('keydown', (event) => this.key(event), { signal });
    // Native image dragging would steal the gesture on desktop.
    stage.addEventListener('dragstart', (event) => event.preventDefault(), { signal });
    if (typeof ResizeObserver === 'function') {
      this.resize = new ResizeObserver(() => { this.profile = this.measure(); this.schedule(); });
      this.resize.observe(stage);
    }
  }

  get count() { return this.cards.length; }
  /** Index of the item that is (or is about to be) in front. */
  get index() { return frontIndex(this.target, this.cards.length); }
  get items(): readonly HTMLElement[] { return this.cards; }

  /** Replace the set of cards (e.g. a filter) and show `index` in front, without travel. */
  setCards(cards: readonly HTMLElement[], index = 0) {
    this.stop();
    for (const card of this.cards) if (!cards.includes(card)) this.clear(card);
    this.cards = [...cards];
    this.position = this.target = wrapIndex(index, this.cards.length);
    this.profile = this.measure();
    this.render();
  }

  goTo(index: number, source: OrbitSource) {
    if (!this.cards.length) return;
    this.travel(shortestTarget(this.position, wrapIndex(index, this.cards.length), this.cards.length), source);
  }

  step(delta: number, source: OrbitSource = 'step') {
    if (this.cards.length < 2) return;
    this.travel(this.target + delta, source);
  }

  /** Jump to the target and stop: used when motion is reduced mid-flight. */
  settle() {
    this.stop();
    this.position = this.target;
    this.render();
  }

  dispose() {
    this.stop();
    cancelAnimationFrame(this.pending);
    this.controller.abort();
    this.resize?.disconnect();
    this.cards.forEach((card) => this.clear(card));
    this.cards = [];
  }

  private travel(target: number, source: OrbitSource) {
    const before = this.index;
    this.target = target;
    if (this.index !== before) this.options.onFront(this.index, source);
    this.animate();
  }

  private animate() {
    this.stop();
    const from = this.position;
    const distance = this.target - from;
    if (this.options.reducedMotion() || Math.abs(distance) < .001) {
      this.position = this.target;
      this.normalize();
      this.render();
      return;
    }
    const duration = tweenDuration(distance);
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      this.position = from + distance * easeOutCubic(progress);
      this.render();
      if (progress < 1) this.tween = requestAnimationFrame(tick);
      else { this.tween = 0; this.normalize(); }
    };
    this.tween = requestAnimationFrame(tick);
  }

  private stop() {
    if (this.tween) cancelAnimationFrame(this.tween);
    this.tween = 0;
  }

  /** Keep positions small after many turns; the visual result is identical. */
  private normalize() {
    const count = this.cards.length;
    if (!count) return;
    const wrapped = wrapIndex(this.target, count);
    const shift = wrapped - this.target;
    this.target = wrapped;
    this.position += shift;
  }

  private schedule() {
    if (this.pending) return;
    this.pending = requestAnimationFrame(() => { this.pending = 0; this.render(); });
  }

  private render() {
    const count = this.cards.length;
    const front = this.index;
    this.cards.forEach((card, index) => {
      const pose = poseFor(index - this.position, count, this.profile, index);
      card.style.transform = poseTransform(pose);
      card.style.opacity = String(pose.opacity);
      card.style.zIndex = String(pose.zIndex);
      card.style.visibility = pose.hidden || pose.opacity < .02 ? 'hidden' : '';
      card.style.setProperty('--prominence', String(pose.prominence));
      card.toggleAttribute('data-front', index === front);
    });
  }

  private clear(card: HTMLElement) {
    for (const property of ['transform', 'opacity', 'z-index', 'visibility', '--prominence']) card.style.removeProperty(property);
    card.removeAttribute('data-front');
  }

  private measure(): OrbitProfile {
    const cardWidth = this.cards.find((card) => card.offsetWidth > 0)?.offsetWidth ?? 0;
    return this.options.profile(this.options.stage.clientWidth, cardWidth);
  }

  private pointerDown(event: PointerEvent) {
    // A second finger never takes over (or restarts) the gesture of the first.
    if (this.cards.length < 2 || !event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
    this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, from: this.position, base: this.target, paged: event.pointerType !== 'mouse', active: false, lastX: event.clientX, lastTime: event.timeStamp, velocity: 0 };
  }

  private pointerMove(event: PointerEvent) {
    const drag = this.drag;
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    if (!drag.active) {
      // Vertical intent belongs to the page scroll (touch-action: pan-y).
      if (Math.abs(dx) < DRAG_THRESHOLD || Math.abs(dx) < Math.abs(event.clientY - drag.y)) return;
      drag.active = true;
      this.stop();
      // A transition still running since the touch began keeps where it got to: the drag
      // continues from what is on screen, never from a stale position.
      drag.from = this.position;
      this.options.onInteract?.();
      try { this.options.stage.setPointerCapture(event.pointerId); } catch { /* pointer already gone */ }
      this.options.stage.dataset.dragging = '';
    }
    const unit = dragUnit(this.profile);
    const elapsed = Math.max(1, event.timeStamp - drag.lastTime);
    drag.velocity = drag.velocity * .4 + (-(event.clientX - drag.lastX) / unit / elapsed) * .6;
    drag.lastX = event.clientX;
    drag.lastTime = event.timeStamp;
    const position = drag.from - dx / unit;
    this.position = drag.paged ? drag.base + resistBeyond(position - drag.base) : position;
    this.schedule();
  }

  private pointerUp(event: PointerEvent, cancelled = false) {
    const drag = this.drag;
    if (!drag || drag.id !== event.pointerId) return;
    this.drag = undefined;
    if (!drag.active) return;
    delete this.options.stage.dataset.dragging;
    this.clickGuard = performance.now() + CLICK_GUARD_MS;
    // A stale gesture (released after resting) carries no throw.
    const velocity = cancelled || event.timeStamp - drag.lastTime > 120 ? 0 : drag.velocity;
    const maxThrow = this.options.maxThrow ?? 3;
    // Touch: one swipe, one photo (forward when the finger went left), never a skipped work.
    // An interrupted gesture (pointercancel) just settles on the nearest photo.
    const target = drag.paged && !cancelled
      ? swipeTarget(this.position, velocity, drag.base, drag.x - event.clientX, SWIPE_DISTANCE, maxThrow)
      : settleTarget(this.position, velocity, maxThrow);
    this.travel(target, 'drag');
  }

  private click(event: MouseEvent) {
    if (performance.now() < this.clickGuard) { this.clickGuard = 0; event.preventDefault(); return; }
    const card = (event.target as Element | null)?.closest<HTMLElement>('[data-orbit-card]');
    const index = card ? this.cards.indexOf(card) : -1;
    if (index < 0) return;
    this.options.onInteract?.();
    if (index === this.index) this.options.onActivate(index, card!);
    else this.goTo(index, 'card');
  }

  private key(event: KeyboardEvent) {
    if (event.target !== this.options.stage) return;
    const moves: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 };
    const delta = moves[event.key];
    if (delta !== undefined) {
      event.preventDefault();
      this.options.onInteract?.();
      this.step(delta, 'key');
    } else if (event.key === 'Enter' || event.key === ' ') {
      const card = this.cards[this.index];
      if (!card) return;
      event.preventDefault();
      this.options.onActivate(this.index, card);
    }
  }
}
