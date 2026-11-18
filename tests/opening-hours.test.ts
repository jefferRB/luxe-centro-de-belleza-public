import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTime, openingStatus, scheduleRows, scheduleSummary, shortStatus, toMinutes, zonedClock, type WeeklySchedule } from '../src/lib/opening-hours.ts';
import { luxe } from '../src/data/luxe.ts';

const schedule = luxe.contact.hours.value as WeeklySchedule;
/** Costa Rica is UTC−6 all year (no daylight saving): 9:00 local = 15:00 UTC. */
const cr = (isoLocal: string) => new Date(`${isoLocal}-06:00`);
// 2026-11-02 is a Monday; 2026-11-07 a Saturday; 2026-11-08 a Sunday.

test('el horario confirmado es lunes a sábado de 9:00 a 19:00, domingo cerrado, en hora de Costa Rica', () => {
  assert.equal(schedule.timeZone, 'America/Costa_Rica');
  assert.deepEqual(scheduleRows(schedule).map((row) => [row.label, row.hours]), [
    ['Lunes', '9:00 a. m. – 7:00 p. m.'], ['Martes', '9:00 a. m. – 7:00 p. m.'], ['Miércoles', '9:00 a. m. – 7:00 p. m.'],
    ['Jueves', '9:00 a. m. – 7:00 p. m.'], ['Viernes', '9:00 a. m. – 7:00 p. m.'], ['Sábado', '9:00 a. m. – 7:00 p. m.'], ['Domingo', 'Cerrado'],
  ]);
  assert.deepEqual(scheduleSummary(schedule), ['Lunes a sábado: 9:00 a. m. – 7:00 p. m.', 'Domingo: cerrado']);
});

test('formato de hora costarricense', () => {
  assert.equal(formatTime('09:00'), '9:00 a. m.');
  assert.equal(formatTime('19:00'), '7:00 p. m.');
  assert.equal(formatTime('12:00'), '12:00 p. m.');
  assert.equal(formatTime('00:30'), '12:30 a. m.');
  assert.equal(toMinutes('19:00'), 1140);
  for (const bad of ['25:00', '9', '09:60', 'ab:cd', '24:01'] as const) assert.throws(() => toMinutes(bad as `${number}:${number}`), RangeError);
});

const cases: readonly [string, boolean, string][] = [
  ['2026-11-02T08:59:59', false, 'Abre hoy a las 9:00 a. m.'],
  ['2026-11-02T09:00:00', true, 'Cierra a las 7:00 p. m.'],
  ['2026-11-02T13:30:00', true, 'Cierra a las 7:00 p. m.'],
  ['2026-11-02T18:59:59', true, 'Cierra a las 7:00 p. m.'],
  ['2026-11-02T19:00:00', false, 'Abre mañana a las 9:00 a. m.'],
  ['2026-11-02T23:59:00', false, 'Abre mañana a las 9:00 a. m.'],
  ['2026-11-03T00:00:00', false, 'Abre hoy a las 9:00 a. m.'],
  ['2026-11-07T10:00:00', true, 'Cierra a las 7:00 p. m.'],
  ['2026-11-07T19:00:00', false, 'Abre el lunes a las 9:00 a. m.'],
  ['2026-11-08T00:00:00', false, 'Abre mañana a las 9:00 a. m.'],
  ['2026-11-08T12:00:00', false, 'Abre mañana a las 9:00 a. m.'],
  ['2026-11-08T23:59:00', false, 'Abre mañana a las 9:00 a. m.'],
];
for (const [local, open, detail] of cases) {
  test(`estado en Costa Rica ${local}: ${open ? 'abierto' : 'cerrado'}`, () => {
    const status = openingStatus(cr(local), schedule);
    assert.equal(status.open, open);
    assert.equal(status.headline, open ? 'Abierto ahora' : 'Cerrado ahora');
    assert.equal(status.detail, detail);
  });
}

test('la zona del visitante no cambia el resultado: se usa siempre America/Costa_Rica', () => {
  // 2026-11-03T01:30Z is Tuesday in UTC/Tokyo but still Monday 19:30 in Costa Rica.
  const instant = new Date('2026-11-03T01:30:00Z');
  assert.deepEqual(zonedClock(instant, 'America/Costa_Rica'), { day: 1, minutes: 19 * 60 + 30 });
  const status = openingStatus(instant, schedule);
  assert.equal(status.today, 1);
  assert.equal(status.open, false);
  assert.equal(status.detail, 'Abre mañana a las 9:00 a. m.');
  // 15:00Z on a Monday is 9:00 in Costa Rica: opening minute included.
  assert.equal(openingStatus(new Date('2026-11-02T15:00:00Z'), schedule).open, true);
  assert.equal(openingStatus(new Date('2026-11-03T01:00:00Z'), schedule).open, false);
});

test('cambio de día a medianoche en Costa Rica, no en UTC', () => {
  assert.equal(zonedClock(new Date('2026-11-08T05:59:00Z'), 'America/Costa_Rica').day, 6);
  assert.equal(zonedClock(new Date('2026-11-08T06:00:00Z'), 'America/Costa_Rica').day, 0);
  assert.deepEqual(zonedClock(new Date('2026-11-08T06:00:00Z'), 'America/Costa_Rica'), { day: 0, minutes: 0 });
});

test('un horario vacío nunca inventa una apertura', () => {
  const status = openingStatus(cr('2026-11-02T10:00:00'), { timeZone: 'America/Costa_Rica', periods: [] });
  assert.equal(status.open, false);
  assert.equal(status.detail, '');
});

test('portada: la misma lógica da la línea corta «Hasta…» / «Abrimos…», sin contradicciones', () => {
  const cases: readonly [string, string, string][] = [
    ['2026-11-02T09:00:00', 'Abierto ahora', 'Hasta las 7:00 p. m.'],
    ['2026-11-02T18:59:00', 'Abierto ahora', 'Hasta las 7:00 p. m.'],
    ['2026-11-02T19:00:00', 'Cerrado ahora', 'Abrimos mañana a las 9:00 a. m.'],
    ['2026-11-03T07:30:00', 'Cerrado ahora', 'Abrimos hoy a las 9:00 a. m.'],
    // Saturday after closing: the next opening is Monday, never Sunday.
    ['2026-11-07T19:00:00', 'Cerrado ahora', 'Abrimos el lunes a las 9:00 a. m.'],
    ['2026-11-07T23:59:00', 'Cerrado ahora', 'Abrimos el lunes a las 9:00 a. m.'],
    ['2026-11-08T10:00:00', 'Cerrado ahora', 'Abrimos mañana a las 9:00 a. m.'],
  ];
  for (const [local, headline, short] of cases) {
    const status = openingStatus(cr(local), schedule);
    assert.equal(status.headline, headline, local);
    assert.equal(shortStatus(status), short, local);
    // Both views read the same structured next change.
    if (status.next?.kind === 'opens') assert.match(status.detail, new RegExp(`${short.replace('Abrimos ', 'Abre ').replace(/\./g, '\.')}$`));
    else assert.equal(status.detail, `Cierra a las ${formatTime(status.next!.time)}`);
  }
  assert.equal(shortStatus(openingStatus(cr('2026-11-02T10:00:00'), { timeZone: 'America/Costa_Rica', periods: [] })), '');
});
