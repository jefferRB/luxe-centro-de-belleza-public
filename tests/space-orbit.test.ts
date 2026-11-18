import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crownDragUnit, crownPose, crownStyle, crownStyleText, DEFAULT_CROWN, neighbours } from '../src/lib/space-orbit.ts';
import { frontIndex, settleTarget, shortestTarget } from '../src/lib/orbit-layout.ts';

test('corona del espacio: la vista elegida queda al frente, centrada, entera y sin girar', () => {
  const front = crownPose(0, 5);
  assert.deepEqual([front.ox, front.oy, front.turn, front.scale, front.opacity, front.depth], [0, 1, 0, 1, 1, 1]);
  for (let offset = 1; offset < 5; offset++) {
    const other = crownPose(offset, 5);
    assert.ok(other.zIndex < front.zIndex, 'nothing stacks over the front card');
    assert.ok(other.scale < 1 && other.opacity < 1 && other.oy < 1);
  }
});

test('corona del espacio: las tarjetas recorren una elipse simétrica (anillo de Saturno)', () => {
  for (const offset of [1, 2]) {
    const right = crownPose(offset, 5);
    const left = crownPose(-offset, 5);
    assert.equal(right.ox, -left.ox);
    assert.equal(right.oy, left.oy);
    assert.equal(right.turn, -left.turn);
    assert.ok(right.ox > 0, 'the next view waits on the right');
    // Every pose lies on the unit ellipse: CSS radii and SVG rings match exactly.
    assert.ok(Math.abs(right.ox ** 2 + right.oy ** 2 - 1) < 1e-3);
  }
  // The far side rises (oy < 0) and shrinks: depth, not a flat row.
  assert.ok(crownPose(2, 5).oy < 0 && crownPose(2, 5).scale < crownPose(1, 5).scale);
  assert.ok(crownPose(1, 5).turn < 0 && Math.abs(crownPose(1, 5).turn) <= DEFAULT_CROWN.facing);
});

test('corona del espacio: circular en ambos sentidos, sin extremos ni saltos', () => {
  // The last view is the left neighbour of the first, the first the right neighbour of the last.
  assert.deepEqual(crownPose(4, 5), crownPose(-1, 5));
  assert.deepEqual(crownPose(-4, 5), crownPose(1, 5));
  assert.deepEqual(crownPose(12, 5), crownPose(2, 5));
  // Continuous through the wrap: a tiny turn past the far side moves a tiny distance.
  const a = crownPose(2.49, 5);
  const b = crownPose(2.51, 5);
  assert.ok(Math.hypot(a.ox - b.ox, a.oy - b.oy) < .05);
  // Shortest way round, and the front index wraps after any number of turns.
  assert.equal(shortestTarget(0, 4, 5), -1);
  assert.equal(shortestTarget(4, 0, 5), 5);
  assert.equal(frontIndex(-1, 5), 4);
  assert.equal(frontIndex(5, 5), 0);
  assert.equal(frontIndex(-23, 5), 2);
});

test('corona del espacio: soltar un arrastre se acomoda en una vista, con inercia moderada', () => {
  assert.equal(settleTarget(1.4, 0), 1);
  assert.equal(settleTarget(1.6, 0), 2);
  assert.equal(settleTarget(0, 1, 2), 2, 'a throw never spins more than the cap');
  assert.equal(settleTarget(0, -1, 2), -2);
  assert.ok(crownDragUnit(300, 5) > 200 && crownDragUnit(300, 5) < 400);
  assert.equal(crownDragUnit(0, 5), 40);
  assert.equal(crownDragUnit(Number.NaN, 5), 64);
});

test('corona del espacio: estilo en línea idéntico en el servidor y en el navegador', () => {
  const pose = crownPose(1, 5);
  const style = crownStyle(pose);
  assert.equal(style['--turn'], `${pose.turn}deg`);
  assert.equal(style['z-index'], String(pose.zIndex));
  assert.match(crownStyleText(pose), /^--ox:[-\d.]+;--oy:[-\d.]+;--turn:[-\d.]+deg;--scale:[\d.]+;--depth:[\d.]+;opacity:[\d.]+;z-index:\d+$/);
});

test('corona del espacio: precarga limitada a la vista elegida y sus vecinas', () => {
  assert.deepEqual(neighbours(0, 5), [0, 1, 4]);
  assert.deepEqual(neighbours(4, 5), [4, 0, 3]);
  assert.deepEqual(neighbours(0, 1), [0]);
  assert.deepEqual(neighbours(1, 2), [1, 0]);
  assert.deepEqual(neighbours(0, 0), []);
});

test('corona del espacio: casos límite sin valores inválidos', () => {
  for (const pose of [crownPose(0, 0), crownPose(0, 1), crownPose(Number.NaN, 5), crownPose(Infinity, 5)]) {
    for (const value of Object.values(pose)) assert.ok(Number.isFinite(value));
  }
});
