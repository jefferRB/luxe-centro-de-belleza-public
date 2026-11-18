export const INTRO_SESSION_KEY = 'luxe:intro:seen:v1';
export const INTRO_DURATION_MS = 1500;
export type IntroState = 'idle' | 'playing' | 'skipped' | 'completed';
export type IntroEvent = 'play' | 'skip' | 'complete';

export function transitionIntro(state: IntroState, event: IntroEvent): IntroState {
  if (state === 'idle') return event === 'play' ? 'playing' : event === 'skip' ? 'skipped' : state;
  if (state === 'playing') return event === 'complete' ? 'completed' : event === 'skip' ? 'skipped' : state;
  return state;
}

/** Ownership of timers/listeners remains explicit; all terminal paths dispose. */
export function createIntroMachine(onState: (state: IntroState) => void) {
  let state: IntroState = 'idle';
  let cleanups: Array<() => void> = [];
  const release = () => {
    const pending = cleanups;
    cleanups = [];
    // One failed cleanup must not strand the remaining listeners or timers.
    for (const cleanup of pending) { try { cleanup(); } catch { /* Best-effort teardown. */ } }
  };
  return {
    get state() { return state; },
    addCleanup(cleanup: () => void) {
      if (state === 'skipped' || state === 'completed') cleanup();
      else cleanups.push(cleanup);
    },
    send(event: IntroEvent) {
      const next = transitionIntro(state, event);
      if (next === state) return;
      state = next;
      try { onState(state); }
      finally { if (state === 'skipped' || state === 'completed') release(); }
    },
  };
}

