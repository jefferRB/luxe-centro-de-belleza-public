import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cameraFor, cardPlacement, clampPose, crownOptics, crownRadius, diveDistance, elementMatrix, entryKeys, follow, HOME_POSE, matchingViewpoint, orbitBounds, pathDuration, project,
  returnKeys, ringPaths, ringPoint, rubber, samplePath, tourKeys, transformPoint, translate, viewpoints, type CameraPose, type SceneFrame,
} from '../src/lib/space-camera.ts';

const rx = 336;
const ry = 84;
const optics = crownOptics(rx, ry, .64);
const frame: SceneFrame = { ringCenter: { x: 400, y: 150 }, photoCenter: { x: 400, y: 520 }, screenCenter: { x: 400, y: 450 }, focal: optics.focal };
const ring = { center: frame.ringCenter, radius: rx, tilt: optics.tilt };
const close = (actual: number, expected: number, epsilon = .5) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} ≈ ${expected}`);

test('cámara en reposo: el plano del portal se dibuja exactamente donde lo pone la página', () => {
  const camera = cameraFor(HOME_POSE, frame);
  const layout = { x: 120, y: 260 };
  const matrix = elementMatrix(camera, layout, translate(layout.x, layout.y));
  for (const [x, y] of [[0, 0], [480, 0], [0, 610], [480, 610], [240, 300]] as const) {
    const [sx, sy] = transformPoint(matrix, [x, y, 0]);
    close(sx, x, 1e-6);
    close(sy, y, 1e-6);
  }
});

test('cámara: posición, orientación y objetivo consistentes en toda la órbita', () => {
  for (const pose of [HOME_POSE, { yaw: 40, pitch: 12, distance: 1, dive: 0 }, { yaw: -52, pitch: 28, distance: .9, dive: 0 }, { yaw: 0, pitch: 0, distance: .45, dive: 1 }]) {
    const camera = cameraFor(pose, frame);
    // Orthonormal basis; the camera looks at its target, which projects to the principal point.
    const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
    close(dot(camera.right, camera.right), 1, 1e-9);
    close(dot(camera.down, camera.down), 1, 1e-9);
    close(dot(camera.right, camera.down), 0, 1e-9);
    close(dot(camera.right, camera.back), 0, 1e-9);
    const target = project(camera, camera.target)!;
    close(target.x, camera.focus.x, 1e-6);
    close(target.y, camera.focus.y, 1e-6);
    // The camera's matrix and its point projection agree.
    const matrix = elementMatrix(camera, { x: 0, y: 0 }, translate(0, 0));
    const point = ringPoint(ring, .7);
    const [mx, my] = transformPoint(matrix, point);
    const projected = project(camera, point)!;
    close(mx, projected.x, 1e-6);
    close(my, projected.y, 1e-6);
  }
});

test('órbita elíptica: más amplia a los lados que de frente, siempre mirando al portal', () => {
  const front = cameraFor(HOME_POSE, frame);
  const side = cameraFor({ yaw: 45, pitch: 0, distance: 1, dive: 0 }, frame);
  const reach = (camera: typeof front) => Math.hypot(camera.position[0] - camera.target[0], camera.position[2] - camera.target[2]);
  close(reach(front), frame.focal, 1e-6);
  assert.ok(reach(side) > reach(front), 'wider across than deep');
  assert.ok(side.position[0] > frame.ringCenter.x, 'positive yaw moves the camera to the right');
  const high = cameraFor({ yaw: 0, pitch: 20, distance: 1, dive: 0 }, frame);
  assert.ok(high.position[1] < frame.ringCenter.y, 'positive pitch looks from above');
});

test('corona en reposo: la tarjeta del frente a tamaño real en la base de la elipse; la del fondo más chica y más arriba', () => {
  const camera = cameraFor(HOME_POSE, frame);
  const front = project(camera, cardPlacement(0, ring, 26, 0).position)!;
  const back = project(camera, cardPlacement(Math.PI, ring, 26, 0).position)!;
  close(front.x, frame.ringCenter.x, 1e-6);
  close(front.y, frame.ringCenter.y + ry, .01);
  close(front.scale * optics.cardScale, 1, 1e-9);
  close((back.scale * optics.cardScale), .64, 1e-9);
  assert.ok(back.y < frame.ringCenter.y, 'the far side is higher');
  // Sides: on the portal plane, at the ring's full radius.
  const right = project(camera, cardPlacement(Math.PI / 2, ring, 26, 0).position)!;
  close(right.x, frame.ringCenter.x + rx, 1e-6);
});

test('tarjetas: planos rectos que giran con la curva y, en parte, hacia la cámara (nunca de espaldas)', () => {
  assert.equal(cardPlacement(0, ring, 26, 0).yaw, 0);
  assert.ok(cardPlacement(Math.PI / 2, ring, 26, 0).yaw < 0, 'right card turns its face inwards');
  for (const cameraYaw of [-52, 0, 52]) {
    for (let step = 0; step < 12; step++) {
      const theta = (step / 12) * Math.PI * 2;
      const relative = Math.abs(cardPlacement(theta, ring, 26, cameraYaw).yaw - cameraYaw);
      assert.ok(relative < 70, `card faces the camera within 70° (got ${relative})`);
    }
  }
});

test('anillos: mitad cercana por delante del portal, mitad lejana por detrás, sin cortes en reposo', () => {
  for (let step = 0; step < 16; step++) {
    const theta = (step / 16) * Math.PI * 2;
    const [, , z] = ringPoint(ring, theta);
    if (Math.cos(theta) > .01) assert.ok(z > 0);
    if (Math.cos(theta) < -.01) assert.ok(z < 0);
  }
  const paths = ringPaths(cameraFor(HOME_POSE, frame), ring, 32);
  for (const path of [paths.front, paths.back, paths.full]) {
    assert.equal((path.match(/M/g) ?? []).length, 1, 'one continuous stroke');
  }
  assert.equal((paths.front.match(/L/g) ?? []).length, 32);
});

test('límites: órbita guiada, más corta en pantallas chicas, con resistencia elástica', () => {
  const wide = orbitBounds(1200);
  const phone = orbitBounds(390);
  assert.ok(phone.yaw[1] < wide.yaw[1]);
  assert.deepEqual(clampPose({ yaw: 200, pitch: -90, distance: 9, dive: 4 }, wide), { yaw: wide.yaw[1], pitch: wide.pitch[0], distance: 1.4, dive: 1 });
  assert.equal(rubber(20, -30, 30), 20);
  const past = rubber(60, -30, 30, 8);
  assert.ok(past > 30 && past < 38, 'past the limit, at most `give` further');
  assert.ok(rubber(1000, -30, 30, 8) <= 38);
});

test('puntos de vista: dentro de la órbita y reconocibles al llegar', () => {
  for (const width of [390, 700, 1200]) {
    const bounds = orbitBounds(width);
    const points = viewpoints(bounds);
    assert.deepEqual(points.map((point) => point.id), ['izquierda', 'frente', 'elevada', 'derecha']);
    for (const point of points) {
      assert.deepEqual(clampPose(point.pose, bounds), point.pose);
      assert.equal(matchingViewpoint(point.pose, points), point.id);
    }
  }
  assert.equal(matchingViewpoint(HOME_POSE, viewpoints(orbitBounds(1200))), undefined);
});

test('suavizado: se acerca al objetivo sin pasarse, igual a cualquier ritmo de cuadros', () => {
  const goal: CameraPose = { yaw: 40, pitch: 10, distance: 1, dive: 0 };
  let fast: CameraPose = HOME_POSE;
  for (let frame60 = 0; frame60 < 12; frame60++) fast = follow(fast, goal, 1000 / 60, 130);
  let slow: CameraPose = HOME_POSE;
  for (let frame30 = 0; frame30 < 6; frame30++) slow = follow(slow, goal, 1000 / 30, 130);
  close(fast.yaw, slow.yaw, 1e-6);
  assert.ok(fast.yaw > 0 && fast.yaw < 40);
  assert.deepEqual(follow(HOME_POSE, goal, 16, 0), goal);
});

test('trayectorias: continuas, sin saltos ni velocidad excesiva, y quietas en los extremos', () => {
  const from: CameraPose = { yaw: -20, pitch: 12, distance: 1, dive: 0 };
  const paths = [entryKeys(from, .45), tourKeys(HOME_POSE, orbitBounds(1200), .45), returnKeys({ yaw: 0, pitch: 0, distance: .45, dive: 1 }, from)];
  for (const keys of paths) {
    const duration = pathDuration(keys);
    assert.deepEqual(samplePath(keys, 0), keys[0]!.pose);
    assert.deepEqual(samplePath(keys, duration), keys.at(-1)!.pose);
    let previous = samplePath(keys, 0);
    let maxYawStep = 0;
    for (let time = 16; time <= duration; time += 16) {
      const pose = samplePath(keys, time);
      maxYawStep = Math.max(maxYawStep, Math.abs(pose.yaw - previous.yaw));
      assert.ok(Math.abs(pose.dive - previous.dive) < .05, 'dive advances smoothly');
      assert.ok(Math.abs(pose.distance - previous.distance) < .05, 'no dolly jumps');
      previous = pose;
    }
    assert.ok(maxYawStep < 1.6, `never more than ~1.6° per frame (got ${maxYawStep.toFixed(2)})`);
    // Eases in and out: almost still right after the start and right before the end.
    const start = samplePath(keys, 16);
    const end = samplePath(keys, duration - 16);
    assert.ok(Math.abs(start.yaw - keys[0]!.pose.yaw) < .2 && Math.abs(end.yaw - keys.at(-1)!.pose.yaw) < .2);
  }
});

test('recorrido automático: breve (5–8 s), termina dentro de la foto elegida', () => {
  const keys = tourKeys(HOME_POSE, orbitBounds(1200), .45);
  const duration = pathDuration(keys);
  assert.ok(duration >= 5000 && duration <= 8000);
  assert.deepEqual(keys.at(-1)!.pose, { yaw: 0, pitch: 0, distance: .45, dive: 1 });
  // Visits both sides of the rings and comes back to the front before entering.
  assert.ok(keys.some((key) => key.pose.yaw < -10) && keys.some((key) => key.pose.yaw > 10));
  assert.ok(keys.some((key) => key.pose.yaw === 0 && key.pose.dive === 0));
});

test('entrada al portal: la foto crece hasta su tamaño en la vista interior, sin atravesar las tarjetas', () => {
  const photo = { width: 330, height: 440 };
  const distance = diveDistance(photo, { width: 622, height: 830 }, .3);
  close(1 / distance, Math.min(622 / 330, 830 / 440), 1e-9);
  // Small landing (phones): still a real dolly through the frame.
  assert.equal(diveDistance(photo, { width: 340, height: 450 }, .3), 1 / 1.5);
  // Never closer than allowed.
  assert.equal(diveDistance(photo, { width: 4000, height: 4000 }, .3), .3);
  // Photo centre at the landing point, at the landing size.
  const dive = .5;
  const camera = cameraFor({ yaw: 0, pitch: 0, distance: dive, dive: 1 }, frame);
  const centre = project(camera, [frame.photoCenter.x, frame.photoCenter.y, 0])!;
  close(centre.x, frame.screenCenter.x, 1e-6);
  close(centre.y, frame.screenCenter.y, 1e-6);
  close(centre.scale, 1 / dive, 1e-9);
  // The cards in front of the portal stay in front of the lens.
  const nearest = ringPoint(ring, 0);
  assert.ok(camera.position[2] > nearest[2]);
});

test('corona en reposo: la perspectiva no ensancha la composición (márgenes de la página intactos)', () => {
  const profile = { backScale: .64, facing: 26 };
  const cardWidth = 204;
  const radius = crownRadius(rx, ry, profile, 5, cardWidth);
  assert.ok(radius < rx && radius > rx * .85, `slightly tighter ring (${radius.toFixed(1)})`);
  const flatEdge = Math.max(...[0, 1, 2, 3, 4].map((k) => {
    const theta = (k / 5) * Math.PI * 2;
    return rx * Math.sin(theta) + (cardWidth / 2) * (.64 + .36 * (Math.cos(theta) + 1) / 2) * Math.cos(Math.sin(theta) * 26 * Math.PI / 180);
  }));
  const tight = crownOptics(radius, ry, .64);
  const tightRing = { center: { x: 0, y: 0 }, radius, tilt: tight.tilt };
  const camera = cameraFor(HOME_POSE, { ringCenter: tightRing.center, photoCenter: tightRing.center, screenCenter: tightRing.center, focal: tight.focal });
  // Still the same composition: the front card at the bottom of the ellipse, full size.
  const front = project(camera, cardPlacement(0, tightRing, 26, 0).position)!;
  close(front.y, ry, .01);
  close(front.scale * tight.cardScale, 1, 1e-9);
  // And no card centre beyond the flat reach.
  for (let k = 0; k < 5; k++) {
    const centre = project(camera, cardPlacement((k / 5) * Math.PI * 2, tightRing, 26, 0).position)!;
    assert.ok(Math.abs(centre.x) <= flatEdge);
  }
  assert.equal(crownRadius(rx, ry, profile, 1, cardWidth), rx);
});
