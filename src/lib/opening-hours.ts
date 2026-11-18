/** Opening hours and the live "open now" status. Pure: the schedule (data/luxe.ts) and
 * the instant are inputs, and the business time zone is always explicit, so a visitor
 * abroad sees Costa Rica's state, never their own clock's. */

/** 0 = domingo … 6 = sábado (Date#getDay convention). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type ClockTime = `${number}:${number}`;
export interface OpeningPeriod { readonly day: Weekday; readonly opens: ClockTime; readonly closes: ClockTime }
export interface WeeklySchedule {
  readonly timeZone: string;
  /** Days without a period are closed. One period per day: LUXE does not close at noon. */
  readonly periods: readonly OpeningPeriod[];
}
export interface OpeningStatus {
  readonly open: boolean;
  readonly today: Weekday;
  readonly headline: 'Abierto ahora' | 'Cerrado ahora';
  /** «Cierra a las 7:00 p. m.», «Abre hoy/mañana/el lunes a las 9:00 a. m.» */
  readonly detail: string;
  /** Structured next change, shared by every view (location panel, hero). */
  readonly next?: NextChange;
}
export type NextChange =
  | { readonly kind: 'closes'; readonly time: ClockTime }
  | { readonly kind: 'opens'; readonly time: ClockTime; readonly day: Weekday; readonly daysAhead: number };
export interface ScheduleRow { readonly day: Weekday; readonly label: string; readonly hours: string; readonly open: boolean }

export const WEEKDAY_NAMES: Readonly<Record<Weekday, string>> = {
  0: 'domingo', 1: 'lunes', 2: 'martes', 3: 'miércoles', 4: 'jueves', 5: 'viernes', 6: 'sábado',
};
/** Display order: the week starts on Monday in Costa Rica. */
export const WEEK_ORDER: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 0];
const SHORT_DAYS: Readonly<Record<string, Weekday>> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const capitalize = (text: string) => text.charAt(0).toLocaleUpperCase('es-CR') + text.slice(1);

export function toMinutes(time: ClockTime): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  const hours = Number(match?.[1]);
  const minutes = Number(match?.[2]);
  if (!match || hours > 24 || minutes > 59 || (hours === 24 && minutes > 0)) throw new RangeError(`Hora no válida: ${time}`);
  return hours * 60 + minutes;
}

/** Costa Rican convention: «9:00 a. m.», «7:00 p. m.», «12:00 p. m.» (noon). */
export function formatTime(time: ClockTime): string {
  const total = toMinutes(time) % (24 * 60);
  const hours = Math.floor(total / 60);
  const minutes = String(total % 60).padStart(2, '0');
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  return `${twelve}:${minutes} ${hours < 12 ? 'a. m.' : 'p. m.'}`;
}

/** Weekday and minutes since midnight of an instant in the given IANA zone. */
export function zonedClock(instant: Date, timeZone: string): { readonly day: Weekday; readonly minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? '';
  const day = SHORT_DAYS[part('weekday')];
  if (day === undefined) throw new RangeError('Día no reconocido');
  // Some engines still print midnight as «24» even with h23.
  return { day, minutes: (Number(part('hour')) % 24) * 60 + Number(part('minute')) };
}

export function periodFor(schedule: WeeklySchedule, day: Weekday): OpeningPeriod | undefined {
  return schedule.periods.find((period) => period.day === day);
}

export function openingStatus(instant: Date, schedule: WeeklySchedule): OpeningStatus {
  const { day: today, minutes } = zonedClock(instant, schedule.timeZone);
  const current = periodFor(schedule, today);
  // Opening minute included, closing minute excluded: at 7:00 p. m. sharp LUXE is closed.
  if (current && minutes >= toMinutes(current.opens) && minutes < toMinutes(current.closes)) {
    const next: NextChange = { kind: 'closes', time: current.closes };
    return { open: true, today, headline: 'Abierto ahora', detail: `Cierra a las ${formatTime(current.closes)}`, next };
  }
  const next = nextOpening(schedule, today, minutes);
  return { open: false, today, headline: 'Cerrado ahora', detail: next ? `Abre ${whenLabel(next)} a las ${formatTime(next.time)}` : '', next };
}

function nextOpening(schedule: WeeklySchedule, today: Weekday, minutes: number): Extract<NextChange, { kind: 'opens' }> | undefined {
  const current = periodFor(schedule, today);
  if (current && minutes < toMinutes(current.opens)) return { kind: 'opens', time: current.opens, day: today, daysAhead: 0 };
  for (let ahead = 1; ahead <= 7; ahead++) {
    const day = ((today + ahead) % 7) as Weekday;
    const period = periodFor(schedule, day);
    if (period) return { kind: 'opens', time: period.opens, day, daysAhead: ahead };
  }
  return undefined;
}

/** «hoy», «mañana» or «el lunes»: the next opening day counted in business days. */
function whenLabel(next: Extract<NextChange, { kind: 'opens' }>): string {
  return next.daysAhead === 0 ? 'hoy' : next.daysAhead === 1 ? 'mañana' : `el ${WEEKDAY_NAMES[next.day]}`;
}

/** The hero's short line: «Hasta las 7:00 p. m.» or «Abrimos mañana a las 9:00 a. m.». */
export function shortStatus(status: OpeningStatus): string {
  if (!status.next) return '';
  if (status.next.kind === 'closes') return `Hasta las ${formatTime(status.next.time)}`;
  return `Abrimos ${whenLabel(status.next)} a las ${formatTime(status.next.time)}`;
}

export function formatPeriod(period: OpeningPeriod | undefined): string {
  return period ? `${formatTime(period.opens)} – ${formatTime(period.closes)}` : 'Cerrado';
}

/** One row per day, Monday first, for the expandable schedule. */
export function scheduleRows(schedule: WeeklySchedule): ScheduleRow[] {
  return WEEK_ORDER.map((day) => {
    const period = periodFor(schedule, day);
    return { day, label: capitalize(WEEKDAY_NAMES[day]), hours: formatPeriod(period), open: Boolean(period) };
  });
}

/** Consecutive days with equal hours, e.g. «Lunes a sábado: 9:00 a. m. – 7:00 p. m.». */
export function scheduleSummary(schedule: WeeklySchedule): string[] {
  const rows = scheduleRows(schedule);
  const groups: ScheduleRow[][] = [];
  for (const row of rows) {
    const last = groups.at(-1);
    if (last && last[0]!.hours === row.hours) last.push(row);
    else groups.push([row]);
  }
  return groups.map((group) => {
    const first = group[0]!;
    const span = group.length === 1 ? first.label : `${first.label} a ${WEEKDAY_NAMES[group.at(-1)!.day]}`;
    return `${span}: ${first.open ? first.hours : 'cerrado'}`;
  });
}
