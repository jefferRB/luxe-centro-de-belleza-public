/** One opening clock for the whole page. The hero and the location panel subscribe to the
 * same computation (lib/opening-hours.ts) at the same instant, so they can never disagree.
 * It runs in the browser (the site is static: nothing is frozen at build time), refreshes
 * on the next minute boundary — the state can only change on a minute — and again when
 * the tab becomes visible. */
import { openingStatus, type OpeningStatus, type WeeklySchedule } from '../lib/opening-hours';

type Listener = (status: OpeningStatus) => void;

const listeners = new Map<Listener, WeeklySchedule>();
let timer = 0;
let watching = false;

function tick() {
  window.clearTimeout(timer);
  const now = new Date();
  for (const [listener, schedule] of listeners) {
    try { listener(openingStatus(now, schedule)); } catch { /* That view keeps its static schedule. */ }
  }
  if (listeners.size) timer = window.setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
}
const onVisible = () => { if (document.visibilityState === 'visible') tick(); };

/** Calls `listener` now and on every change; returns the unsubscribe function. */
export function subscribeOpening(schedule: WeeklySchedule, listener: Listener): () => void {
  listeners.set(listener, schedule);
  if (!watching) { document.addEventListener('visibilitychange', onVisible); watching = true; }
  tick();
  return () => {
    listeners.delete(listener);
    if (listeners.size) return;
    window.clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisible);
    watching = false;
  };
}

export function readSchedule(element: HTMLElement): WeeklySchedule | undefined {
  try {
    const schedule = JSON.parse(element.dataset.schedule ?? '') as WeeklySchedule;
    return Array.isArray(schedule?.periods) ? schedule : undefined;
  } catch { return undefined; }
}
