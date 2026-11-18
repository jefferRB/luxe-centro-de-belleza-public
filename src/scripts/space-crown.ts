/** Controller for the «El espacio» crown: turns the ring of view cards (geometry in
 * lib/space-orbit.ts) by drag, buttons, keys or a card click. Positions are unbounded
 * (the ring has no ends); the front card is always the position wrapped to the count.
 * The DOM is written at most once per animation frame and nothing runs while idle. */
import { easeOutCubic, frontIndex, settleTarget, shortestTarget, tweenDuration } from '../lib/orbit-layout';
import { wrapIndex } from '../lib/showcase-state';
import { crownDragUnit, crownPose, crownStyle, DEFAULT_CROWN, type CrownProfile } from '../lib/space-orbit';

export type CrownSource = 'drag' | 'step' | 'key' | 'card';

export interface SpaceCrownOptions {
  /** Receives the drag gesture: the whole crown band, not only the cards. */
  readonly stage: HTMLElement;
  readonly cards: readonly HTMLElement[];
  /** The ring whose half width is the horizontal radius (drag speed follows it). */
  readonly ring: HTMLElement;
  /** A new view reached the front and stays there: photo and copy follow. */
  readonly onFront: (index: number, source: CrownSource) => void;
  /** Any direct manipulation (cancels an entrance, hides hints). */
  readonly onInteract?: () => void;
  readonly reducedMotion: () => boolean;
  /** Whether a drag may turn the crown (in the immersive mode a drag moves the camera). */
  readonly dragEnabled?: () => boolean;
  /** Called after each pose is written: a camera renderer projects the cards from here. */
  readonly onRender?: (position: number) => void;
}

interface DragState {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly from: number;
  active: boolean;
  lastX: number;
  lastTime: number;
  velocity: number;
}

const DRAG_THRESHOLD = 8;
/** Most views one throw can travel: inertia that helps, never a spin. */
const MAX_THROW = 2;

export class SpaceCrown {
  private readonly options: SpaceCrownOptions;
  private readonly controller = new AbortController();
  private readonly resize?: ResizeObserver;
  private profile: CrownProfile = DEFAULT_CROWN;
  private unit = 64;
  private position = 0;
  private target = 0;
  private tween = 0;
  private pending = 0;
  private drag?: DragState;
  private suppressClick = false;

  constructor(options: SpaceCrownOptions) {
    this.options = options;
    const { stage } = options;
    const { signal } = this.controller;
    stage.addEventListener('pointerdown', (event) => this.pointerDown(event), { signal });
    stage.addEventListener('pointermove', (event) => this.pointerMove(event), { signal });
    stage.addEventListener('pointerup', (event) => this.pointerUp(event), { signal });
    stage.addEventListener('pointercancel', (event) => this.pointerUp(event, true), { signal });
    // Only the band's own capture counts: on touch the card holds an implicit capture, and its
    // lostpointercapture (bubbling up when the band takes over) is not the end of the gesture.
    stage.addEventListener('lostpointercapture', (event) => { if (event.target === stage && this.drag?.id === event.pointerId) this.pointerUp(event, true); }, { signal });
    // Capture: a drag that ends over a card must not also select it.
    stage.addEventListener('click', (event) => this.click(event), { signal, capture: true });
    stage.addEventListener('dragstart', (event) => event.preventDefault(), { signal });
    this.measure();
    if (typeof ResizeObserver === 'function') {
      this.resize = new ResizeObserver(() => this.measure());
      this.resize.observe(stage);
    }
    this.render();
  }

  get count() { return this.options.cards.length; }
  /** The depth profile read from CSS for the current breakpoint. */
  get currentProfile(): CrownProfile { return this.profile; }
  /** The view that is (or is about to be) in front. */
  get index() { return frontIndex(this.target, this.count); }

  goTo(index: number, source: CrownSource) {
    if (!this.count) return;
    this.travel(shortestTarget(this.position, wrapIndex(index, this.count), this.count), source);
  }

  step(delta: number, source: CrownSource = 'step') {
    if (this.count < 2) return;
    this.travel(this.target + delta, source);
  }

  /** Entrance: the ring turns into place from a little way back, without changing the
   * selection. Any input during it simply retargets. */
  enter(from = -.9, duration = 1300) {
    if (this.count < 2 || this.options.reducedMotion()) return;
    this.position = this.target + from;
    this.animate(duration);
  }

  /** Jump to the target and stop (motion reduced mid-flight). */
  settle() {
    this.stop();
    this.position = this.target;
    this.normalize();
    this.render();
  }

  dispose() {
    this.stop();
    cancelAnimationFrame(this.pending);
    this.pending = 0;
    this.controller.abort();
    this.resize?.disconnect();
    delete this.options.stage.dataset.dragging;
    // Back to the server's composition: the first view in front.
    this.position = this.target = 0;
    this.render();
  }

  private travel(target: number, source: CrownSource) {
    const before = this.index;
    this.target = target;
    if (this.index !== before) this.options.onFront(this.index, source);
    this.animate();
  }

  private animate(duration?: number) {
    this.stop();
    const from = this.position;
    const distance = this.target - from;
    if (this.options.reducedMotion() || Math.abs(distance) < .001) {
      this.position = this.target;
      this.normalize();
      this.render();
      return;
    }
    const length = duration ?? tweenDuration(distance, 560, 110, 1000);
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / length);
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

  /** Keep numbers small after many turns; the picture is identical. */
  private normalize() {
    if (!this.count) return;
    const wrapped = wrapIndex(this.target, this.count);
    const shift = wrapped - this.target;
    this.target = wrapped;
    this.position += shift;
  }

  private schedule() {
    if (this.pending) return;
    this.pending = requestAnimationFrame(() => { this.pending = 0; this.render(); });
  }

  private render() {
    const { cards } = this.options;
    const front = frontIndex(this.position, this.count);
    cards.forEach((card, index) => {
      const style = crownStyle(crownPose(index - this.position, this.count, this.profile));
      for (const [name, value] of Object.entries(style)) card.style.setProperty(name, value);
      card.toggleAttribute('data-front', index === front);
    });
    this.options.onRender?.(this.position);
  }

  /** Radius and depth profile come from CSS, so each breakpoint owns its composition. */
  private measure() {
    const radius = this.options.ring.offsetWidth / 2;
    this.unit = crownDragUnit(radius, this.count);
    const style = getComputedStyle(this.options.stage);
    const read = (name: string, fallback: number) => {
      const value = Number.parseFloat(style.getPropertyValue(name));
      return Number.isFinite(value) ? value : fallback;
    };
    const next: CrownProfile = {
      backScale: read('--crown-back-scale', DEFAULT_CROWN.backScale),
      backOpacity: read('--crown-back-opacity', DEFAULT_CROWN.backOpacity),
      facing: read('--crown-facing', DEFAULT_CROWN.facing),
    };
    const changed = next.backScale !== this.profile.backScale || next.backOpacity !== this.profile.backOpacity || next.facing !== this.profile.facing;
    this.profile = next;
    if (changed) this.schedule();
  }

  private pointerDown(event: PointerEvent) {
    if (this.count < 2 || (event.pointerType === 'mouse' && event.button !== 0)) return;
    if (this.options.dragEnabled && !this.options.dragEnabled()) return;
    this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, from: this.position, active: false, lastX: event.clientX, lastTime: event.timeStamp, velocity: 0 };
  }

  private pointerMove(event: PointerEvent) {
    const drag = this.drag;
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    if (!drag.active) {
      // Vertical intent belongs to the page (touch-action: pan-y keeps scrolling native).
      if (Math.abs(dx) < DRAG_THRESHOLD || Math.abs(dx) < Math.abs(event.clientY - drag.y)) return;
      drag.active = true;
      this.stop();
      this.options.onInteract?.();
      try { this.options.stage.setPointerCapture(event.pointerId); } catch { /* pointer already gone */ }
      this.options.stage.dataset.dragging = '';
    }
    const elapsed = Math.max(1, event.timeStamp - drag.lastTime);
    drag.velocity = drag.velocity * .4 + (-(event.clientX - drag.lastX) / this.unit / elapsed) * .6;
    drag.lastX = event.clientX;
    drag.lastTime = event.timeStamp;
    this.position = drag.from - dx / this.unit;
    this.schedule();
  }

  private pointerUp(event: PointerEvent, cancelled = false) {
    const drag = this.drag;
    if (!drag || drag.id !== event.pointerId) return;
    this.drag = undefined;
    if (!drag.active) return;
    delete this.options.stage.dataset.dragging;
    this.suppressClick = true;
    window.setTimeout(() => { this.suppressClick = false; }, 0);
    // A gesture released after resting carries no throw.
    const velocity = cancelled || event.timeStamp - drag.lastTime > 120 ? 0 : drag.velocity;
    this.travel(settleTarget(this.position, velocity, MAX_THROW, 160), 'drag');
  }

  private click(event: MouseEvent) {
    if (this.suppressClick) { event.preventDefault(); event.stopPropagation(); return; }
    const card = (event.target as Element | null)?.closest<HTMLElement>('[data-tour-thumb]');
    const index = card ? this.options.cards.indexOf(card) : -1;
    if (index < 0) return;
    this.options.onInteract?.();
    if (index !== this.index) this.goTo(index, 'card');
  }
}
