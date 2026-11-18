import { createIntroMachine, INTRO_DURATION_MS } from '../lib/intro-state';

export function mountIntro() {
  const root = document.documentElement;
  const overlay = document.getElementById('luxe-intro');
  const skip = overlay?.querySelector<HTMLButtonElement>('[data-intro-skip]');
  if (!overlay || !skip) { root.dataset.luxeIntro = 'skipped'; return; }

  const machine = createIntroMachine((state) => {
    root.dataset.luxeIntro = state;
    if (state !== 'playing') {
      delete root.dataset.luxeIntroStarted;
      delete root.dataset.luxeIntroReplay;
      // Never leave focus in a hidden control; don't steal focus otherwise.
      if (document.activeElement === skip) document.getElementById('contenido')?.focus({ preventScroll: true });
    }
  });
  const safetyTimer = Number(root.dataset.luxeIntroSafety);
  machine.addCleanup(() => {
    if (Number.isFinite(safetyTimer)) window.clearTimeout(safetyTimer);
    delete root.dataset.luxeIntroSafety;
  });
  const elapsed = performance.now() - Number(root.dataset.luxeIntroStarted);
  if (root.dataset.luxeIntro !== 'playing' || !Number.isFinite(elapsed) || elapsed >= INTRO_DURATION_MS) {
    machine.send('skip');
    return;
  }

  const events = new AbortController();
  machine.addCleanup(() => events.abort());
  const skipIntro = () => machine.send('skip');
  try {
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    if (motion.matches || document.hidden) { skipIntro(); return; }
    const listenerOptions = { signal: events.signal };
    skip.addEventListener('click', skipIntro, listenerOptions);
    overlay.addEventListener('animationend', (event) => {
      if (event.target === overlay && event.animationName === 'fail-open') machine.send('complete');
    }, listenerOptions);
    overlay.addEventListener('animationcancel', (event) => {
      if (event.target === overlay) skipIntro();
    }, listenerOptions);
    window.addEventListener('pagehide', skipIntro, listenerOptions);
    document.addEventListener('visibilitychange', () => { if (document.hidden) skipIntro(); }, listenerOptions);
    motion.addEventListener('change', (event) => { if (event.matches) skipIntro(); }, listenerOptions);
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') skipIntro(); }, listenerOptions);
    // Keyboard users reaching any other control see it immediately.
    document.addEventListener('focusin', (event) => { if (event.target !== skip) skipIntro(); }, listenerOptions);
    window.addEventListener('error', skipIntro, listenerOptions);
    window.addEventListener('unhandledrejection', skipIntro, listenerOptions);
    const timer = window.setTimeout(() => machine.send('complete'), Math.max(0, INTRO_DURATION_MS - elapsed));
    machine.addCleanup(() => window.clearTimeout(timer));
    machine.send('play');
  } catch { skipIntro(); }
}

mountIntro();
