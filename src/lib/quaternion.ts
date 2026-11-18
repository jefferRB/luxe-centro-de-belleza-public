/** Unit quaternions for the photo globe's free rotation (no DOM). Same axes as CSS:
 * x right, y down, z towards the viewer; `rotateX/rotateY` in CSS are the standard
 * rotations about those axes, so a quaternion maps 1:1 to the rotor's `matrix3d`.
 * Orientation is composed incrementally (screen-space deltas pre-multiplied), so there
 * are no Euler angles to clamp, no gimbal lock and no flip when crossing a pole. */

export type Quat = readonly [w: number, x: number, y: number, z: number];
export type Vec3 = readonly [x: number, y: number, z: number];

const RAD = Math.PI / 180;
export const IDENTITY: Quat = [1, 0, 0, 0];

export function normalize(q: Quat): Quat {
  const length = Math.hypot(...q) || 1;
  return [q[0] / length, q[1] / length, q[2] / length, q[3] / length];
}

export function fromAxisAngle(axis: Vec3, degrees: number): Quat {
  const length = Math.hypot(...axis);
  if (!length || !degrees) return IDENTITY;
  const half = (degrees * RAD) / 2;
  const s = Math.sin(half) / length;
  return [Math.cos(half), axis[0] * s, axis[1] * s, axis[2] * s];
}

/** a·b: rotate by b first, then by a. */
export function multiply(a: Quat, b: Quat): Quat {
  const [aw, ax, ay, az] = a;
  const [bw, bx, by, bz] = b;
  return [
    aw * bw - ax * bx - ay * by - az * bz,
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
  ];
}

/** CSS `rotateX(pitch) rotateY(yaw)` as a quaternion (yaw applied first). */
export const fromYawPitch = (yaw: number, pitch: number): Quat => multiply(fromAxisAngle([1, 0, 0], pitch), fromAxisAngle([0, 1, 0], yaw));

/** A screen-space turn: dragging right by `yaw`° and down by `pitch`° (world axes). */
export const screenTurn = (yaw: number, pitch: number): Quat => multiply(fromAxisAngle([1, 0, 0], -pitch), fromAxisAngle([0, 1, 0], yaw));

/** Applies a world-space turn to an orientation; renormalised so errors never accumulate. */
export const turn = (orientation: Quat, delta: Quat): Quat => normalize(multiply(delta, orientation));

export function rotateVector(q: Quat, v: Vec3): Vec3 {
  const [w, x, y, z] = q;
  const [vx, vy, vz] = v;
  // v' = v + 2w(u×v) + 2u×(u×v), with u = (x, y, z).
  const cx = y * vz - z * vy;
  const cy = z * vx - x * vz;
  const cz = x * vy - y * vx;
  return [
    vx + 2 * (w * cx + y * cz - z * cy),
    vy + 2 * (w * cy + z * cx - x * cz),
    vz + 2 * (w * cz + x * cy - y * cx),
  ];
}

/** Angle (degrees) of the rotation that takes a to b, along the shorter way. */
export function angleBetween(a: Quat, b: Quat): number {
  const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return (2 * Math.acos(Math.min(1, dot))) / RAD;
}

/** Spherical interpolation along the shorter arc (q and −q are the same orientation). */
export function slerp(a: Quat, b: Quat, t: number): Quat {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const target: Quat = dot < 0 ? [-b[0], -b[1], -b[2], -b[3]] : b;
  dot = Math.abs(dot);
  if (dot > .9995) return normalize([a[0] + (target[0] - a[0]) * t, a[1] + (target[1] - a[1]) * t, a[2] + (target[2] - a[2]) * t, a[3] + (target[3] - a[3]) * t]);
  const theta = Math.acos(dot);
  const sin = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sin;
  const wb = Math.sin(t * theta) / sin;
  return [a[0] * wa + target[0] * wb, a[1] * wa + target[1] * wb, a[2] * wa + target[2] * wb, a[3] * wa + target[3] * wb];
}

/** CSS `matrix3d(...)` for the rotation (column-major, as CSS expects). */
export function toMatrix3d(q: Quat): string {
  const [w, x, y, z] = q;
  const m = [
    1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y), 0,
    2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x), 0,
    2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y), 0,
    0, 0, 0, 1,
  ];
  return `matrix3d(${m.map((value) => Number(value.toFixed(6))).join(', ')})`;
}
