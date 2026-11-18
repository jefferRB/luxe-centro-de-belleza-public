/** Pure geometry for the works crown (no DOM): the current photo in front and its
 * neighbours curving away on a circular arc. Positions are in item units: the card whose
 * offset is 0 faces the visitor. Only transform/opacity values come out. */

import { wrapIndex } from './showcase-state.ts';

export interface OrbitProfile {
  /** Degrees between neighbours on the arc. */
  readonly step: number;
  /** Orbit radius in px. */
  readonly radius: number;
  /** 0 = every card faces the visitor, 1 = cards turn fully with the arc. */
  readonly facing: number;
  /** Vertical rise (px) of the cards furthest back: the crown silhouette. */
  readonly lift: number;
  /** Deterministic vertical scatter (px) for cards away from the front: depth, not noise. */
  readonly scatter: number;
  /** Widest offset still shown. */
  readonly reach: number;
  /** Opacity of the card furthest back. */
  readonly backOpacity: number;
  /** Extra scale of the card exactly in front (0 = none), easing off within one step. */
  readonly focusScale: number;
}

export interface Pose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly rotateY: number;
  readonly scale: number;
  readonly opacity: number;
  readonly zIndex: number;
  /** 0 at the back, 1 in front: drives dimming and pointer availability. */
  readonly prominence: number;
  readonly hidden: boolean;
}

const SCATTER_PATTERN = [0, -.62, .48, -.3, .85, -.9, .35, .7, -.45, .2, -.75, .55] as const;
const round = (value: number, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor || 0;
};
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Signed distance from the front, wrapped into [-count/2, count/2). */
export function wrapOffset(offset: number, count: number): number {
  if (!Number.isFinite(offset) || count <= 0) return 0;
  const half = count / 2;
  return ((((offset + half) % count) + count) % count) - half;
}

/** A position equivalent to `index`, reached from `from` by the shortest way round. */
export function shortestTarget(from: number, index: number, count: number): number {
  return from + wrapOffset(index - from, count);
}

/** The item at the front for a (possibly fractional, unwrapped) position. */
export function frontIndex(position: number, count: number): number {
  return wrapIndex(Math.round(position), count);
}

/** Where a released drag settles: the throw adds momentum, capped so one gesture never spins away. */
export function settleTarget(position: number, velocity: number, maxSteps = 3, momentum = 180): number {
  const projected = position + clamp(velocity * momentum, -maxSteps, maxSteps);
  return Math.round(projected);
}

/** Touch paging, one swipe = one item: within `limit` items of where the gesture began the
 * crown follows the finger 1:1; beyond, ever more slowly, never more than `give` further, so
 * what the finger shows is where the swipe lands. Continuous, with slope 1 at the limit. */
export function resistBeyond(offset: number, limit = 1, give = .25): number {
  const beyond = Math.abs(offset) - limit;
  if (beyond <= 0) return offset;
  return Math.sign(offset) * (limit + give * (1 - 1 / (1 + beyond / give)));
}

/** Where a touch swipe settles: the throw decides as in settleTarget; a deliberate swipe
 * (`travel` px forward or back, at least `minTravel`, not reversed at release) always reaches
 * the neighbour in its direction; and nothing lands further than one item from `base`. */
export function swipeTarget(position: number, velocity: number, base: number, travel: number, minTravel: number, maxSteps = 3, momentum = 180): number {
  let target = settleTarget(position, velocity, maxSteps, momentum);
  const direction = Math.sign(travel);
  if (target === base && Math.abs(travel) >= minTravel && velocity * direction >= 0) target = base + direction;
  return clamp(target, base - 1, base + 1) || 0; // never −0
}

export function poseFor(offset: number, count: number, profile: OrbitProfile, seed = 0): Pose {
  // Circular: the last work sits just before the first one.
  const distance = wrapOffset(offset, count);
  const angle = distance * profile.step;
  const radians = (angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const prominence = (cos + 1) / 2;
  const beyond = Math.abs(distance) - profile.reach;
  const edge = clamp(1 - beyond * 2, 0, 1);
  const hidden = count < 1 || edge <= 0;
  const scatter = (SCATTER_PATTERN[seed % SCATTER_PATTERN.length] ?? 0) * profile.scatter * (1 - prominence);
  return {
    x: round(Math.sin(radians) * profile.radius),
    y: round(-profile.lift * (1 - prominence) + scatter),
    z: round((cos - 1) * profile.radius),
    rotateY: round(-angle * profile.facing),
    scale: round(1 + profile.focusScale * Math.max(0, 1 - Math.abs(distance)), 3),
    opacity: hidden ? 0 : round((profile.backOpacity + (1 - profile.backOpacity) * prominence) * edge, 3),
    zIndex: Math.round(prominence * 100),
    prominence: round(prominence, 3),
    hidden,
  };
}

export const poseTransform = (pose: Pose) => `translate3d(${pose.x}px, ${pose.y}px, ${pose.z}px) rotateY(${pose.rotateY}deg) scale(${pose.scale})`;

/** Pixels of horizontal drag that move the orbit by one item (its arc length on screen). */
export function dragUnit(profile: OrbitProfile): number {
  return Math.max(48, (profile.radius * profile.step * Math.PI) / 180);
}

/** Ease-out used by both the drag release and button navigation. */
export const easeOutCubic = (t: number) => 1 - (1 - clamp(t, 0, 1)) ** 3;

/** Tween length grows with the distance travelled, within a calm, brief range. */
export function tweenDuration(distance: number, base = 520, perStep = 120, max = 980): number {
  return Math.round(Math.min(max, base + Math.max(0, Math.abs(distance) - 1) * perStep));
}
