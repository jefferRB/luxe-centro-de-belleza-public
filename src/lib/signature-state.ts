/** Hover intent for the specialties list. Pure; timers are injected for tests. */
/** Hover must rest this long on a row: crossing the list never changes the selection. */
export const HOVER_INTENT_MS = 140;

type Schedule = (callback: () => void, delay: number) => unknown;
type Cancel = (handle: unknown) => void;

export class HoverIntent<K> {
  private handle: unknown;
  private target: K | undefined;
  private readonly delay: number;
  private readonly schedule: Schedule;
  private readonly clear: Cancel;

  // Explicit fields: node --experimental-strip-types cannot run parameter properties.
  constructor(delay: number, schedule: Schedule = (callback, ms) => setTimeout(callback, ms), clear: Cancel = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)) {
    this.delay = delay;
    this.schedule = schedule;
    this.clear = clear;
  }

  enter(key: K, commit: (key: K) => void) {
    if (this.target === key && this.handle !== undefined) return;
    this.cancel();
    this.target = key;
    this.handle = this.schedule(() => {
      this.handle = undefined;
      this.target = undefined;
      commit(key);
    }, this.delay);
  }

  leave(key: K) { if (this.target === key) this.cancel(); }

  cancel() {
    if (this.handle !== undefined) this.clear(this.handle);
    this.handle = undefined;
    this.target = undefined;
  }

  get pending(): K | undefined { return this.target; }
}
