/** LUXE Showcase "corona": the current work large in the centre, its neighbours curving
 * away in 3D (scripts/orbit-stage.ts). Filters, arrows, counter, swipe/drag, keyboard
 * and the shared lightbox. Progressive enhancement over the server-rendered first work. */
import { ALL_CATEGORY, createShowcaseState, formatCounter, type ShowcaseEntry } from '../lib/showcase-state';
import type { OrbitProfile } from '../lib/orbit-layout';
import { openLightbox, readLightboxItem, type LightboxItem } from './lightbox';
import { OrbitStage, type OrbitSource } from './orbit-stage';

interface ShowcaseItem extends ShowcaseEntry {
  readonly card: HTMLElement;
  readonly categoryLabel: string;
  /** The category's line, shown beside its name (the photo's own caption stays for the viewer). */
  readonly tagline: string;
  readonly title: string;
  readonly description: string;
  readonly cta: string;
}

const SETTLE = 'cubic-bezier(.22, 1, .36, 1)';
const WIDE_STAGE = 704;

export function crownProfile(stageWidth: number, cardWidth: number): OrbitProfile {
  const card = cardWidth || stageWidth * .3;
  if (stageWidth >= WIDE_STAGE) {
    // Neighbours start just beside the centre photo and curve back like a crown.
    const radius = Math.max(card * 1.05, stageWidth * .36);
    return { step: 40, radius, facing: .78, lift: card * .16, scatter: 0, reach: 2.2, backOpacity: .4, focusScale: 0 };
  }
  return { step: 34, radius: Math.max(card * 1.05, stageWidth * .62), facing: .7, lift: 0, scatter: 0, reach: 1.2, backOpacity: .55, focusScale: 0 };
}

class LuxeShowcase extends HTMLElement {
  private cleanup?: () => void;

  connectedCallback() {
    this.cleanup?.();
    const tabsWrap = this.querySelector<HTMLElement>('[data-tabs]');
    const tablist = this.querySelector<HTMLElement>('[data-tablist]');
    const indicator = this.querySelector<HTMLElement>('[data-indicator]');
    const panel = this.querySelector<HTMLElement>('[data-panel]');
    const stage = this.querySelector<HTMLElement>('[data-stage]');
    const nav = this.querySelector<HTMLElement>('[data-nav]');
    const zoom = this.querySelector<HTMLButtonElement>('[data-zoom]');
    const status = this.querySelector<HTMLElement>('[data-status]');
    const progress = this.querySelector<HTMLElement>('[data-progress]');
    const tabs = [...this.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const steps = [...this.querySelectorAll<HTMLButtonElement>('[data-step]')];
    const slot = (name: string) => this.querySelector<HTMLElement>(`[data-slot="${name}"]`);
    const slots = {
      category: slot('category'), tagline: slot('tagline'), numeral: slot('numeral'), title: slot('title'),
      description: slot('description'), cta: slot('cta'), counter: slot('counter'), position: slot('position'),
    };
    const items: ShowcaseItem[] = [...this.querySelectorAll<HTMLElement>('[data-orbit-card]')].map((card) => ({
      card,
      id: card.dataset.id ?? '',
      category: card.dataset.category ?? '',
      categoryLabel: card.dataset.categoryLabel ?? '',
      tagline: card.dataset.tagline ?? '',
      title: card.dataset.title ?? '',
      description: card.dataset.description ?? '',
      cta: card.dataset.cta ?? '',
    }));
    if (!tabsWrap || !tablist || !panel || !stage || !nav || !status || !items.length || !tabs.length) return;

    const state = createShowcaseState(items);
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const controller = new AbortController();
    const { signal } = controller;
    const textMotion = new Set<Animation>();
    const cardMotion = new Set<Animation>();

    const animate = (group: Set<Animation>, element: Element | null | undefined, keyframes: Keyframe[], options: KeyframeAnimationOptions) => {
      if (!element || motion.matches || typeof element.animate !== 'function') return;
      try {
        const animation = element.animate(keyframes, options);
        group.add(animation);
        animation.finished.then(() => group.delete(animation), () => group.delete(animation));
      } catch { /* Motion failures never change content. */ }
    };
    const cancel = (group: Set<Animation>) => { group.forEach((animation) => animation.cancel()); group.clear(); };
    const sequence = () => items.filter((item) => state.category === ALL_CATEGORY || item.category === state.category);

    const showCopy = (transition: 'none' | 'step' | 'category') => {
      const item = state.current;
      if (!item) return;
      const { index, count } = state;
      if (slots.category) slots.category.textContent = item.categoryLabel;
      if (slots.tagline) slots.tagline.textContent = item.tagline;
      if (slots.numeral) slots.numeral.textContent = String(index + 1).padStart(2, '0');
      if (slots.title) slots.title.textContent = item.title;
      if (slots.description) slots.description.textContent = item.description;
      if (slots.cta) slots.cta.textContent = item.cta;
      if (slots.counter) slots.counter.textContent = formatCounter(index, count);
      if (slots.position) slots.position.textContent = `Trabajo ${index + 1} de ${count}`;
      if (progress) progress.style.transform = `scaleX(${(index + 1) / count})`;
      for (const button of steps) button.disabled = count < 2;
      cancel(textMotion);
      if (transition === 'none') return;
      const rise = [{ opacity: 0, transform: 'translateY(.45em)' }, { opacity: 1, transform: 'none' }];
      const fade = [{ opacity: 0 }, { opacity: 1 }];
      animate(textMotion, slots.title, rise, { duration: 400, delay: 60, easing: SETTLE, fill: 'backwards' });
      animate(textMotion, slots.numeral, rise, { duration: 420, easing: SETTLE });
      animate(textMotion, slots.description, fade, { duration: 320, delay: 120, fill: 'backwards' });
      animate(textMotion, transition === 'category' ? slots.category?.parentElement : slots.tagline, fade, { duration: 280 });
      const label = tabs.find((tab) => tab.dataset.category === state.category)?.firstElementChild?.textContent ?? '';
      const intro = transition === 'category' ? `${label}: ${count} ${count === 1 ? 'trabajo' : 'trabajos'}. ` : '';
      status.textContent = `${intro}Trabajo ${index + 1} de ${count}. ${item.title}`;
    };

    const orbit = new OrbitStage({
      stage,
      profile: crownProfile,
      reducedMotion: () => motion.matches,
      maxThrow: 2,
      onInteract: () => cancel(cardMotion),
      onFront: (index: number, source: OrbitSource) => {
        const delta = index - state.index;
        if (delta) state.step(delta);
        showCopy(source === 'select' ? 'none' : 'step');
      },
      onActivate: (index: number) => openViewer(index, stage),
    });

    const openViewer = (index: number, opener: HTMLElement) => {
      const cards = sequence().map((item) => item.card);
      const photos = cards.map((card) => readLightboxItem(card)).filter((item): item is LightboxItem => Boolean(item));
      if (photos.length === cards.length) openLightbox(photos, index, opener);
    };

    /** Show only the selected category's works; the crown never mixes categories. */
    const mount = (transition: 'none' | 'category') => {
      cancel(cardMotion);
      const visible = new Set(sequence().map((item) => item.card));
      for (const item of items) item.card.toggleAttribute('data-off', !visible.has(item.card));
      orbit.setCards([...visible], 0);
      showCopy(transition);
      if (transition === 'none') return;
      for (const card of visible) {
        if (card.style.visibility === 'hidden') continue;
        const distance = Math.abs(orbit.items.indexOf(card));
        const wrapped = Math.min(distance, orbit.count - distance);
        animate(cardMotion, card, [{ opacity: 0, transform: `${card.style.transform} translate3d(0, 1.25rem, -140px)` }], { duration: 560, delay: wrapped * 70, easing: SETTLE, fill: 'backwards' });
      }
    };

    /** Underline the label and count only, not the tab's focus padding. */
    const placeIndicator = (tab: HTMLButtonElement) => {
      const first = tab.firstElementChild as HTMLElement | null;
      const last = tab.lastElementChild as HTMLElement | null;
      const left = first ? first.offsetLeft : tab.offsetLeft;
      const width = first && last ? last.offsetLeft + last.offsetWidth - left : tab.offsetWidth;
      if (indicator) indicator.style.transform = `translateX(${left}px) scaleX(${width})`;
    };
    const updateOverflow = () => {
      tabsWrap.toggleAttribute('data-more', tablist.scrollLeft + tablist.clientWidth < tablist.scrollWidth - 4);
    };
    const revealTab = (tab: HTMLButtonElement) => {
      const behavior: ScrollBehavior = motion.matches ? 'auto' : 'smooth';
      const start = tab.offsetLeft - 24;
      const end = tab.offsetLeft + tab.offsetWidth + 40;
      if (start < tablist.scrollLeft) tablist.scrollTo({ left: start, behavior });
      else if (end > tablist.scrollLeft + tablist.clientWidth) tablist.scrollTo({ left: end - tablist.clientWidth, behavior });
    };
    const selectedTab = () => tabs.find((tab) => tab.getAttribute('aria-selected') === 'true') ?? tabs[0]!;
    const selectTab = (tab: HTMLButtonElement, focus: boolean) => {
      if (focus) tab.focus();
      if (tab === selectedTab()) return;
      if (!state.select(tab.dataset.category ?? ALL_CATEGORY)) return;
      for (const candidate of tabs) {
        const selected = candidate === tab;
        candidate.setAttribute('aria-selected', String(selected));
        candidate.tabIndex = selected ? 0 : -1;
      }
      panel.setAttribute('aria-labelledby', tab.id);
      placeIndicator(tab);
      revealTab(tab);
      mount('category');
    };

    for (const tab of tabs) tab.addEventListener('click', () => selectTab(tab, false), { signal });
    tablist.addEventListener('keydown', (event) => {
      const index = tabs.indexOf(event.target as HTMLButtonElement);
      if (index < 0) return;
      const target = ({ ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 } as Record<string, number>)[event.key];
      if (target === undefined) return;
      event.preventDefault();
      selectTab(tabs[(target + tabs.length) % tabs.length]!, true);
    }, { signal });
    for (const button of steps) button.addEventListener('click', () => { cancel(cardMotion); orbit.step(Number(button.dataset.step)); }, { signal });
    zoom?.addEventListener('click', () => openViewer(orbit.index, zoom), { signal });
    tablist.addEventListener('scroll', updateOverflow, { passive: true, signal });

    // Services links ("Ver trabajos") open the matching category; the anchor still scrolls.
    document.addEventListener('click', (event) => {
      const link = (event.target as Element | null)?.closest<HTMLElement>('[data-showcase-link]');
      const tab = link && tabs.find((candidate) => candidate.dataset.category === link.dataset.showcaseLink);
      if (tab) selectTab(tab, false);
    }, { signal });
    motion.addEventListener('change', (event) => { if (event.matches) { cancel(textMotion); cancel(cardMotion); orbit.settle(); } }, { signal });

    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { placeIndicator(selectedTab()); updateOverflow(); }) : undefined;
    resize?.observe(tablist);

    // Editorial entrance, once: only when the section is still below the fold (never hides
    // what is already on screen) and motion is welcome. The section owns the CSS.
    const section = this.closest<HTMLElement>('[data-showcase-section]');
    let revealObserver: IntersectionObserver | undefined;
    let revealTimer = 0;
    if (section && !motion.matches && 'IntersectionObserver' in window && section.getBoundingClientRect().top > window.innerHeight) {
      section.dataset.reveal = 'pending';
      revealObserver = new IntersectionObserver((records) => {
        if (!records.some((record) => record.isIntersecting)) return;
        revealObserver?.disconnect();
        section.dataset.reveal = 'play';
        revealTimer = window.setTimeout(() => { section.dataset.reveal = 'done'; }, 2_200);
      }, { rootMargin: '0px 0px -12% 0px' });
      revealObserver.observe(section);
      motion.addEventListener('change', (event) => { if (event.matches) { revealObserver?.disconnect(); section.dataset.reveal = 'done'; } }, { signal });
    }

    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', selectedTab().id);
    tabsWrap.hidden = false;
    nav.hidden = false;
    if (zoom) zoom.hidden = false;
    stage.tabIndex = 0;
    stage.setAttribute('aria-roledescription', 'carrusel');
    this.dataset.ready = '';
    mount('none');
    placeIndicator(selectedTab());
    updateOverflow();

    this.cleanup = () => {
      controller.abort();
      resize?.disconnect();
      revealObserver?.disconnect();
      window.clearTimeout(revealTimer);
      if (section) delete section.dataset.reveal;
      cancel(textMotion);
      cancel(cardMotion);
      orbit.dispose();
      // Back to the server-rendered state: first work, no inert controls.
      items.forEach((item) => item.card.removeAttribute('data-off'));
      state.select(ALL_CATEGORY);
      showCopy('none');
      tabs.forEach((tab, index) => { tab.setAttribute('aria-selected', String(index === 0)); tab.tabIndex = index === 0 ? 0 : -1; });
      panel.removeAttribute('role');
      panel.removeAttribute('aria-labelledby');
      stage.removeAttribute('tabindex');
      stage.removeAttribute('aria-roledescription');
      tabsWrap.hidden = true;
      nav.hidden = true;
      if (zoom) zoom.hidden = true;
      status.textContent = '';
      delete this.dataset.ready;
    };
  }

  disconnectedCallback() { this.cleanup?.(); }
}

if (!customElements.get('luxe-showcase')) customElements.define('luxe-showcase', LuxeShowcase);
