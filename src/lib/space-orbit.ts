/** Pure geometry for the «El espacio» crown (no DOM): the views ride one ellipse seen
 * slightly from above, like a ring of Saturn around the portal. Offset 0 is the front:
 * lowest on the ring, largest, brightest and facing the visitor; offsets ±count/2 sit at
 * the far side. Positions are unit-free fractions of the ring radii, so CSS owns the real
 * size at every breakpoint and the SVG rings drawn with the same radii always line up. */

import { wrapOffset } from './orbit-layout.ts';

export interface CrownProfile {
  /** Scale of a card at the far side of the ring (the front is 1). */
  readonly backScale: number;
  /** Opacity of a card at the far side (the front is 1). */
  readonly backOpacity: number;
  /** Degrees a card turns (rotateY) when it reaches the side of the ring. */
  readonly facing: number;
}

export interface CrownPose {
  /** Horizontal position, in ring radii (−1 left … 1 right). */
  readonly ox: number;
  /** Vertical position, in ring radii (−1 far/top … 1 front/bottom). */
  readonly oy: number;
  /** rotateY in degrees: cards turn with the ring's curve. */
  readonly turn: number;
  readonly scale: number;
  readonly opacity: number;
  /** 0 at the far side, 1 in front: drives dimming, glow and stacking. */
  readonly depth: number;
  readonly zIndex: number;
}

export const DEFAULT_CROWN: CrownProfile = { backScale: .64, backOpacity: .62, facing: 26 };

const round = (value: number, digits: number) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor || 0;
};

/** Where the card `offset` places away from the front sits on the ring. Offsets wrap, so
 * the last view is always the neighbour of the first: the ring has no ends. */
export function crownPose(offset: number, count: number, profile: CrownProfile = DEFAULT_CROWN): CrownPose {
  const distance = count > 0 ? wrapOffset(offset, count) : 0;
  const angle = count > 0 ? (distance / count) * Math.PI * 2 : 0;
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  const depth = (cos + 1) / 2;
  return {
    ox: round(sin, 4),
    oy: round(cos, 4),
    turn: round(-sin * profile.facing, 2),
    scale: round(profile.backScale + (1 - profile.backScale) * depth, 3),
    opacity: round(profile.backOpacity + (1 - profile.backOpacity) * depth, 3),
    depth: round(depth, 3),
    zIndex: Math.round(depth * 100),
  };
}

/** Inline style for a pose. The server renders it (the crown is composed without
 * JavaScript) and the controller writes the same properties while the ring turns. */
export function crownStyle(pose: CrownPose): Record<string, string> {
  return {
    '--ox': String(pose.ox),
    '--oy': String(pose.oy),
    '--turn': `${pose.turn}deg`,
    '--scale': String(pose.scale),
    '--depth': String(pose.depth),
    opacity: String(pose.opacity),
    'z-index': String(pose.zIndex),
  };
}

export const crownStyleText = (pose: CrownPose) => Object.entries(crownStyle(pose)).map(([name, value]) => `${name}:${value}`).join(';');

/** Pixels of horizontal drag that turn the ring by one view: about the arc between two
 * neighbours at the front, so a card follows the finger. */
export function crownDragUnit(radiusX: number, count: number): number {
  if (count < 1 || !Number.isFinite(radiusX)) return 64;
  return Math.max(40, ((radiusX * Math.PI * 2) / count) * .85);
}

/** The views worth fetching ahead of time: the selected one and its ring neighbours. */
export function neighbours(index: number, count: number): number[] {
  if (count < 1) return [];
  const wrap = (value: number) => ((value % count) + count) % count;
  return [...new Set([wrap(index), wrap(index + 1), wrap(index - 1)])];
}
