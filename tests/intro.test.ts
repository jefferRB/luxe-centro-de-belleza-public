import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createIntroMachine, INTRO_DURATION_MS, INTRO_SESSION_KEY, transitionIntro, type IntroState } from '../src/lib/intro-state.ts';

// Exercise the real pre-paint gate; do not keep a second eligibility algorithm.
const source = readFileSync(new URL('../src/components/hero/ScissorsIntro.astro', import.meta.url), 'utf8');
const gate = source.match(/<script is:inline define:vars=[^>]+>([\s\S]*?)<\/script>/)?.[1];
assert.ok(gate, 'El gate de arranque existe');
function boot(options: { seen?: boolean; reduced?: boolean; hidden?: boolean; replay?: boolean; denyRead?: boolean; denyWrite?: boolean } = {}) {
  const dataset: Record<string, string> = {};
  if (options.replay) dataset.luxeIntroReplay = 'true';
  const storage = new Map<string, string>(options.seen ? [[INTRO_SESSION_KEY, '1']] : []);
  const timers: Array<() => void> = [];
  runInNewContext(gate!, {
    sessionKey: INTRO_SESSION_KEY, duration: INTRO_DURATION_MS,
    document: { documentElement: { dataset }, hidden: options.hidden ?? false },
    performance: { now: () => 10 },
    matchMedia: () => ({ matches: options.reduced ?? false }),
    sessionStorage: {
      getItem: (key: string) => { if (options.denyRead) throw new Error('Read denied'); return storage.get(key) ?? null; },
      setItem: (key: string, value: string) => { if (options.denyWrite) throw new Error('Write denied'); storage.set(key, value); },
    },
    setTimeout: (callback: () => void) => { timers.push(callback); return timers.length; },
  });
  return { dataset, storage, timers };
}

test('Primera visita elegible; repetición y movimiento reducido se omiten', () => {
  assert.equal(boot().dataset.luxeIntro, 'playing');
  assert.equal(boot({ seen: true }).dataset.luxeIntro, 'skipped');
  assert.equal(boot({ hidden: true }).dataset.luxeIntro, 'skipped');
  assert.equal(boot({ seen: true, replay: true }).dataset.luxeIntro, 'playing');
  assert.equal(boot({ reduced: true, replay: true }).dataset.luxeIntro, 'skipped');
});

test('El estado avanza de idle a playing a completed y no se reinicia', () => {
  const states: IntroState[] = [];
  const machine = createIntroMachine((state) => states.push(state));
  assert.equal(machine.state, 'idle');
  machine.send('complete');
  assert.equal(machine.state, 'idle');
  machine.send('play');
  machine.send('play');
  machine.send('complete');
  machine.send('play');
  machine.send('skip');
  assert.deepEqual(states, ['playing', 'completed']);
});

test('Omitir desde idle y durante reproducción es terminal', () => {
  assert.equal(transitionIntro('idle', 'skip'), 'skipped');
  assert.equal(transitionIntro('playing', 'skip'), 'skipped');
  assert.equal(transitionIntro('skipped', 'play'), 'skipped');
  assert.equal(transitionIntro('skipped', 'complete'), 'skipped');
});

for (const terminal of ['skip', 'complete'] as const) {
  test(`La ruta ${terminal} limpia timers/listeners exactamente una vez`, () => {
    let activeTimers = 1;
    let activeListeners = 1;
    const machine = createIntroMachine(() => {});
    machine.addCleanup(() => { activeTimers--; });
    machine.addCleanup(() => { throw new Error('Recurso ya destruido'); });
    machine.addCleanup(() => { activeListeners--; });
    machine.send('play');
    machine.send(terminal);
    machine.send(terminal);
    assert.equal(activeTimers, 0);
    assert.equal(activeListeners, 0);
    let lateResource = true;
    machine.addCleanup(() => { lateResource = false; });
    assert.equal(lateResource, false);
  });
}

test('Marca sesión antes de reproducir; siguiente visita no repite', () => {
  const first = boot();
  assert.equal(first.storage.get(INTRO_SESSION_KEY), '1');
  assert.equal(boot({ seen: true }).timers.length, 0);
});

test('Fallo de lectura o escritura de almacenamiento omite sin propagar errores', () => {
  assert.equal(boot({ denyRead: true }).dataset.luxeIntro, 'skipped');
  assert.equal(boot({ denyWrite: true }).dataset.luxeIntro, 'skipped');
  assert.equal(boot({ denyWrite: true, replay: true }).dataset.luxeIntro, 'skipped');
});

test('El respaldo inline libera la portada aunque no llegue el módulo', () => {
  const { dataset, timers } = boot();
  timers[0]?.();
  assert.equal(dataset.luxeIntro, 'completed');
  assert.equal(dataset.luxeIntroSafety, undefined);
  assert.equal(dataset.luxeIntroStarted, undefined);
});

test('Un fallo de render terminal no deja recursos vivos', () => {
  let cleaned = false;
  const machine = createIntroMachine(() => { throw new Error('Disconnected DOM'); });
  machine.addCleanup(() => { cleaned = true; });
  assert.throws(() => machine.send('skip'));
  assert.equal(cleaned, true);
});
