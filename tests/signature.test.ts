import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FACETS, centroid, polygonArea } from '../src/lib/facets.ts';
import { HoverIntent, HOVER_INTENT_MS } from '../src/lib/signature-state.ts';
import { services } from '../src/data/services.ts';
import { isWork, mediaCatalog } from '../src/data/media-catalog.ts';

test('seis facetas que cubren el marco exactamente, con el diamante en el centro', () => {
  assert.equal(FACETS.length, 6);
  assert.equal(new Set(FACETS.map((facet) => facet.id)).size, 6);
  for (const facet of FACETS) {
    assert.ok(polygonArea(facet.points) > 0, facet.id);
    for (const [x, y] of facet.points) assert.ok(x >= 0 && x <= 100 && y >= 0 && y <= 100);
  }
  assert.equal(FACETS.reduce((sum, facet) => sum + polygonArea(facet.points), 0), 10_000);
  const crown = FACETS.find((facet) => facet.id === 'crown')!;
  const pavilion = FACETS.find((facet) => facet.id === 'pavilion')!;
  assert.deepEqual(crown.points[0], [50, 0]);
  assert.deepEqual(pavilion.points.at(-1), [50, 100]);
  assert.deepEqual(centroid([[0, 0], [100, 0], [100, 100], [0, 100]]), [50, 50]);
});

function fakeTimers() {
  let now = 0;
  const queue = new Map<number, { at: number; run: () => void }>();
  let id = 0;
  return {
    schedule: (run: () => void, delay: number) => { queue.set(++id, { at: now + delay, run }); return id; },
    clear: (handle: unknown) => { queue.delete(handle as number); },
    advance(ms: number) {
      now += ms;
      for (const [key, entry] of [...queue]) if (entry.at <= now) { queue.delete(key); entry.run(); }
    },
  };
}

test('hover intencional: cruzar filas no selecciona; reposar sí', () => {
  const timers = fakeTimers();
  const intent = new HoverIntent<number>(HOVER_INTENT_MS, timers.schedule, timers.clear);
  const committed: number[] = [];
  const commit = (key: number) => committed.push(key);
  for (const row of [0, 1, 2, 3]) { intent.enter(row, commit); timers.advance(40); intent.leave(row); }
  timers.advance(500);
  assert.deepEqual(committed, []);
  intent.enter(4, commit);
  timers.advance(HOVER_INTENT_MS - 1);
  assert.deepEqual(committed, []);
  intent.enter(4, commit);
  timers.advance(1);
  assert.deepEqual(committed, [4]);
  intent.enter(2, commit);
  intent.enter(3, commit);
  timers.advance(HOVER_INTENT_MS);
  assert.deepEqual(committed, [4, 3]);
  intent.enter(1, commit);
  intent.cancel();
  timers.advance(1_000);
  assert.deepEqual(committed, [4, 3]);
  assert.equal(intent.pending, undefined);
});

test('datos de especialidades: fotos del catálogo, mensajes sin promesas ni precios', () => {
  for (const service of services) {
    assert.ok(service.message.length > 20);
    assert.doesNotMatch(service.message, /₡|\$|garantiz|100\s?%|cura|médic|resultado/i);
    if (!service.mediaId) continue;
    const record = mediaCatalog.find((item) => item.id === service.mediaId);
    assert.ok(record && isWork(record) && record.category === service.category && record.kind !== 'promotion', service.id);
  }
});
