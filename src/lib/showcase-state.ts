/** Pure showcase navigation: one category, one position, nothing else.
 * Shared by the client controller and unit tests; no DOM access. */
export const ALL_CATEGORY = 'all';

export interface ShowcaseEntry { readonly id: string; readonly category: string }

export function sequenceFor<T extends ShowcaseEntry>(entries: readonly T[], category: string): readonly T[] {
  return category === ALL_CATEGORY ? entries : entries.filter((entry) => entry.category === category);
}

export function wrapIndex(index: number, count: number): number {
  if (!Number.isInteger(count) || count <= 0) return 0;
  return ((Math.trunc(index) % count) + count) % count;
}

export function formatCounter(index: number, count: number): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return count > 0 ? `${pad(wrapIndex(index, count) + 1)} / ${pad(count)}` : '00 / 00';
}

export function createShowcaseState<T extends ShowcaseEntry>(entries: readonly T[]) {
  let category = ALL_CATEGORY;
  let sequence = sequenceFor(entries, category);
  let index = 0;
  return {
    get category() { return category; },
    get index() { return index; },
    get count() { return sequence.length; },
    get current(): T | undefined { return sequence[index]; },
    /** Always starts at the category's first work; empty categories are ignored. */
    select(next: string): T | undefined {
      const candidate = sequenceFor(entries, next);
      if (!candidate.length) return undefined;
      category = next;
      sequence = candidate;
      index = 0;
      return sequence[0];
    },
    step(delta: number): T | undefined {
      if (!sequence.length) return undefined;
      index = wrapIndex(index + delta, sequence.length);
      return sequence[index];
    },
  };
}
