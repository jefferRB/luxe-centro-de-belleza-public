/** Pure geometry for the photo globe (no DOM). Angles are degrees. Conventions match the
 * CSS that renders it: a panel at (lat, lon) is placed with
 * `rotateY(lon) rotateX(lat) translateZ(R)` (tangent to the sphere, upright along its
 * meridian) and the whole globe is turned with `rotateX(pitch) rotateY(yaw)`. */

export interface SpherePoint { readonly lat: number; readonly lon: number }
export interface Orientation { readonly yaw: number; readonly pitch: number }

const RAD = Math.PI / 180;
const GOLDEN_ANGLE = 180 * (3 - Math.sqrt(5)); // ≈ 137.5°
const round = (value: number, digits = 3) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor || 0;
};

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Signed angle in (-180, 180]. */
export function normalizeAngle(angle: number): number {
  const wrapped = ((((angle + 180) % 360) + 360) % 360) - 180;
  return wrapped === -180 ? 180 : wrapped;
}

/** Evenly spread points (Fibonacci sphere): every latitude band is used, no two share a row. */
export function fibonacciSphere(count: number): SpherePoint[] {
  return Array.from({ length: Math.max(0, count) }, (_, index) => {
    const y = 1 - (2 * (index + .5)) / count;
    return { lat: round(Math.asin(y) / RAD, 2), lon: round(normalizeAngle(index * GOLDEN_ANGLE), 2) };
  });
}

/** Unit position of a point on the sphere, in CSS axes (y grows downwards). */
export function toVector(point: SpherePoint): readonly [x: number, y: number, z: number] {
  const lat = point.lat * RAD;
  const lon = point.lon * RAD;
  return [Math.cos(lat) * Math.sin(lon), -Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
}

/** Great-circle distance in degrees. */
export function angularDistance(a: SpherePoint, b: SpherePoint): number {
  const [ax, ay, az] = toVector(a);
  const [bx, by, bz] = toVector(b);
  return Math.acos(clamp(ax * bx + ay * by + az * bz, -1, 1)) / RAD;
}

/** Where a point ends up after the globe turns. z = 1: facing the visitor; z < 0: behind. */
export function rotatePoint(point: SpherePoint, orientation: Orientation): readonly [x: number, y: number, z: number] {
  const [x, y, z] = toVector(point);
  const yaw = orientation.yaw * RAD;
  const pitch = orientation.pitch * RAD;
  // CSS rotateY(a): x' = x cos a + z sin a; z' = -x sin a + z cos a.
  const x1 = x * Math.cos(yaw) + z * Math.sin(yaw);
  const z1 = -x * Math.sin(yaw) + z * Math.cos(yaw);
  // CSS rotateX(a): y' = y cos a - z sin a; z' = y sin a + z cos a.
  const y2 = y * Math.cos(pitch) - z1 * Math.sin(pitch);
  const z2 = y * Math.sin(pitch) + z1 * Math.cos(pitch);
  return [round(x1, 4), round(y2, 4), round(z2, 4)];
}

export const facingDepth = (point: SpherePoint, orientation: Orientation) => rotatePoint(point, orientation)[2];

/** Depth shading for a panel: none in front, darker towards the silhouette and the back. */
export function shadeFor(depth: number): number {
  return round(.68 * (1 - clamp(depth, 0, 1)) ** 1.25, 3);
}

/** The orientation that brings `point` to the front, within the tilt the visitor can reach. */
export function orientationFacing(point: SpherePoint, pitchLimit: number): Orientation {
  return { yaw: normalizeAngle(-point.lon), pitch: clamp(-point.lat, -pitchLimit, pitchLimit) };
}

/** Same target yaw, reached from `from` by the shortest way round. */
export function nearestYaw(from: number, to: number): number {
  return from + normalizeAngle(to - from);
}

/** Exponential decay of an angular velocity over `elapsed` ms (inertia). */
export function decay(velocity: number, elapsed: number, tau = 260): number {
  return velocity * Math.exp(-Math.max(0, elapsed) / tau);
}

/** Nearest free point to `anchor`, or -1 when none is left. */
export function nearestFree(points: readonly SpherePoint[], taken: ReadonlySet<number>, anchor: SpherePoint): number {
  let best = -1;
  let bestDistance = Infinity;
  points.forEach((point, index) => {
    if (taken.has(index)) return;
    const distance = angularDistance(point, anchor);
    if (distance < bestDistance) { best = index; bestDistance = distance; }
  });
  return best;
}

export interface Tagged { readonly tag: string }

/** Places items so that, wherever the globe is turned, neighbours differ: each item takes
 * the free point farthest from the pieces already placed with its own tag (ties: the point
 * nearest the equator, then the lowest index). Deterministic. `placed` seeds the occupancy. */
export function spreadByTag<T extends Tagged>(points: readonly SpherePoint[], taken: Set<number>, placed: readonly { point: SpherePoint; tag: string }[], items: readonly T[]): { point: SpherePoint; index: number; item: T }[] {
  const occupied = [...placed];
  const result: { point: SpherePoint; index: number; item: T }[] = [];
  for (const item of items) {
    let best = -1;
    let bestScore = -Infinity;
    points.forEach((point, index) => {
      if (taken.has(index)) return;
      const same = occupied.filter((entry) => entry.tag === item.tag);
      const own = same.length ? Math.min(...same.map((entry) => angularDistance(entry.point, point))) : 180;
      // Second criterion: stay away from anything already placed (no stacking).
      const any = occupied.length ? Math.min(...occupied.map((entry) => angularDistance(entry.point, point))) : 180;
      const score = own * 10 + any - Math.abs(point.lat) * .05;
      if (score > bestScore + 1e-9) { best = index; bestScore = score; }
    });
    if (best < 0) break;
    taken.add(best);
    occupied.push({ point: points[best]!, tag: item.tag });
    result.push({ point: points[best]!, index: best, item });
  }
  return result;
}

export interface Group<T> { readonly anchor: SpherePoint; readonly items: readonly T[] }
export interface Placement<T> { readonly point: SpherePoint; readonly index: number; readonly item: T }

/** Places each group's items on the free points nearest its anchor (first item nearest),
 * so a specialty's photos form one region of the globe. Deterministic; unused points are
 * returned for decorative facets. */
export function assignToPoints<T>(points: readonly SpherePoint[], groups: readonly Group<T>[]): { placed: Placement<T>[]; free: number[] } {
  const taken = new Set<number>();
  const placed: Placement<T>[] = [];
  for (const group of groups) {
    for (const item of group.items) {
      let best = -1;
      let bestDistance = Infinity;
      points.forEach((point, index) => {
        if (taken.has(index)) return;
        const distance = angularDistance(point, group.anchor);
        if (distance < bestDistance) { best = index; bestDistance = distance; }
      });
      if (best < 0) break;
      taken.add(best);
      placed.push({ point: points[best]!, index: best, item });
    }
  }
  return { placed, free: points.map((_, index) => index).filter((index) => !taken.has(index)) };
}
