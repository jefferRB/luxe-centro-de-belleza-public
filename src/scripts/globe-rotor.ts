/** Rotation control for the Mundo LUXE globe: the whole sculpture turns as one object (a
 * single `matrix3d` on the rotor); panels — photos and clips alike — keep their places on
 * the sphere. The orientation is a unit quaternion (lib/quaternion.ts): every input — drag,
 * inertia, keys — is a small screen-space turn composed onto it, so the globe rolls freely
 * in any direction, through the poles and past full turns, without clamps, gimbal lock or
 * flips. Choosing a piece slerps to the orientation that shows it upright in front. While
 * nobody interacts, a barely perceptible sway (a few degrees, never a spin) keeps the world
 * alive without carrying the chosen piece away. This file only owns time, input and DOM writes. */
import { angleBetween, fromYawPitch, rotateVector, screenTurn, slerp, toMatrix3d, turn, type Quat } from '../lib/quaternion';
import { clamp, decay, shadeFor, toVector, type Orientation, type SpherePoint } from '../lib/sphere';

export interface GlobeRotorOptions {
  readonly stage: HTMLElement;
  readonly rotor: HTMLElement;
  readonly panels: readonly HTMLElement[];
  readonly initial: Orientation;
  readonly reducedMotion: () => boolean;
  /** A tap or click on a panel that was not a drag. */
  readonly onPanel: (panel: HTMLElement) => void;
  /** The visitor took control (drag, keys, buttons): owners stop competing animations. */
  readonly onInteract?: () => void;
  /** After every paint: depths (z of each panel's normal, 1 = facing the visitor) are fresh. */
  readonly onRender?: () => void;
  /** A drag (and its inertia) came to rest: the owner may settle on the piece in front. */
  readonly onRest?: () => void;
}

const DRAG_THRESHOLD = 6;
/** Ambient sway: ±4.5° sideways and ±1.8° in tilt over long, unrelated periods; it fades in. */
const SWAY_YAW = 4.5;
const SWAY_PITCH = 1.8;
const SWAY_FADE_MS = 3_000;
const IDLE_DELAY_MS = 4_000;
const STOP_SPEED = .003;
const MAX_THROW = .9; // deg per ms
/** The click a gesture's release may still produce (on touch it can arrive a moment after
 * pointerup, in a task of its own) is swallowed within this window; one click at most. */
const CLICK_GUARD_MS = 300;
const ease = (t: number) => 1 - (1 - clamp(t, 0, 1)) ** 3;

/** `caught`: the finger landed on a globe still coasting and stopped it there. */
interface Drag { id: number; x: number; y: number; active: boolean; caught: boolean; lastX: number; lastY: number; lastTime: number; vx: number; vy: number }

export class GlobeRotor {
  private readonly options: GlobeRotorOptions;
  private readonly controller = new AbortController();
  private readonly vectors: readonly (readonly [number, number, number])[];
  private readonly shades: number[];
  private readonly depths: number[];
  private orientation: Quat;
  /** Start of the current sway (undefined: no sway applied). */
  private swayStart?: number;
  private shown: Quat;
  private restPending = false;
  /** Screen-space angular velocity (deg/ms): x turns about the vertical axis, y about the horizontal. */
  private velocity = { x: 0, y: 0 };
  private tween?: { from: Quat; to: Quat; start: number; duration: number };
  private frame = 0;
  private last = 0;
  private drag?: Drag;
  private clickGuard = 0;
  private idleAllowed = false;
  private visible = false;
  private lastInput = -Infinity;
  private readonly visibility?: IntersectionObserver;

  constructor(options: GlobeRotorOptions) {
    this.options = options;
    this.orientation = fromYawPitch(options.initial.yaw, options.initial.pitch);
    this.vectors = options.panels.map((panel) => toVector({ lat: Number(panel.dataset.lat) || 0, lon: Number(panel.dataset.lon) || 0 }));
    this.shades = this.vectors.map(() => -1);
    this.depths = this.vectors.map(() => 0);
    this.shown = this.orientation;
    const { stage } = options;
    const { signal } = this.controller;
    stage.addEventListener('pointerdown', (event) => this.pointerDown(event), { signal });
    stage.addEventListener('pointermove', (event) => this.pointerMove(event), { signal });
    stage.addEventListener('pointerup', (event) => this.pointerUp(event), { signal });
    stage.addEventListener('pointercancel', (event) => this.pointerUp(event, true), { signal });
    // Only the stage's own capture counts: on touch the piece under the finger holds an implicit
    // capture, and its lostpointercapture (bubbling up when the stage takes over) is not the end.
    stage.addEventListener('lostpointercapture', (event) => { if (event.target === stage && this.drag?.active && this.drag.id === event.pointerId) this.pointerUp(event, true); }, { signal });
    // touch-action (CSS) already keeps the page still under a finger on the world. This is the
    // guarantee should a browser miss it over the 3D-transformed pieces (older WebKit): one
    // finger that started on the globe never scrolls the page. Two fingers still pinch.
    stage.addEventListener('touchmove', (event) => { if (event.cancelable && event.touches.length === 1) event.preventDefault(); }, { signal, passive: false });
    stage.addEventListener('click', (event) => this.click(event), { signal });
    stage.addEventListener('dragstart', (event) => event.preventDefault(), { signal });
    document.addEventListener('visibilitychange', () => this.schedule(), { signal });
    if ('IntersectionObserver' in window) {
      this.visibility = new IntersectionObserver((records) => {
        this.visible = records.some((record) => record.isIntersecting);
        this.schedule();
        this.options.onRender?.();
      });
      this.visibility.observe(stage);
    }
    this.render();
  }

  /** Ambient sway while nobody interacts. Off by default; the owner decides when it is allowed. */
  setIdle(allowed: boolean) {
    if (!allowed) this.bake();
    this.idleAllowed = allowed;
    this.schedule();
  }

  /** Whether the section is on screen (from the rotor's own observer). */
  get onScreen() { return this.visible; }

  /** Depth of panel `index` as last painted: 1 in front, 0 on the silhouette, −1 behind. */
  depth(index: number): number { return this.depths[index] ?? -1; }

  /** Bring a point of the sphere to the front, upright, by the shortest arc. */
  face(point: SpherePoint) {
    this.travelTo(fromYawPitch(-point.lon, -point.lat));
  }

  /** Keyboard and button steps, in screen terms: as if dragging right by `x`° and down by `y`°. */
  nudge(x: number, y: number) {
    this.interact();
    const from = this.tween?.to ?? this.orientation;
    this.travelTo(turn(from, screenTurn(x, y)));
  }

  /** Stop every motion now, keeping the current orientation (e.g. reduced motion turned on). */
  settle() {
    if (this.tween) this.orientation = this.tween.to;
    this.tween = undefined;
    this.velocity = { x: 0, y: 0 };
    this.render();
  }

  dispose() {
    this.restPending = false;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.controller.abort();
    this.visibility?.disconnect();
  }

  /** Folds the sway into the orientation, so stopping it never makes the globe jump. */
  private bake() {
    if (this.swayStart === undefined) return;
    this.orientation = this.shown;
    this.swayStart = undefined;
  }

  private sway(now: number): Quat | undefined {
    if (this.swayStart === undefined) return undefined;
    const elapsed = now - this.swayStart;
    const amount = clamp(elapsed / SWAY_FADE_MS, 0, 1);
    // Both terms start at 0: the sway begins exactly where the globe rests.
    return screenTurn(amount * SWAY_YAW * Math.sin((elapsed / 15_000) * Math.PI * 2), amount * SWAY_PITCH * Math.sin((elapsed / 23_000) * Math.PI * 2));
  }

  private travelTo(target: Quat) {
    this.bake();
    this.velocity = { x: 0, y: 0 };
    if (this.options.reducedMotion()) {
      this.tween = undefined;
      this.orientation = target;
      this.render();
      return;
    }
    const distance = angleBetween(this.orientation, target);
    this.tween = { from: this.orientation, to: target, start: performance.now(), duration: clamp(420 + distance * 4, 480, 1_100) };
    this.schedule();
  }

  private interact() {
    this.bake();
    this.lastInput = performance.now();
    this.options.onInteract?.();
  }

  private idleWanted() {
    return this.idleAllowed && this.visible && document.visibilityState === 'visible' && !this.options.reducedMotion();
  }

  private coasting() {
    return Math.abs(this.velocity.x) > STOP_SPEED || Math.abs(this.velocity.y) > STOP_SPEED;
  }

  /** One rAF loop, alive only while something moves (or the idle drift is due). */
  private schedule() {
    if (this.frame) return;
    if (!this.idleWanted()) this.bake();
    if (!this.tween && !this.drag?.active && !this.coasting() && !this.idleWanted()) return;
    this.last = performance.now();
    this.frame = requestAnimationFrame((now) => this.tick(now));
  }

  private tick(now: number) {
    this.frame = 0;
    const elapsed = Math.min(64, now - this.last);
    this.last = now;
    let moved = false;
    if (this.tween) {
      const { from, to, start, duration } = this.tween;
      this.orientation = slerp(from, to, ease((now - start) / duration));
      if (now - start >= duration) { this.orientation = to; this.tween = undefined; }
      moved = true;
    } else if (!this.drag?.active && this.coasting()) {
      // Inertia: the throw decays smoothly and stops; it never keeps spinning.
      this.orientation = turn(this.orientation, screenTurn(this.velocity.x * elapsed, this.velocity.y * elapsed));
      this.velocity = { x: decay(this.velocity.x, elapsed), y: decay(this.velocity.y, elapsed) };
      if (!this.coasting()) this.velocity = { x: 0, y: 0 };
      moved = true;
    } else if (!this.drag?.active && this.idleWanted() && now - this.lastInput > IDLE_DELAY_MS) {
      this.swayStart ??= now;
      moved = true;
    } else if (this.drag?.active) {
      moved = true;
    }
    if (moved) this.render(now);
    if (this.restPending && !this.drag && !this.coasting() && !this.tween) {
      this.restPending = false;
      this.options.onRest?.();
    }
    if (this.tween || this.drag?.active || this.coasting() || this.idleWanted()) {
      this.last = now;
      this.frame = requestAnimationFrame((next) => this.tick(next));
    }
  }

  /** One transform for the whole globe, plus depth shading where it actually changed. */
  private render(now = performance.now()) {
    const sway = this.sway(now);
    this.shown = sway ? turn(this.orientation, sway) : this.orientation;
    this.options.rotor.style.transform = toMatrix3d(this.shown);
    this.options.panels.forEach((panel, index) => {
      const depth = rotateVector(this.shown, this.vectors[index]!)[2];
      this.depths[index] = depth;
      const shade = shadeFor(depth);
      if (Math.abs(shade - this.shades[index]!) < .01) return;
      this.shades[index] = shade;
      panel.style.setProperty('--shade', String(shade));
    });
    this.options.onRender?.();
  }

  private pointerDown(event: PointerEvent) {
    // A second finger never takes over (or restarts) the gesture of the first.
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
    // A finger landing on a world that still coasts catches it, as a hand would: it stops right
    // there, and that touch is a catch, not a tap on the piece beneath it.
    const caught = event.pointerType !== 'mouse' && this.coasting();
    if (caught) {
      this.velocity = { x: 0, y: 0 };
      this.interact();
    }
    this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, active: false, caught, lastX: event.clientX, lastY: event.clientY, lastTime: event.timeStamp, vx: 0, vy: 0 };
  }

  private pointerMove(event: PointerEvent) {
    const drag = this.drag;
    if (!drag || drag.id !== event.pointerId) return;
    if (!drag.active) {
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < DRAG_THRESHOLD) return;
      drag.active = true;
      this.tween = undefined;
      this.velocity = { x: 0, y: 0 };
      this.interact();
      try { this.options.stage.setPointerCapture(event.pointerId); } catch { /* pointer already gone */ }
      this.options.stage.dataset.dragging = '';
    }
    // Degrees per pixel scale with the globe: one stage width ≈ 200° of turn.
    const sensitivity = 200 / Math.max(240, this.options.stage.clientWidth);
    const dx = (event.clientX - drag.lastX) * sensitivity;
    const dy = (event.clientY - drag.lastY) * sensitivity;
    const elapsed = Math.max(1, event.timeStamp - drag.lastTime);
    drag.vx = drag.vx * .35 + (dx / elapsed) * .65;
    drag.vy = drag.vy * .35 + (dy / elapsed) * .65;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    drag.lastTime = event.timeStamp;
    // Incremental, in screen space: the globe follows the finger whatever its current orientation.
    this.orientation = turn(this.orientation, screenTurn(dx, dy));
    this.schedule();
  }

  private pointerUp(event: PointerEvent, cancelled = false) {
    const drag = this.drag;
    if (!drag || drag.id !== event.pointerId) return;
    this.drag = undefined;
    if (!drag.active) {
      // Lifted after a catch without turning: the world rests where it was stopped.
      if (drag.caught) {
        this.clickGuard = performance.now() + CLICK_GUARD_MS;
        this.lastInput = performance.now();
        this.restPending = false;
        this.options.onRest?.();
      }
      return;
    }
    delete this.options.stage.dataset.dragging;
    // The last move may still be waiting for its frame: paint the released orientation now.
    this.render();
    this.clickGuard = performance.now() + CLICK_GUARD_MS;
    this.lastInput = performance.now();
    // A gesture that rested before release carries no throw; reduced motion never coasts.
    const fresh = !cancelled && event.timeStamp - drag.lastTime < 90 && !this.options.reducedMotion();
    this.velocity = fresh ? { x: clamp(drag.vx, -MAX_THROW, MAX_THROW), y: clamp(drag.vy, -MAX_THROW, MAX_THROW) } : { x: 0, y: 0 };
    this.restPending = true;
    if (this.coasting()) this.schedule();
    else { this.velocity = { x: 0, y: 0 }; this.restPending = false; this.options.onRest?.(); }
  }

  private click(event: MouseEvent) {
    if (performance.now() < this.clickGuard) { this.clickGuard = 0; event.preventDefault(); return; }
    const panel = (event.target as Element | null)?.closest<HTMLElement>('[data-globe-panel]');
    if (!panel || panel.dataset.kind === 'facet') return;
    this.interact();
    this.options.onPanel(panel);
  }
}
