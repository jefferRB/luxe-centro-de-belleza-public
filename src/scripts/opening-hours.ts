/** Live opening state for <luxe-hours> (location panel) and <luxe-open-now> (hero). Both
 * subscribe to the shared opening clock, so the page shows one state everywhere. */
import { shortStatus } from '../lib/opening-hours';
import { readSchedule, subscribeOpening } from './opening-clock';

class LuxeHours extends HTMLElement {
  private cleanup?: () => void;

  connectedCallback() {
    this.cleanup?.();
    const state = this.querySelector<HTMLElement>('[data-hours-state]');
    const detail = this.querySelector<HTMLElement>('[data-hours-detail]');
    const schedule = readSchedule(this);
    if (!state || !detail || !schedule) return;
    const original = { state: state.textContent, detail: detail.textContent };
    const unsubscribe = subscribeOpening(schedule, (status) => {
      state.textContent = status.headline;
      detail.textContent = status.detail;
      this.dataset.open = String(status.open);
      for (const row of this.querySelectorAll<HTMLElement>('tr[data-day]')) {
        const today = Number(row.dataset.day) === status.today;
        row.toggleAttribute('data-today', today);
        const note = row.querySelector<HTMLElement>('[data-today-note]');
        if (note) note.hidden = !today;
      }
    });
    this.cleanup = () => {
      unsubscribe();
      state.textContent = original.state;
      detail.textContent = original.detail;
      delete this.dataset.open;
      this.querySelectorAll('tr[data-today]').forEach((row) => row.removeAttribute('data-today'));
    };
  }

  disconnectedCallback() { this.cleanup?.(); }
}

/** The hero's discreet line: «● Abierto ahora · Hasta las 7:00 p. m.». Until the browser
 * computes it, a neutral, always-true schedule summary is shown (no wrong flash). */
class LuxeOpenNow extends HTMLElement {
  private cleanup?: () => void;

  connectedCallback() {
    this.cleanup?.();
    const state = this.querySelector<HTMLElement>('[data-open-state]');
    const detail = this.querySelector<HTMLElement>('[data-open-detail]');
    const schedule = readSchedule(this);
    if (!state || !detail || !schedule) return;
    const original = { state: state.textContent, detail: detail.textContent };
    const unsubscribe = subscribeOpening(schedule, (status) => {
      state.textContent = status.headline;
      detail.textContent = shortStatus(status);
      this.dataset.open = String(status.open);
    });
    this.cleanup = () => {
      unsubscribe();
      state.textContent = original.state;
      detail.textContent = original.detail;
      delete this.dataset.open;
    };
  }

  disconnectedCallback() { this.cleanup?.(); }
}

if (!customElements.get('luxe-hours')) customElements.define('luxe-hours', LuxeHours);
if (!customElements.get('luxe-open-now')) customElements.define('luxe-open-now', LuxeOpenNow);
