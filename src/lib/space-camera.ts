/** A real camera for «El espacio» (pure math, no DOM).
 *
 * The scene is the section's own layout, lifted into 3D: x to the right and y down (CSS px
 * of the orbit container), z towards the visitor. The portal is the plane z = 0. The crown's
 * cards ride a ring of Saturn whose centre sits on the portal's axis, slightly inclined
 * towards the visitor, so the ring passes in front of the portal and behind it.
 *
 * Two motions never mix:
 *  - the crown position (which view is selected) turns the cards along the ring;
 *  - the camera pose (yaw, pitch, distance, dive) moves the point of view around the scene.
 *
 * The camera orbits a target on the portal's axis along an ellipse, always looking at it.
 * At rest (HOME_POSE) the projection of the plane z = 0 is the identity, so the portal is
 * drawn exactly where the page lays it out and nothing moves until the visitor asks.
 * Every element is projected with one 4×4 matrix (CSS matrix3d); the rings are projected
 * point by point into screen-space SVG paths so their hairlines stay crisp at any angle. */

export type Vec3 = readonly [number, number, number];
/** Column-major 4×4 matrix, the order CSS matrix3d() expects. */
export type Mat4 = readonly number[];
export interface Point { readonly x: number; readonly y: number }

export interface CameraPose {
  /** Degrees around the vertical axis; positive moves the camera to the visitor's right. */
  readonly yaw: number;
  /** Degrees of elevation; positive looks from above. */
  readonly pitch: number;
  /** Distance to the target, in focal lengths (1 = rest). */
  readonly distance: number;
  /** 0 = looking at the rings' centre; 1 = looking at the photo, framed in the screen centre. */
  readonly dive: number;
}

export const HOME_POSE: CameraPose = { yaw: 0, pitch: 0, distance: 1, dive: 0 };

/** Layout facts of the scene, measured once per resize (container px). */
export interface SceneFrame {
  /** Centre of the rings, on the portal's axis (world z = 0). */
  readonly ringCenter: Point;
  /** Centre of the selected photo inside the portal (world z = 0). */
  readonly photoCenter: Point;
  /** Where a dived photo lands: the centre of the visitor's screen, in container px. */
  readonly screenCenter: Point;
  /** Focal length in px: the camera's distance to the target at rest. */
  readonly focal: number;
}

export interface Camera {
  readonly position: Vec3;
  readonly target: Vec3;
  /** Screen point (container px) the target projects to: the principal point. */
  readonly focus: Point;
  readonly focal: number;
  /** Orientation: screen right, screen down and the direction back towards the camera. */
  readonly right: Vec3;
  readonly down: Vec3;
  readonly back: Vec3;
}

/** The camera's orbit is an ellipse, a little wider across than deep: from the sides the
 * whole installation stays in frame. */
export const ORBIT_ACROSS = 1.12;
/** Nothing closer than this (px) to the lens is drawn. */
export const NEAR = 24;

const DEG = Math.PI / 180;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount;
export const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = (a: Vec3): Vec3 => {
  const length = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
};

// ——— Camera ———

/** Where the camera is and where it looks, for a pose. */
export function cameraFor(pose: CameraPose, frame: SceneFrame): Camera {
  const dive = clamp(pose.dive, 0, 1);
  const target: Vec3 = [lerp(frame.ringCenter.x, frame.photoCenter.x, dive), lerp(frame.ringCenter.y, frame.photoCenter.y, dive), 0];
  const focus = { x: lerp(frame.ringCenter.x, frame.screenCenter.x, dive), y: lerp(frame.ringCenter.y, frame.screenCenter.y, dive) };
  const yaw = pose.yaw * DEG;
  const pitch = pose.pitch * DEG;
  // Elliptical orbit: wider across (x) than deep (z).
  const across = ORBIT_ACROSS * Math.sin(yaw);
  const deep = Math.cos(yaw);
  const reach = Math.hypot(across, deep) * pose.distance * frame.focal;
  const azimuth = Math.atan2(across, deep);
  const position: Vec3 = [
    target[0] + reach * Math.sin(azimuth) * Math.cos(pitch),
    target[1] - reach * Math.sin(pitch),
    target[2] + reach * Math.cos(azimuth) * Math.cos(pitch),
  ];
  const back = normalize(sub(position, target));
  const right = normalize(cross([0, 1, 0], back));
  const down = cross(back, right);
  return { position, target, focus, focal: frame.focal, right, down, back };
}

/** Camera-space coordinates: x right, y down, z negative in front of the lens. */
export function toCamera(camera: Camera, point: Vec3): Vec3 {
  const offset = sub(point, camera.position);
  return [dot(offset, camera.right), dot(offset, camera.down), dot(offset, camera.back)];
}

export interface Projection {
  readonly x: number;
  readonly y: number;
  /** Distance in front of the lens (px). */
  readonly depth: number;
  /** Apparent scale of something at that depth (1 = the portal at rest). */
  readonly scale: number;
}

/** Screen position (container px) of a world point, or undefined if it is behind the lens. */
export function project(camera: Camera, point: Vec3): Projection | undefined {
  const [x, y, z] = toCamera(camera, point);
  const depth = -z;
  if (depth < NEAR) return undefined;
  const scale = camera.focal / depth;
  return { x: camera.focus.x + x * scale, y: camera.focus.y + y * scale, depth, scale };
}

// ——— Matrices (column-major, CSS order) ———

export const identity = (): number[] => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function multiply(a: Mat4, b: Mat4): number[] {
  const out = new Array<number>(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row]! * b[col * 4 + k]!;
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

export const translate = (x: number, y: number, z = 0): number[] => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
export const scale3 = (s: number): number[] => [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1];
/** CSS rotateY(): positive turns the right edge away from the visitor. */
export function rotateY(degrees: number): number[] {
  const c = Math.cos(degrees * DEG);
  const s = Math.sin(degrees * DEG);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}

export function viewMatrix(camera: Camera): number[] {
  const { right: r, down: d, back: b, position: p } = camera;
  return [r[0], d[0], b[0], 0, r[1], d[1], b[1], 0, r[2], d[2], b[2], 0, -dot(r, p), -dot(d, p), -dot(b, p), 1];
}

/** CSS perspective(focal) around the principal point, for camera-space input. */
export function projectionMatrix(camera: Camera): number[] {
  const perspective = identity();
  perspective[11] = -1 / camera.focal;
  return multiply(multiply(translate(camera.focus.x, camera.focus.y), perspective), translate(0, 0, camera.focal));
}

/** The transform (with transform-origin 0 0) that draws an element laid out at `layout`
 * (container px, its top-left corner) through the camera; `model` maps the element's own
 * px to world space. */
export function elementMatrix(camera: Camera, layout: Point, model: Mat4): number[] {
  return multiply(multiply(multiply(translate(-layout.x, -layout.y), projectionMatrix(camera)), viewMatrix(camera)), model);
}

/** Applies a matrix to a point (with the perspective divide). */
export function transformPoint(matrix: Mat4, point: Vec3): Vec3 {
  const [x, y, z] = point;
  const w = matrix[3]! * x + matrix[7]! * y + matrix[11]! * z + matrix[15]!;
  return [
    (matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!) / w,
    (matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!) / w,
    (matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!) / w,
  ];
}

export const cssMatrix = (matrix: Mat4) => `matrix3d(${matrix.map((value) => String(Number(value.toPrecision(8)) || 0)).join(',')})`;

// ——— Rings and crown ———

export interface Ring {
  readonly center: Point;
  readonly radius: number;
  /** Inclination towards the visitor (radians): the front of the ring is lower and nearer. */
  readonly tilt: number;
}

/** A point of the ring; θ = 0 is the front, θ = ±π/2 the sides (the crown's ox = sin θ). */
export function ringPoint(ring: Ring, theta: number): Vec3 {
  const along = ring.radius * Math.cos(theta);
  return [ring.center.x + ring.radius * Math.sin(theta), ring.center.y + along * Math.sin(ring.tilt), along * Math.cos(ring.tilt)];
}

export interface CrownOptics {
  readonly focal: number;
  readonly tilt: number;
  /** World scale of a card, so the one in front is drawn at its laid-out size at rest. */
  readonly cardScale: number;
}

/** Camera and ring that reproduce the crown's composition at rest: the front card at the
 * bottom of the ellipse (radii rx, ry) at full size, the far card at `backScale`. The
 * perspective does the rest (sides and far side follow from real depth). */
export function crownOptics(rx: number, ry: number, backScale: number): CrownOptics {
  const back = clamp(backScale, .3, .95);
  const cardScale = (2 * back) / (1 + back);
  const tilt = Math.asin(clamp((ry * cardScale) / Math.max(1, rx), .02, .7));
  const focal = (rx * Math.cos(tilt) * (1 + back)) / (1 - back);
  return { focal, tilt, cardScale };
}

/** Ring radius (px) that keeps the cards at rest inside the horizontal reach they had in the
 * flat composition (centres at rx·sin θ, sized by the depth profile): real perspective
 * spreads the side cards a little, and the composition (and the page margins) must not grow. */
export function crownRadius(rx: number, ry: number, profile: { readonly backScale: number; readonly facing: number }, count: number, cardWidth: number): number {
  if (count < 2 || cardWidth <= 0 || rx <= 0) return rx;
  const half = cardWidth / 2;
  const back = clamp(profile.backScale, .3, .95);
  const angles = Array.from({ length: count }, (_, index) => (index / count) * Math.PI * 2);
  const flat = Math.max(...angles.map((theta) => rx * Math.sin(theta) + half * (back + (1 - back) * (Math.cos(theta) + 1) / 2) * Math.cos(Math.sin(theta) * profile.facing * DEG)));
  const reach = (radius: number) => {
    const optics = crownOptics(radius, ry, back);
    const ring: Ring = { center: { x: 0, y: 0 }, radius, tilt: optics.tilt };
    const camera = cameraFor(HOME_POSE, { ringCenter: ring.center, photoCenter: ring.center, screenCenter: ring.center, focal: optics.focal });
    return Math.max(...angles.flatMap((theta) => {
      const { position, yaw } = cardPlacement(theta, ring, profile.facing, 0);
      const c = Math.cos(yaw * DEG) * half * optics.cardScale;
      const s = Math.sin(yaw * DEG) * half * optics.cardScale;
      // CSS rotateY: the card's x axis goes to (cos, 0, −sin).
      return [1, -1].map((side) => project(camera, [position[0] + side * c, position[1], position[2] - side * s])?.x ?? 0);
    }));
  };
  if (reach(rx) <= flat) return rx;
  let low = rx * .7;
  let high = rx;
  for (let step = 0; step < 24; step++) {
    const middle = (low + high) / 2;
    if (reach(middle) > flat) high = middle;
    else low = middle;
  }
  return low;
}

/** Where a card sits on the ring and which way it faces. Cards stay upright rectangles:
 * they turn with the ring's curve (`facing`) and partly towards the camera (`follow`), so
 * they read as planes in space and stay legible from any allowed viewpoint. */
export function cardPlacement(theta: number, ring: Ring, facing: number, cameraYaw: number, follow = .55): { position: Vec3; yaw: number } {
  return { position: ringPoint(ring, theta), yaw: follow * cameraYaw - Math.sin(theta) * facing };
}

export interface RingPaths { readonly front: string; readonly back: string; readonly full: string }

/** The ring projected into screen space: its near half (in front of the portal plane),
 * its far half (behind it) and the whole loop (left → front → right → back). */
export function ringPaths(camera: Camera, ring: Ring, samples = 64): RingPaths {
  const trace = (from: number, to: number, count: number) => {
    let path = '';
    let open = false;
    for (let index = 0; index <= count; index++) {
      const point = project(camera, ringPoint(ring, from + ((to - from) * index) / count));
      if (!point) { open = false; continue; }
      path += `${open ? 'L' : 'M'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
      open = true;
    }
    return path;
  };
  const half = Math.PI / 2;
  return { front: trace(-half, half, samples), back: trace(half, 3 * half, samples), full: trace(-half, 3 * half, samples * 2) };
}

// ——— Bounds, viewpoints and paths ———

export interface OrbitBounds {
  readonly yaw: readonly [number, number];
  readonly pitch: readonly [number, number];
}

/** A guided orbit, never a free camera: narrower on small screens. */
export function orbitBounds(width: number): OrbitBounds {
  if (width < 520) return { yaw: [-30, 30], pitch: [-2, 22] };
  if (width < 760) return { yaw: [-40, 40], pitch: [-3, 25] };
  return { yaw: [-52, 52], pitch: [-4, 28] };
}

export function clampPose(pose: CameraPose, bounds: OrbitBounds): CameraPose {
  return {
    yaw: clamp(pose.yaw, bounds.yaw[0], bounds.yaw[1]),
    pitch: clamp(pose.pitch, bounds.pitch[0], bounds.pitch[1]),
    distance: clamp(pose.distance, .2, 1.4),
    dive: clamp(pose.dive, 0, 1),
  };
}

/** Past a limit, a drag meets growing resistance (at most `give` beyond it). */
export function rubber(value: number, min: number, max: number, give = 8): number {
  if (value > max) return max + give * (1 - Math.exp(-(value - max) / give));
  if (value < min) return min - give * (1 - Math.exp(-(min - value) / give));
  return value;
}

export interface Viewpoint { readonly id: string; readonly label: string; readonly pose: CameraPose }

/** Predefined viewpoints of the immersive mode (scaled to the bounds of the screen). */
export function viewpoints(bounds: OrbitBounds): Viewpoint[] {
  const side = Math.round(bounds.yaw[1] * .8);
  return [
    { id: 'izquierda', label: 'Izquierda', pose: { yaw: -side, pitch: 7, distance: 1, dive: 0 } },
    { id: 'frente', label: 'Frente', pose: { yaw: -12, pitch: 9, distance: .97, dive: 0 } },
    { id: 'elevada', label: 'Elevada', pose: { yaw: 0, pitch: Math.round(bounds.pitch[1] * .9), distance: 1.02, dive: 0 } },
    { id: 'derecha', label: 'Derecha', pose: { yaw: side, pitch: 7, distance: 1, dive: 0 } },
  ];
}

/** The pose a viewpoint button stands for, if the camera rests there. */
export function matchingViewpoint(pose: CameraPose, points: readonly Viewpoint[], tolerance = 1.5): string | undefined {
  return points.find((point) => Math.abs(point.pose.yaw - pose.yaw) < tolerance && Math.abs(point.pose.pitch - pose.pitch) < tolerance && Math.abs(point.pose.distance - pose.distance) < .02 && pose.dive < .01)?.id;
}

export const posesClose = (a: CameraPose, b: CameraPose, epsilon = .02) =>
  Math.abs(a.yaw - b.yaw) < epsilon && Math.abs(a.pitch - b.pitch) < epsilon && Math.abs(a.distance - b.distance) < epsilon / 50 && Math.abs(a.dive - b.dive) < epsilon / 50;

/** Eases a pose towards a goal (frame-rate independent): weight, never a jump. */
export function follow(pose: CameraPose, goal: CameraPose, elapsed: number, timeConstant: number): CameraPose {
  const amount = timeConstant <= 0 ? 1 : 1 - Math.exp(-Math.max(0, elapsed) / timeConstant);
  return {
    yaw: lerp(pose.yaw, goal.yaw, amount),
    pitch: lerp(pose.pitch, goal.pitch, amount),
    distance: lerp(pose.distance, goal.distance, amount),
    dive: lerp(pose.dive, goal.dive, amount),
  };
}

export interface PathKey { readonly at: number; readonly pose: CameraPose }
const FIELDS = ['yaw', 'pitch', 'distance', 'dive'] as const;

/** A designed camera path through key poses (ms): cubic Hermite with tangents from the
 * neighbouring keys, so speed is continuous through every key and zero at both ends. */
export function samplePath(keys: readonly PathKey[], time: number): CameraPose {
  if (!keys.length) return HOME_POSE;
  const first = keys[0]!;
  const last = keys.at(-1)!;
  if (time <= first.at) return first.pose;
  if (time >= last.at) return last.pose;
  let index = 0;
  while (index < keys.length - 2 && time > keys[index + 1]!.at) index++;
  const a = keys[index]!;
  const b = keys[index + 1]!;
  const span = Math.max(1, b.at - a.at);
  const t = (time - a.at) / span;
  const t2 = t * t;
  const t3 = t2 * t;
  const tangent = (at: number, field: typeof FIELDS[number]) => {
    const before = keys[at - 1];
    const after = keys[at + 1];
    if (!before || !after) return 0;
    return (after.pose[field] - before.pose[field]) / Math.max(1, after.at - before.at);
  };
  const pose = {} as Record<typeof FIELDS[number], number>;
  for (const field of FIELDS) {
    const m0 = tangent(index, field) * span;
    const m1 = tangent(index + 1, field) * span;
    pose[field] = (2 * t3 - 3 * t2 + 1) * a.pose[field] + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * b.pose[field] + (t3 - t2) * m1;
  }
  return pose;
}

export const pathDuration = (keys: readonly PathKey[]) => keys.at(-1)?.at ?? 0;

/** How close the camera gets to the photo when it enters (focal lengths): the photo grows to
 * the size it will have in the interior view (`landing`), and at least enough for the frame
 * to leave the screen; never past the cards in front of the portal (`minimum`). */
export function diveDistance(photo: { width: number; height: number }, landing: { width: number; height: number }, minimum: number): number {
  if (photo.width <= 0 || photo.height <= 0 || landing.width <= 0 || landing.height <= 0) return Math.max(minimum, .5);
  const exact = Math.min(landing.width / photo.width, landing.height / photo.height);
  const magnification = clamp(Math.max(exact, 1.5), 1.2, 3.4);
  return Math.max(minimum, 1 / magnification);
}

/** «Entrar a LUXE»: steady in front of the portal, then a dolly through the frame to the photo. */
export function entryKeys(from: CameraPose, dive: number): PathKey[] {
  const settle = Math.abs(from.yaw) > 4 || Math.abs(from.pitch) > 4 || Math.abs(from.distance - 1) > .04 ? 650 : 280;
  return [
    { at: 0, pose: from },
    { at: settle, pose: { yaw: 0, pitch: 1.5, distance: 1, dive: 0 } },
    { at: settle + 700, pose: { yaw: 0, pitch: .8, distance: lerp(1, dive, .45), dive: .55 } },
    { at: settle + 1500, pose: { yaw: 0, pitch: 0, distance: dive, dive: 1 } },
  ];
}

/** Back out of the portal to where the visitor was. */
export function returnKeys(from: CameraPose, to: CameraPose): PathKey[] {
  const middle: CameraPose = { yaw: to.yaw * .25, pitch: Math.max(1, to.pitch * .5), distance: lerp(from.distance, 1, .7), dive: .3 };
  return [
    { at: 0, pose: from },
    { at: 650, pose: middle },
    { at: 1350, pose: to },
  ];
}

/** «Ver recorrido»: a designed path (about 6 s) — closer to the rings, along their curve,
 * back to the front and through the portal to the selected photo. */
export function tourKeys(from: CameraPose, bounds: OrbitBounds, dive: number): PathKey[] {
  const side = bounds.yaw[1] * .68;
  const high = Math.min(bounds.pitch[1] * .62, 17);
  return [
    { at: 0, pose: from },
    { at: 1100, pose: { yaw: -side, pitch: high, distance: .9, dive: 0 } },
    { at: 2500, pose: { yaw: side * .25, pitch: high * .75, distance: .88, dive: 0 } },
    { at: 3400, pose: { yaw: side * .7, pitch: high * .45, distance: .94, dive: 0 } },
    { at: 4300, pose: { yaw: 0, pitch: 2, distance: 1, dive: 0 } },
    { at: 5000, pose: { yaw: 0, pitch: .8, distance: lerp(1, dive, .45), dive: .55 } },
    { at: 5800, pose: { yaw: 0, pitch: 0, distance: dive, dive: 1 } },
  ];
}
