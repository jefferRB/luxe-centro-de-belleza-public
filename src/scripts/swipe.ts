/** Horizontal swipe for touch and pen (optionally mouse). Vertical scrolling stays native:
 * the element is expected to declare `touch-action: pan-y`. */
export const SWIPE_DISTANCE = 48;

export function onSwipe(element: HTMLElement, onStep: (delta: 1 | -1) => void, signal: AbortSignal, options: { readonly mouse?: boolean } = {}) {
  let start: { id: number; x: number; y: number } | undefined;
  element.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && (!options.mouse || event.button !== 0)) return;
    start = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }, { signal });
  element.addEventListener('pointerup', (event) => {
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    start = undefined;
    if (Math.abs(dx) >= SWIPE_DISTANCE && Math.abs(dx) > Math.abs(dy) * 1.5) onStep(dx < 0 ? 1 : -1);
  }, { signal });
  element.addEventListener('pointercancel', () => { start = undefined; }, { signal });
}
