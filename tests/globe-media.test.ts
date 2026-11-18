import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frontmost, KEEP_DEPTH, pickPlaying, PLAY_DEPTH, SETTLE_DEPTH } from '../src/lib/globe-media.ts';
import { spreadByTag, fibonacciSphere, angularDistance } from '../src/lib/sphere.ts';
import { decay } from '../src/lib/sphere.ts';

const on = { visible: true, stillOnly: false } as const;

test('reproducción: como máximo un video, el más frontal y suficientemente visible', () => {
  assert.equal(pickPlaying([{ index: 3, depth: .98 }, { index: 7, depth: .7 }], -1, on), 3);
  assert.equal(pickPlaying([{ index: 3, depth: .2 }, { index: 7, depth: .7 }], -1, on), 7);
  // Behind or on the silhouette: posters only.
  assert.equal(pickPlaying([{ index: 3, depth: PLAY_DEPTH - .01 }, { index: 7, depth: -.9 }], -1, on), -1);
  assert.equal(pickPlaying([], -1, on), -1);
});

test('reproducción: histéresis para que un vaivén no la encienda y apague', () => {
  const between = (PLAY_DEPTH + KEEP_DEPTH) / 2;
  assert.equal(pickPlaying([{ index: 3, depth: between }], -1, on), -1, 'does not start in the band');
  assert.equal(pickPlaying([{ index: 3, depth: between }], 3, on), 3, 'keeps playing in the band');
  assert.equal(pickPlaying([{ index: 3, depth: KEEP_DEPTH - .01 }], 3, on), -1, 'stops beyond it');
});

test('reproducción: fuera de pantalla, con el visor abierto, movimiento reducido o ahorro de datos, nada se reproduce', () => {
  const clips = [{ index: 1, depth: 1 }];
  assert.equal(pickPlaying(clips, 1, { visible: false, stillOnly: false }), -1);
  assert.equal(pickPlaying(clips, -1, { visible: true, stillOnly: true }), -1);
});

test('acomodo tras arrastrar: solo una pieza cercana al frente se asienta', () => {
  assert.equal(frontmost([{ index: 0, depth: .5 }, { index: 4, depth: .95 }, { index: 9, depth: .93 }]), 4);
  assert.equal(frontmost([{ index: 0, depth: SETTLE_DEPTH - .01 }]), -1, 'between pieces: the world stays where it was left');
});

test('distribución por tipo: cada categoría se reparte por toda la esfera', () => {
  const points = fibonacciSphere(24);
  const items = Array.from({ length: 18 }, (_, index) => ({ tag: ['a', 'b', 'c'][index % 3]! }));
  const placed = spreadByTag(points, new Set(), [], items);
  assert.equal(placed.length, 18);
  assert.equal(new Set(placed.map((entry) => entry.index)).size, 18);
  for (const tag of ['a', 'b', 'c']) {
    const own = placed.filter((entry) => entry.item.tag === tag);
    const nearest = own.map((entry) => Math.min(...own.filter((other) => other !== entry).map((other) => angularDistance(other.point, entry.point))));
    assert.ok(Math.min(...nearest) > 45, `${tag} spread: ${Math.min(...nearest)}`);
  }
});

test('inercia moderada: un lanzamiento fuerte se detiene en menos de dos segundos', () => {
  let velocity = .9;
  let time = 0;
  while (Math.abs(velocity) > .003 && time < 5_000) { velocity = decay(velocity, 16); time += 16; }
  assert.ok(time < 2_000);
});
