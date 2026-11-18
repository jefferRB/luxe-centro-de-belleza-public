/** Camera direction for «El espacio» (geometry in lib/space-camera.ts, drawing in
 * space-scene.ts). The crown keeps its own navigation; this module only moves the point of
 * view:
 *
 *  - home: mode A, the composition at rest (default). The crown turns by drag as always.
 *  - free: mode B, «Explorar en 3D». Dragging moves the camera around the rings (mouse:
 *    horizontal orbits, vertical changes the angle; touch: horizontal only, the page keeps
 *    its vertical scroll), with weight and moderate inertia, inside a guided orbit.
 *    Predefined viewpoints serve keyboard and touch.
 *  - flight: a designed path is running («Entrar a LUXE», «Ver recorrido», the way back).
 *  - interior: the selected photo in 2D (space-interior.ts).
 *
 * One requestAnimationFrame loop runs only while the camera moves; at rest nothing runs. */
import {
  clampPose, entryKeys, follow, HOME_POSE, matchingViewpoint, orbitBounds, pathDuration, posesClose, returnKeys, rubber, samplePath, tourKeys, viewpoints,
  type CameraPose, type PathKey,
} from '../lib/space-camera';
import type { SpaceInterior, InteriorView } from './space-interior';
import type { SpaceScene } from './space-scene';

export type CameraMode = 'home' | 'free' | 'flight' | 'interior';

export interface SpaceExploreOptions {
  readonly host: HTMLElement;
  /** Where the camera is dragged: the crown and the portal. */
  readonly surface: HTMLElement;
  readonly scene: SpaceScene;
  readonly interior: SpaceInterior;
  readonly explore: HTMLButtonElement;
  readonly enter: HTMLButtonElement;
  readonly demo?: HTMLButtonElement;
  readonly viewpoints: HTMLElement;
  readonly announce: (message: string) => void;
  readonly reducedMotion: () => boolean;
  /** The selected view and a promise for its photo being ready. */
  readonly current: () => number;
  readonly ready: (index: number) => Promise<unknown>;
  readonly describe: (index: number) => InteriorView;
}

interface Drag {
  readonly id: number;
  readonly type: string;
  x: number;
  y: number;
  yaw: number;
  pitch: number;
  active: boolean;
  lastX: number;
  lastY: number;
  lastTime: number;
  velocityYaw: number;
  velocityPitch: number;
}

interface RunningPath {
  readonly keys: readonly PathKey[];
  readonly start: number;
  readonly resolve: (completed: boolean) => void;
}

/** Degrees per px of drag: a full drag across the crown is about one side of the orbit. */
const YAW_PER_PX = .17;
const PITCH_PER_PX = .09;
const DRAG_THRESHOLD = 6;
/** Inertia: deg/ms at most, and its decay (ms). */
const MAX_SPIN = .16;
const INERTIA = 260;
/** The camera's weight: how quickly it catches up with the hand (ms). */
const WEIGHT = 130;
const LABELS = { explore: 'Explorar en 3D', original: 'Volver a la vista original', demo: 'Ver recorrido', stop: 'Detener recorrido' };

export class SpaceExplore {
  private readonly options: SpaceExploreOptions;
  private readonly controller = new AbortController();
  private mode: CameraMode = 'home';
  private pose: CameraPose = HOME_POSE;
  private goal: CameraPose = HOME_POSE;
  private velocity = { yaw: 0, pitch: 0 };
  private drag?: Drag;
  private path?: RunningPath;
  private frame = 0;
  private last = 0;
  private suppressClick = false;
  private demoActive = false;
  private leaving = false;
  private returnTo: { pose: CameraPose; mode: 'home' | 'free' } = { pose: HOME_POSE, mode: 'home' };
  private opener?: HTMLElement;
  private interiorIndex = 0;

  constructor(options: SpaceExploreOptions) {
    this.options = options;
    const { signal } = this.controller;
    const { surface, explore, enter, demo, host } = options;
    explore.addEventListener('click', () => this.toggleExplore(), { signal });
    enter.addEventListener('click', () => { void this.enterLuxe(enter); }, { signal });
    demo?.addEventListener('click', () => { if (this.demoActive) this.stopDemo(); else void this.startDemo(); }, { signal });
    for (const button of options.viewpoints.querySelectorAll<HTMLButtonElement>('[data-viewpoint]')) {
      button.addEventListener('click', () => this.goToViewpoint(button.dataset.viewpoint ?? ''), { signal });
    }
    surface.addEventListener('pointerdown', (event) => this.pointerDown(event), { signal });
    surface.addEventListener('pointermove', (event) => this.pointerMove(event), { signal });
    surface.addEventListener('pointerup', (event) => this.pointerUp(event), { signal });
    surface.addEventListener('pointercancel', (event) => this.pointerUp(event, true), { signal });
    surface.addEventListener('lostpointercapture', (event) => { if (event.target === surface && this.drag?.id === event.pointerId) this.pointerUp(event, true); }, { signal });
    // A drag of the camera that ends over a card or the photo must not also select or open it.
    surface.addEventListener('click', (event) => { if (this.suppressClick) { event.preventDefault(); event.stopPropagation(); } }, { signal, capture: true });
    // The automatic tour stops as soon as the visitor takes over.
    const interrupt = () => { if (this.demoActive) this.stopDemo(); };
    host.addEventListener('pointerdown', (event) => { if (!demo?.contains(event.target as Node)) interrupt(); }, { signal, capture: true });
    addEventListener('wheel', interrupt, { signal, passive: true });
    addEventListener('touchmove', interrupt, { signal, passive: true });
    addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        if (this.demoActive) { event.preventDefault(); this.stopDemo(); }
        else if (this.mode === 'flight' && this.path && !this.leaving) { event.preventDefault(); this.abortEntry(); }
        return;
      }
      if (this.demoActive && !['Tab', 'Shift', 'Control', 'Alt', 'Meta'].includes(event.key) && host.contains(event.target as Node) && event.target !== demo) interrupt();
    }, { signal });
    this.setMode('home');
  }

  get currentMode() { return this.mode; }

  // ——— Modes ———

  private setMode(mode: CameraMode) {
    this.mode = mode;
    const { host, explore, viewpoints: box, demo } = this.options;
    host.dataset.camera = mode;
    const immersive = mode === 'free' || (mode !== 'home' && this.returnTo.mode === 'free');
    (explore.querySelector('[data-space-label]') ?? explore).textContent = immersive ? LABELS.original : LABELS.explore;
    box.hidden = mode !== 'free';
    if (demo) {
      demo.textContent = this.demoActive ? LABELS.stop : LABELS.demo;
      demo.setAttribute('aria-pressed', String(this.demoActive));
    }
    const busy = mode === 'flight' || mode === 'interior';
    // While the camera flies, these wait (clicks are ignored): say so, visually and to AT.
    const mark = (button: HTMLButtonElement, waiting: boolean) => {
      button.toggleAttribute('data-busy', waiting);
      if (waiting) button.setAttribute('aria-disabled', 'true');
      else button.removeAttribute('aria-disabled');
    };
    mark(explore, busy && !this.demoActive);
    mark(this.options.enter, busy);
    this.markViewpoint();
  }

  private get bounds() { return orbitBounds(this.options.scene.orbitWidth); }

  private toggleExplore() {
    if (this.leaving || this.mode === 'interior') return;
    if (this.demoActive) { this.stopDemo(false); this.goHome(); return; }
    if (this.mode === 'flight') return;
    if (this.mode === 'home') this.enterFree();
    else this.goHome();
  }

  /** Mode B: the camera moves away from its place a little; the depth shows. */
  enterFree() {
    this.setMode('free');
    const start = viewpoints(this.bounds).find((point) => point.id === 'frente')!.pose;
    void this.glide(start, 1100);
    this.options.announce('Vista 3D activada. Arrastrá para recorrer la órbita o elegí un punto de vista.');
  }

  /** Back to the composition at rest; the selected view stays. */
  goHome() {
    this.setMode('home');
    void this.glide(HOME_POSE, 1000);
    this.options.announce('Vista original.');
  }

  private goToViewpoint(id: string) {
    if (this.mode !== 'free') return;
    const point = viewpoints(this.bounds).find((candidate) => candidate.id === id);
    if (!point) return;
    void this.glide(point.pose);
    // The chosen viewpoint reads as pressed at once, while the camera travels to it.
    this.markViewpoint(point.id);
    this.options.announce(`Punto de vista: ${point.label}.`);
  }

  /** A view was selected on the crown: in mode B the camera turns back towards the front,
   * where the selected card arrives, softly. */
  onSelect() {
    if (this.mode !== 'free' || this.drag?.active) return;
    if (Math.abs(this.goal.yaw) < 14 && this.goal.pitch < 18) return;
    void this.glide({ yaw: this.goal.yaw * .35, pitch: Math.min(Math.max(this.goal.pitch, 6), 14), distance: .98, dive: 0 }, 950);
  }

  /** The section left the screen: no motion keeps running for nobody. */
  setInView(visible: boolean) {
    if (visible) return;
    if (this.demoActive) this.stopDemo();
    if (!this.path && this.frame) this.settleNow();
  }

  /** Motion was reduced while something moved: finish where it was going. */
  reduceMotion() {
    if (this.demoActive) this.stopDemo();
    if (this.path && this.mode !== 'flight') {
      const target = this.path.keys.at(-1)!.pose;
      this.cancelPath();
      this.goal = target;
    }
    if (!this.path) this.settleNow();
  }

  // ——— «Entrar a LUXE» ———

  async enterLuxe(opener: HTMLElement) {
    if (this.mode === 'flight' || this.mode === 'interior' || this.leaving) return;
    this.cancelPath();
    this.velocity = { yaw: 0, pitch: 0 };
    this.returnTo = { pose: this.mode === 'free' ? clampPose(this.goal, this.bounds) : HOME_POSE, mode: this.mode === 'free' ? 'free' : 'home' };
    this.opener = opener;
    this.interiorIndex = this.options.current();
    this.setMode('flight');
    this.options.announce('Entrando a LUXE.');
    await this.options.ready(this.interiorIndex);
    if (this.options.reducedMotion()) { await this.openInterior(); return; }
    await this.bringIntoView();
    if ((this.mode as CameraMode) !== 'flight') return;
    if (await this.runPath(entryKeys(this.pose, this.aim()))) await this.openInterior();
  }

  /** Escape during the approach: back out the way we came. */
  private abortEntry() {
    this.cancelPath();
    void this.flyBack();
  }

  private async openInterior() {
    this.setMode('interior');
    const { scene, interior, describe, reducedMotion } = this.options;
    await interior.open(describe(this.interiorIndex), scene.photoRect(this.interiorIndex), reducedMotion());
  }

  /** «Volver al mundo LUXE» or Escape: the photo goes back into the portal, the frame and the
   * rings return and the camera recovers its previous place. Nothing reloads. */
  async leaveInterior() {
    if (this.mode !== 'interior' || this.leaving) return;
    this.leaving = true;
    const { scene, interior, reducedMotion } = this.options;
    await interior.close(() => scene.photoRect(this.interiorIndex), reducedMotion());
    await this.flyBack();
    this.leaving = false;
  }

  /** The browser closed the interior by itself: return without the photo's movement. */
  dismissedInterior() {
    if (this.mode !== 'interior' || this.leaving) return;
    this.leaving = true;
    void this.flyBack().then(() => { this.leaving = false; });
  }

  private async flyBack() {
    this.setMode('flight');
    const { pose, mode } = this.returnTo;
    if (this.options.reducedMotion()) this.jump(pose);
    else await this.runPath(returnKeys(this.pose, pose));
    this.goal = this.pose;
    this.setMode(mode);
    this.options.announce(mode === 'free' ? 'De vuelta en el mundo LUXE, vista 3D.' : 'De vuelta en el mundo LUXE.');
    const opener = this.opener && this.opener.isConnected && !this.opener.closest('[hidden]') ? this.opener : this.options.enter;
    opener.focus({ preventScroll: true });
  }

  // ——— «Ver recorrido» ———

  async startDemo() {
    if (this.options.reducedMotion() || this.mode === 'flight' || this.mode === 'interior' || this.leaving) return;
    this.cancelPath();
    this.velocity = { yaw: 0, pitch: 0 };
    this.returnTo = { pose: this.mode === 'free' ? clampPose(this.goal, this.bounds) : HOME_POSE, mode: this.mode === 'free' ? 'free' : 'home' };
    this.opener = this.options.demo;
    this.interiorIndex = this.options.current();
    this.demoActive = true;
    this.setMode('flight');
    this.options.announce('Recorrido en curso. Escape lo detiene.');
    await this.options.ready(this.interiorIndex);
    await this.bringIntoView();
    if (!this.demoActive) return;
    const completed = await this.runPath(tourKeys(this.pose, this.bounds, this.aim()));
    if (!completed || !this.demoActive) return;
    this.demoActive = false;
    await this.openInterior();
  }

  /** Stopped by the visitor: the camera stays where it was, back on the orbit, in mode B. */
  stopDemo(announce = true) {
    if (!this.demoActive) return;
    this.demoActive = false;
    this.cancelPath();
    this.setMode('free');
    const rest = clampPose({ ...this.pose, distance: Math.min(1.02, Math.max(.94, this.pose.distance)), dive: 0 }, this.bounds);
    void this.glide(rest, this.pose.dive > .05 ? 1100 : 700);
    if (announce) this.options.announce('Recorrido detenido. Podés seguir explorando.');
  }

  // ——— Camera motion ———

  /** Aims the dive at where the interior view will rest the photo; returns its distance. */
  private aim() {
    const { scene, interior, describe } = this.options;
    scene.measure();
    return scene.aimAt(interior.predict(describe(this.interiorIndex).item), this.interiorIndex);
  }

  /** The approach starts with the portal on screen (the button may sit below it on phones). */
  private async bringIntoView() {
    const box = this.options.surface.getBoundingClientRect();
    if (box.top >= -40 && box.bottom <= innerHeight + 40) return;
    this.options.surface.scrollIntoView({ block: 'center', behavior: this.options.reducedMotion() ? 'auto' : 'smooth' });
    await new Promise<void>((done) => {
      const timer = window.setTimeout(done, 900);
      addEventListener('scrollend', () => { window.clearTimeout(timer); done(); }, { once: true });
    });
  }

  /** A short designed move between two poses (ease in and out). */
  private glide(to: CameraPose, duration?: number) {
    if (this.options.reducedMotion()) { this.cancelPath(); this.jump(to); return Promise.resolve(true); }
    const span = Math.abs(to.yaw - this.pose.yaw) + Math.abs(to.pitch - this.pose.pitch) + Math.abs(to.distance - this.pose.distance) * 200;
    const length = duration ?? Math.min(1400, Math.max(650, span * 18));
    this.goal = to;
    return this.runPath([{ at: 0, pose: this.pose }, { at: length, pose: to }]);
  }

  private jump(pose: CameraPose) {
    this.pose = this.goal = pose;
    this.options.scene.setPose(pose);
    this.markViewpoint();
  }

  private runPath(keys: readonly PathKey[]): Promise<boolean> {
    this.cancelPath();
    return new Promise((resolve) => {
      this.path = { keys, start: performance.now(), resolve };
      this.markViewpoint();
      this.kick();
    });
  }

  private cancelPath() {
    const path = this.path;
    this.path = undefined;
    path?.resolve(false);
  }

  private kick() {
    this.options.host.toggleAttribute('data-camera-moving', true);
    if (this.frame) return;
    this.last = performance.now();
    this.frame = requestAnimationFrame(this.tick);
  }

  private settleNow() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.velocity = { yaw: 0, pitch: 0 };
    this.jump(clampPose(this.goal, this.bounds));
    this.options.host.removeAttribute('data-camera-moving');
  }

  private readonly tick = () => {
    // One clock for paths and frames (the rAF timestamp may run on another timeline).
    const now = performance.now();
    this.frame = 0;
    const elapsed = Math.min(64, Math.max(0, now - this.last));
    this.last = now;
    const { scene, host } = this.options;
    if (this.path) {
      const path = this.path;
      const time = now - path.start;
      this.pose = samplePath(path.keys, time);
      scene.setPose(this.pose);
      if (time >= pathDuration(path.keys)) {
        this.path = undefined;
        this.goal = this.pose;
        path.resolve(true);
        host.removeAttribute('data-camera-moving');
        this.markViewpoint();
      } else {
        this.frame = requestAnimationFrame(this.tick);
      }
      return;
    }
    const bounds = this.bounds;
    if (!this.drag?.active) {
      // Inertia, then a soft return inside the orbit if a throw went past its limits.
      if (Math.abs(this.velocity.yaw) > .0005 || Math.abs(this.velocity.pitch) > .0005) {
        this.goal = { ...this.goal, yaw: rubber(this.goal.yaw + this.velocity.yaw * elapsed, bounds.yaw[0], bounds.yaw[1]), pitch: rubber(this.goal.pitch + this.velocity.pitch * elapsed, bounds.pitch[0], bounds.pitch[1]) };
        const decay = Math.exp(-elapsed / INERTIA);
        this.velocity = { yaw: this.velocity.yaw * decay, pitch: this.velocity.pitch * decay };
      } else {
        this.velocity = { yaw: 0, pitch: 0 };
      }
      const inside = clampPose(this.goal, bounds);
      if (!posesClose(inside, this.goal, .001)) {
        this.goal = follow(this.goal, inside, elapsed, 110);
        if (Math.sign(this.velocity.yaw) === Math.sign(this.goal.yaw)) this.velocity = { ...this.velocity, yaw: this.velocity.yaw * .6 };
      }
    }
    this.pose = follow(this.pose, this.goal, elapsed, this.options.reducedMotion() ? 0 : WEIGHT);
    scene.setPose(this.pose);
    const still = !this.drag?.active && this.velocity.yaw === 0 && this.velocity.pitch === 0 && posesClose(this.pose, this.goal) && posesClose(clampPose(this.goal, bounds), this.goal, .001);
    if (still) {
      this.jump(this.goal);
      host.removeAttribute('data-camera-moving');
      return;
    }
    this.frame = requestAnimationFrame(this.tick);
  };

  private markViewpoint(heading?: string) {
    const match = heading ?? (this.mode === 'free' && !this.path ? matchingViewpoint(this.pose, viewpoints(this.bounds)) : undefined);
    for (const button of this.options.viewpoints.querySelectorAll<HTMLButtonElement>('[data-viewpoint]')) {
      button.setAttribute('aria-pressed', String(button.dataset.viewpoint === match));
    }
  }

  // ——— Drag ———

  private pointerDown(event: PointerEvent) {
    if (this.mode !== 'free' || (event.pointerType === 'mouse' && event.button !== 0)) return;
    if ((event.target as Element).closest('button')) return;
    this.drag = { id: event.pointerId, type: event.pointerType, x: event.clientX, y: event.clientY, yaw: this.goal.yaw, pitch: this.goal.pitch, active: false, lastX: event.clientX, lastY: event.clientY, lastTime: event.timeStamp, velocityYaw: 0, velocityPitch: 0 };
  }

  private pointerMove(event: PointerEvent) {
    const drag = this.drag;
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.active) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      // On touch, vertical intent belongs to the page: it scrolls (touch-action: pan-y).
      if (drag.type !== 'mouse' && Math.abs(dx) < Math.abs(dy)) { this.drag = undefined; return; }
      drag.active = true;
      this.cancelPath();
      // Continue from where the camera is, not from where a glide was heading.
      this.goal = this.pose;
      drag.yaw = this.pose.yaw;
      drag.pitch = this.pose.pitch;
      drag.x = event.clientX;
      drag.y = event.clientY;
      this.velocity = { yaw: 0, pitch: 0 };
      try { this.options.surface.setPointerCapture(event.pointerId); } catch { /* pointer already gone */ }
      this.options.host.toggleAttribute('data-camera-dragging', true);
      this.markViewpoint();
      this.kick();
      return;
    }
    const bounds = this.bounds;
    // Grab the installation: dragging right turns it right (the camera moves left).
    const yaw = rubber(drag.yaw - (event.clientX - drag.x) * YAW_PER_PX, bounds.yaw[0], bounds.yaw[1]);
    const pitch = drag.type === 'mouse' ? rubber(drag.pitch + (event.clientY - drag.y) * PITCH_PER_PX, bounds.pitch[0], bounds.pitch[1]) : this.goal.pitch;
    const time = Math.max(1, event.timeStamp - drag.lastTime);
    drag.velocityYaw = drag.velocityYaw * .4 + ((yaw - this.goal.yaw) / time) * .6;
    drag.velocityPitch = drag.velocityPitch * .4 + ((pitch - this.goal.pitch) / time) * .6;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    drag.lastTime = event.timeStamp;
    this.goal = { ...this.goal, yaw, pitch };
    this.kick();
  }

  private pointerUp(event: PointerEvent, cancelled = false) {
    const drag = this.drag;
    if (!drag || drag.id !== event.pointerId) return;
    this.drag = undefined;
    if (!drag.active) return;
    this.options.host.removeAttribute('data-camera-dragging');
    this.suppressClick = true;
    window.setTimeout(() => { this.suppressClick = false; }, 0);
    const resting = cancelled || event.timeStamp - drag.lastTime > 110;
    const limit = (value: number) => Math.max(-MAX_SPIN, Math.min(MAX_SPIN, value));
    this.velocity = resting || this.options.reducedMotion() ? { yaw: 0, pitch: 0 } : { yaw: limit(drag.velocityYaw), pitch: limit(drag.velocityPitch) * .6 };
    this.kick();
  }

  dispose() {
    this.controller.abort();
    this.demoActive = false;
    this.cancelPath();
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    const { host, explore, viewpoints: box, demo } = this.options;
    for (const name of ['data-camera', 'data-camera-moving', 'data-camera-dragging']) host.removeAttribute(name);
    for (const button of [explore, this.options.enter]) { button.removeAttribute('data-busy'); button.removeAttribute('aria-disabled'); }
    (explore.querySelector('[data-space-label]') ?? explore).textContent = LABELS.explore;
    if (demo) { demo.textContent = LABELS.demo; demo.removeAttribute('aria-pressed'); }
    box.hidden = true;
  }
}
