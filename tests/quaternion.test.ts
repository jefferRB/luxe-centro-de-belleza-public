import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDENTITY, angleBetween, fromAxisAngle, fromYawPitch, multiply, rotateVector, screenTurn, slerp, toMatrix3d, turn, type Quat, type Vec3 } from '../src/lib/quaternion.ts';
import { rotatePoint, toVector } from '../src/lib/sphere.ts';

const close = (a: readonly number[], b: readonly number[], epsilon = 1e-6) => a.every((value, index) => Math.abs(value - b[index]!) < epsilon);
const front = (q: Quat): Vec3 => rotateVector(q, [0, 0, 1]);

test('el cuaternión coincide con el CSS «rotateX(pitch) rotateY(yaw)» que ya usaba el globo', () => {
  for (const [yaw, pitch] of [[0, 0], [90, 0], [-35, 20], [144, -10], [200, 75]] as const) {
    for (const point of [{ lat: 0, lon: 0 }, { lat: 30, lon: 60 }, { lat: -70, lon: -150 }]) {
      assert.ok(close(rotateVector(fromYawPitch(yaw, pitch), toVector(point)), rotatePoint(point, { yaw, pitch }), 1e-3), `${yaw},${pitch}`);
    }
  }
});

test('matrix3d: columna mayor, ortonormal y equivalente a rotar el vector', () => {
  const q = fromYawPitch(37, -112);
  const values = /matrix3d\((.+)\)/.exec(toMatrix3d(q))![1]!.split(', ').map(Number);
  assert.equal(values.length, 16);
  const column = (c: number) => [values[c * 4]!, values[c * 4 + 1]!, values[c * 4 + 2]!];
  for (const [axis, index] of [[[1, 0, 0], 0], [[0, 1, 0], 1], [[0, 0, 1], 2]] as const) assert.ok(close(column(index), rotateVector(q, axis), 1e-5));
  assert.deepEqual(values.slice(12), [0, 0, 0, 1]);
});

test('rotación vertical ilimitada: una vuelta completa en pasos pequeños vuelve al inicio, sin saltos', () => {
  let q: Quat = fromYawPitch(12, -8);
  const start = q;
  let previous = q;
  for (let step = 0; step < 72; step++) {
    q = turn(q, screenTurn(0, 5));
    // Every step is exactly 5°, including across both poles: no flip, no jump, no clamp.
    assert.ok(Math.abs(angleBetween(previous, q) - 5) < 1e-6, `step ${step}`);
    previous = q;
  }
  assert.ok(angleBetween(start, q) < 1e-4);
  // Half a turn shows the opposite face: what was in front is now behind.
  assert.ok(front(turn(start, screenTurn(0, 180)))[2] < -.99 * front(start)[2]);
});

test('más de 360° en ambos ejes y cambios de dirección: la orientación sigue siendo exacta', () => {
  let q: Quat = IDENTITY;
  for (let step = 0; step < 100; step++) q = turn(q, screenTurn(9, 0));   // 900° horizontal
  for (let step = 0; step < 100; step++) q = turn(q, screenTurn(0, -9));  // 900° vertical, upwards
  for (let step = 0; step < 100; step++) q = turn(q, screenTurn(0, 9));   // and back
  for (let step = 0; step < 100; step++) q = turn(q, screenTurn(-9, 0));
  assert.ok(angleBetween(q, IDENTITY) < 1e-3, 'returns exactly');
  assert.ok(Math.abs(Math.hypot(...q) - 1) < 1e-9, 'stays a unit quaternion');
});

test('arrastrar sigue al dedo en cualquier orientación, incluso cabeza abajo', () => {
  // Drags are composed in screen space (pre-multiplied), so the piece under the finger moves
  // with it whatever the globe's current orientation: right is right, down is down (CSS y).
  for (const q of [IDENTITY, fromYawPitch(0, 180), fromYawPitch(73, 95), fromYawPitch(-140, -60)]) {
    const piece = toVector({ lat: 0, lon: 0 });
    const before = rotateVector(q, piece);
    if (before[2] < .3) continue;
    assert.ok(rotateVector(turn(q, screenTurn(10, 0)), piece)[0] > before[0]);
    assert.ok(rotateVector(turn(q, screenTurn(0, 10)), piece)[1] > before[1]);
  }
  const upsideDown = fromYawPitch(0, 180);
  const back = toVector({ lat: 0, lon: 180 });
  assert.ok(rotateVector(upsideDown, back)[2] > .99, 'after a vertical half turn the far side faces the visitor');
  assert.ok(rotateVector(turn(upsideDown, screenTurn(10, 0)), back)[0] > 0);
});

test('slerp toma el camino corto y termina exactamente en el objetivo', () => {
  const a = fromYawPitch(10, 170);
  const b = fromYawPitch(-20, -175);
  assert.ok(angleBetween(slerp(a, b, 1), b) < 1e-6);
  assert.ok(angleBetween(slerp(a, b, 0), a) < 1e-6);
  const half = slerp(a, b, .5);
  assert.ok(Math.abs(angleBetween(a, half) - angleBetween(a, b) / 2) < 1e-4);
  // q and −q are the same orientation: never the long way round.
  const negated: Quat = [-b[0], -b[1], -b[2], -b[3]];
  assert.ok(Math.abs(angleBetween(a, slerp(a, negated, .5)) - angleBetween(a, b) / 2) < 1e-4);
  assert.ok(angleBetween(a, b) <= 180);
});

test('multiplicar compone en orden: b primero, luego a', () => {
  const a = fromAxisAngle([1, 0, 0], 90);
  const b = fromAxisAngle([0, 1, 0], 90);
  assert.ok(close(rotateVector(multiply(a, b), [0, 0, 1]), rotateVector(a, rotateVector(b, [0, 0, 1]))));
});
