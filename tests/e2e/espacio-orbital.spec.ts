import { test, expect, type Page, type BrowserContext } from '@playwright/test';

/** Fase «Orbital experience»: the crown of «El espacio» (cards on a ring around the
 * portal), its circular navigation by click, drag, touch, arrows and keys, the portal's
 * double-buffered photos, the viewer, reduced motion and the responsive compositions. */
const AREAS = ['Estaciones y espejos', 'Otra perspectiva', 'Un lugar para tu momento', 'Área de manicura', 'Antes de empezar'];
const tabs = (page: Page) => page.locator('#espacio [role="tab"]');
const next = (page: Page) => page.getByRole('button', { name: 'Ambiente siguiente' });
const previous = (page: Page) => page.getByRole('button', { name: 'Ambiente anterior' });
const pad = (index: number) => `0${index + 1} / 05`;

async function open(page: Page, reducedMotion: 'reduce' | 'no-preference' = 'no-preference') {
  await page.emulateMedia({ reducedMotion });
  await page.addInitScript(() => sessionStorage.setItem('luxe:intro:seen:v1', '1'));
  await page.goto('/');
  await expect(page.locator('luxe-space-tour[data-ready]')).toHaveCount(1);
  await page.locator('#espacio .tour').scrollIntoViewIfNeeded();
}

/** Every visible view, as phase43 measures it, plus the crown's pose of each card. */
const snapshot = (page: Page) => page.evaluate(async () => {
  await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  const views = [...document.querySelectorAll<HTMLElement>('[data-tour-view]')]
    .filter((view) => !view.hidden && getComputedStyle(view).visibility !== 'hidden')
    .map((view) => {
      const image = view.querySelector('img')!;
      return { index: Number(view.dataset.tourView), opacity: Number(getComputedStyle(view).opacity), loaded: image.complete && image.naturalWidth > 0, effects: view.getAnimations().length };
    });
  const cards = [...document.querySelectorAll<HTMLElement>('[data-tour-thumb]')].map((card) => ({
    ox: Number(card.style.getPropertyValue('--ox')), oy: Number(card.style.getPropertyValue('--oy')), z: Number(card.style.zIndex), front: card.hasAttribute('data-front'), selected: card.getAttribute('aria-selected') === 'true',
  }));
  return { views, cards };
});

/** Settled on `index`: one opaque, painted photo; that card in front of the ring; copy in sync. */
async function expectAt(page: Page, index: number) {
  await expect.poll(async () => {
    const { views, cards } = await snapshot(page);
    const card = cards[index]!;
    const ringOk = Math.abs(card.ox) < .01 && card.oy > .99 && card.front && card.selected && cards.every((other, at) => at === index || other.z < card.z);
    return JSON.stringify({ views, ringOk });
  }, { timeout: 20_000 }).toBe(JSON.stringify({ views: [{ index, opacity: 1, loaded: true, effects: 0 }], ringOk: true }));
  await expect(page.locator('[data-tour-counter]')).toHaveText(pad(index));
  await expect(page.locator('[data-tour-slot="title"]')).toHaveText(AREAS[index]!);
  await expect(page.locator(`[data-tour-dot="${index}"]`)).toHaveAttribute('data-active', '');
}

test('corona: cinco tarjetas reales; elegir cualquiera la lleva al frente con su foto y su texto', async ({ page }) => {
  test.setTimeout(90_000);
  await open(page);
  await expect(tabs(page)).toHaveCount(5);
  for (const [index, card] of (await tabs(page).all()).entries()) {
    await expect(card.locator('img')).toHaveCount(1);
    await expect(card).toContainText(String(index + 1).padStart(2, '0'));
    await expect(card).toContainText(AREAS[index]!);
  }
  await expectAt(page, 0);
  for (const index of [3, 1, 4, 2, 0]) {
    await tabs(page).nth(index).click();
    await expectAt(page, index);
    await expect(page.locator(`[data-tour-view="${index}"] img`)).toHaveCSS('object-fit', 'contain');
  }
});

test('corona: circular infinita en ambos sentidos, sin salto visual de la última a la primera', async ({ page }) => {
  test.setTimeout(90_000);
  await open(page);
  // Backwards from the first: the last one.
  await previous(page).click();
  await expectAt(page, 4);
  await previous(page).click();
  await expectAt(page, 3);
  // Watch card 0 while going from the last to the first: it travels the short way (from the
  // right neighbour to the front), never across the ring.
  await next(page).click();
  await expectAt(page, 4);
  const path = await page.evaluate(async () => {
    const card = document.querySelector<HTMLElement>('[data-tour-thumb="0"]')!;
    const samples: number[] = [];
    document.querySelector<HTMLButtonElement>('[data-tour-step="1"]')!.click();
    const start = performance.now();
    while (performance.now() - start < 1200) {
      await new Promise((done) => requestAnimationFrame(done));
      samples.push(Number(card.style.getPropertyValue('--ox')));
    }
    return samples;
  });
  expect(Math.min(...path)).toBeGreaterThan(-.05);
  expect(path.every((value, at) => at === 0 || value <= path[at - 1]! + 1e-3)).toBe(true);
  await expectAt(page, 0);
  // Two full turns forward land where they started.
  for (let step = 0; step < 10; step++) await next(page).click();
  await expectAt(page, 0);
});

test('corona: navegación muy rápida mezclando flechas y tarjetas nunca deja el portal vacío ni otra foto', async ({ page }) => {
  test.setTimeout(90_000);
  await open(page);
  // Precondition: the first photo is on screen. The guarantee under test is that a shown photo
  // stays until the next one has loaded; before the first load the portal shows its placeholder.
  await expectAt(page, 0);
  const sequence = [1, 'n', 'n', 4, 'p', 0, 'n', 'p', 'p', 2, 'n', 'n', 'n', 3, 'p'] as const;
  for (const move of sequence) {
    if (move === 'n') await next(page).click({ delay: 0 });
    else if (move === 'p') await previous(page).click({ delay: 0 });
    // A direct click on the card wherever it is in its travel (no waiting for it to stop).
    else await tabs(page).nth(move).dispatchEvent('click');
    const { views } = await snapshot(page);
    expect(views.some((view) => view.loaded && view.opacity > .05)).toBe(true);
  }
  // 1 → 2 → 3 → 4 → 3 → 0 → 1 → 0 → 4 → 2 → 3 → 4 → 0 → 3 → 2
  await expectAt(page, 2);
});

test('corona: arrastre con mouse, con inercia moderada y acomodo en una tarjeta', async ({ page }) => {
  test.setTimeout(60_000);
  await open(page);
  await expectAt(page, 0);
  const box = (await page.locator('.tour-crown').boundingBox())!;
  const y = box.y + box.height * .35;
  const drag = async (from: number, to: number) => {
    await page.mouse.move(from, y);
    await page.mouse.down();
    await page.mouse.move((from + to) / 2, y + 2, { steps: 6 });
    await page.mouse.move(to, y + 3, { steps: 6 });
    // Rest before releasing: no throw, it settles where the hand left it.
    await page.waitForTimeout(200);
    await page.mouse.up();
  };
  const unit = await page.evaluate(() => (document.querySelector<HTMLElement>('[data-tour-ring]')!.offsetWidth / 2) * Math.PI * 2 / 5 * .85);
  await drag(box.x + box.width * .75, box.x + box.width * .75 - unit);
  await expectAt(page, 1);
  await drag(box.x + box.width * .25, box.x + box.width * .25 + unit * 2);
  await expectAt(page, 4);
  // While dragging, the ring follows the pointer and the gesture is marked.
  await page.mouse.move(box.x + box.width * .6, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .6 - 80, y, { steps: 8 });
  await expect(page.locator('.tour-crown')).toHaveAttribute('data-dragging', '');
  await page.mouse.up();
  await expect(page.locator('.tour-crown')).not.toHaveAttribute('data-dragging', '');
  // A quick throw travels further, but never spins away (at most two views).
  await expect.poll(async () => (await snapshot(page)).views.length).toBe(1);
  const before = Number((await page.locator('[data-tour-counter]').textContent())!.slice(0, 2)) - 1;
  // A short flick (a third of a view) still moves on, thanks to inertia, at most two views.
  await page.mouse.move(box.x + box.width * .6, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .6 - unit / 3, y, { steps: 3 });
  await page.mouse.up();
  await expect.poll(async () => (await snapshot(page)).views.length, { timeout: 20_000 }).toBe(1);
  const after = Number((await page.locator('[data-tour-counter]').textContent())!.slice(0, 2)) - 1;
  const travelled = ((after - before) % 5 + 5) % 5;
  expect([1, 2]).toContain(travelled);
});

async function touchContext(page: Page, width = 390, height = 844): Promise<{ context: BrowserContext; mobile: Page }> {
  const context = await page.context().browser()!.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true, reducedMotion: 'no-preference', locale: 'es-CR' });
  const mobile = await context.newPage();
  await mobile.addInitScript(() => sessionStorage.setItem('luxe:intro:seen:v1', '1'));
  await mobile.goto('http://localhost:4321/');
  await expect(mobile.locator('luxe-space-tour[data-ready]')).toHaveCount(1);
  return { context, mobile };
}

test('corona táctil: deslizar en horizontal gira; en vertical la página se desplaza normalmente', async ({ page }) => {
  test.setTimeout(90_000);
  const { context, mobile } = await touchContext(page);
  try {
    const crown = mobile.locator('.tour-crown');
    await expect(crown).toHaveCSS('touch-action', 'pan-y');
    await expect(mobile.locator('[data-tour-stage]')).toHaveCSS('touch-action', 'pan-y');
    await mobile.locator('#espacio .tour').evaluate((element) => element.scrollIntoView({ block: 'center' }));
    // Let the entrance finish: a gesture during it starts from where the ring is on screen.
    await expect(mobile.locator('luxe-space-tour')).not.toHaveAttribute('data-reveal', /.+/, { timeout: 6_000 });
    await expect.poll(async () => (await snapshot(mobile)).cards[0]!.oy).toBe(1);
    const cdp = await context.newCDPSession(mobile);
    const swipe = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
      for (let step = 1; step <= 12; step++) {
        const x = from.x + ((to.x - from.x) * step) / 12;
        const y = from.y + ((to.y - from.y) * step) / 12;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
      }
      await mobile.waitForTimeout(150);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    const box = (await crown.boundingBox())!;
    const center = { x: box.x + box.width / 2, y: box.y + box.height * .4 };
    await swipe({ x: center.x + 70, y: center.y }, { x: center.x - 70, y: center.y + 4 });
    await expectAt(mobile, 1);
    // Swipe on the portal itself (photo) also walks the ring.
    const stage = (await mobile.locator('[data-tour-stage]').boundingBox())!;
    await swipe({ x: stage.x + stage.width * .7, y: stage.y + stage.height / 2 }, { x: stage.x + stage.width * .2, y: stage.y + stage.height / 2 + 6 });
    await expectAt(mobile, 2);
    // A vertical gesture over the crown scrolls the page and leaves the selection alone.
    const scrolled = await mobile.evaluate(() => scrollY);
    const now = (await crown.boundingBox())!;
    await swipe({ x: now.x + now.width / 2, y: now.y + now.height * .6 }, { x: now.x + now.width / 2 + 3, y: now.y + now.height * .6 - 220 });
    await expect.poll(() => mobile.evaluate(() => scrollY)).toBeGreaterThan(scrolled + 60);
    await expectAt(mobile, 2);
    // Taps select directly, also the cards at the far side of the ring.
    for (const index of [4, 1, 3]) {
      await tabs(mobile).nth(index).tap();
      await expectAt(mobile, index);
    }
  } finally { await context.close(); }
});

test('corona: teclado con foco visible, circular, Inicio/Fin y Enter', async ({ page }) => {
  await open(page, 'reduce');
  await page.locator('.experience-cta').focus();
  await page.keyboard.press('Tab');
  const first = tabs(page).nth(0);
  await expect(first).toBeFocused();
  await expect(first).toHaveAttribute('tabindex', '0');
  expect(await first.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('solid');
  await page.keyboard.press('ArrowLeft');
  await expect(tabs(page).nth(4)).toBeFocused();
  await expectAt(page, 4);
  await page.keyboard.press('ArrowRight');
  await expect(tabs(page).nth(0)).toBeFocused();
  await expectAt(page, 0);
  await page.keyboard.press('End');
  await expectAt(page, 4);
  await page.keyboard.press('Home');
  await expectAt(page, 0);
  await page.keyboard.press('ArrowDown');
  await expectAt(page, 1);
  // Roving tabindex: one tab stop for the crown, then the portal's controls.
  await expect(page.locator('#espacio [role="tab"][tabindex="0"]')).toHaveCount(1);
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-tour-zoom]')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(previous(page)).toBeFocused();
  await page.keyboard.press('Enter');
  await expectAt(page, 0);
  await expect(page.locator('[data-tour-status]')).toHaveText('1 de 5. Barbería: Estaciones y espejos');
});

test('visor: «Ampliar» abre la foto elegida, navega circularmente, cierra con Escape y devuelve el foco', async ({ page }) => {
  await open(page, 'reduce');
  await tabs(page).nth(3).click();
  await expectAt(page, 3);
  const dialog = page.locator('dialog.lightbox');
  await page.locator('[data-tour-zoom]').click();
  await expect(dialog).toHaveAttribute('open', '');
  await expect(dialog.getByRole('button', { name: 'Cerrar visor' })).toBeFocused();
  await expect(dialog.locator('[data-lightbox-counter]')).toHaveText('04 / 05');
  await expect(dialog.locator('[data-lightbox-caption]')).toHaveText('Manicura · Área de manicura');
  await expect.poll(() => dialog.locator('img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(dialog.locator('[data-lightbox-counter]')).toHaveText('01 / 05');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toHaveAttribute('open', '');
  await expect(page.locator('[data-tour-zoom]')).toBeFocused();
  // A click on the portal's photo opens the viewer as well.
  await page.locator('[data-tour-view="3"] img').click();
  await expect(dialog).toHaveAttribute('open', '');
  await page.keyboard.press('Escape');
});

test('movimiento reducido: sin entrada, sin giro animado, sin brillo ambiental ni efectos residuales', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => sessionStorage.setItem('luxe:intro:seen:v1', '1'));
  await page.goto('/');
  await expect(page.locator('luxe-space-tour[data-ready]')).toHaveCount(1);
  await page.locator('#espacio .tour').scrollIntoViewIfNeeded();
  await expect(page.locator('luxe-space-tour')).not.toHaveAttribute('data-reveal', /.+/);
  expect(await page.locator('.tour-ring-glint').evaluate((element) => getComputedStyle(element).animationName)).toBe('none');
  await next(page).click();
  // The ring is already in place on the very next frame.
  const pose = await page.evaluate(async () => {
    await new Promise((done) => requestAnimationFrame(done));
    const card = document.querySelector<HTMLElement>('[data-tour-thumb="1"]')!;
    return [Number(card.style.getPropertyValue('--ox')), Number(card.style.getPropertyValue('--oy'))];
  });
  expect(pose).toEqual([0, 1]);
  await expectAt(page, 1);
  expect(await page.locator('luxe-space-tour').evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0);
});

test('entrada: la revelación ocurre una sola vez y nunca oculta el contenido', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => sessionStorage.setItem('luxe:intro:seen:v1', '1'));
  await page.goto('/');
  const tour = page.locator('luxe-space-tour');
  await expect(tour).toHaveAttribute('data-reveal', 'pending');
  await page.locator('#espacio .tour').scrollIntoViewIfNeeded();
  // Controls work during the entrance.
  await next(page).click();
  await expect(tour).not.toHaveAttribute('data-reveal', /.+/, { timeout: 6_000 });
  await expectAt(page, 1);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.locator('#espacio .tour').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await expect(tour).not.toHaveAttribute('data-reveal', /.+/);
  expect(Number(await page.locator('.tour-portal').evaluate((element) => getComputedStyle(element).opacity))).toBe(1);
});

for (const [width, height] of [[360, 740], [390, 844], [768, 1024], [1440, 900], [1920, 1080]] as const) {
  test(`composición a ${width}px: corona, portal y controles visibles, sin desbordes ni errores`, async ({ page }) => {
    test.setTimeout(60_000);
    const problems: string[] = [];
    page.on('pageerror', (error) => problems.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') problems.push(message.text()); });
    page.on('response', (response) => { if (response.status() >= 400) problems.push(`${response.status()} ${response.url()}`); });
    await page.setViewportSize({ width, height });
    await open(page);
    await expectAt(page, 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const inside = async (selector: string) => {
      const box = (await page.locator(selector).first().boundingBox())!;
      expect(box.x, selector).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, selector).toBeLessThanOrEqual(width);
      return box;
    };
    for (const selector of ['[data-tour-step="-1"]', '[data-tour-step="1"]', '[data-tour-zoom]', '.tour-overlay', '.tour-portal', '[data-tour-thumb="0"]']) await inside(selector);
    // Every card can be reached: its centre is on screen and is the card itself.
    await page.locator('.tour-crown').evaluate((element) => element.scrollIntoView({ block: 'center' }));
    for (let index = 0; index < 5; index++) {
      const hit = await page.locator(`[data-tour-thumb="${index}"]`).evaluate((card) => {
        const box = card.getBoundingClientRect();
        const x = box.left + box.width / 2;
        const y = box.top + box.height / 2;
        return { x, ok: card.contains(document.elementFromPoint(x, y)), height: box.height };
      });
      expect(hit.ok, `card ${index}`).toBe(true);
      expect(hit.x).toBeGreaterThan(0);
      expect(hit.x).toBeLessThan(width);
      expect(hit.height).toBeGreaterThanOrEqual(24);
    }
    // The front card never covers the photo, and the portal keeps a sensible height.
    const front = (await page.locator('[data-tour-thumb="0"]').boundingBox())!;
    const photo = (await page.locator('[data-tour-view="0"] picture').boundingBox())!;
    expect(front.y + front.height).toBeLessThanOrEqual(photo.y + 1);
    const portal = (await page.locator('.tour-portal').boundingBox())!;
    expect(portal.height).toBeLessThanOrEqual(height * (width < 768 ? .62 : .8));
    // The whole photo is shown, whatever its proportions (contain, no stretch).
    for (const index of [3, 0]) {
      await tabs(page).nth(index).click();
      await expectAt(page, index);
      const ratio = await page.locator(`[data-tour-view="${index}"] img`).evaluate((image: HTMLImageElement) => ({ fit: getComputedStyle(image).objectFit, natural: image.naturalWidth / image.naturalHeight }));
      expect(ratio.fit).toBe('contain');
      expect(ratio.natural).toBeGreaterThan(0);
    }
    expect(problems).toEqual([]);
  });
}

test('reflow al 200 % (720 × 450): portal dentro de la pantalla y recorrido operable', async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 450 });
  await open(page, 'reduce');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const portal = (await page.locator('.tour-portal').boundingBox())!;
  expect(portal.height).toBeLessThanOrEqual(450 - 64);
  await next(page).click();
  await expectAt(page, 1);
  await tabs(page).nth(4).click();
  await expectAt(page, 4);
  await page.locator('[data-tour-zoom]').click();
  await expect(page.locator('dialog.lightbox')).toHaveAttribute('open', '');
  await page.keyboard.press('Escape');
});

test('sin JavaScript: la corona queda compuesta en reposo, sin controles inertes', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });
  try {
    const page = await context.newPage();
    await page.goto('http://localhost:4321/');
    await expect(page.locator('[data-tour-thumb]')).toHaveCount(5);
    await expect(page.locator('[data-tour-thumb="0"]')).toHaveAttribute('data-front', '');
    // The server wrote the same ring the controller draws.
    const style = await page.locator('[data-tour-thumb="1"]').getAttribute('style');
    expect(style).toMatch(/--ox:0\.95\d*;--oy:0\.30\d*/);
    await expect(page.locator('[data-tour-view]:visible')).toHaveCount(1);
    await expect(page.locator('[data-tour-nav]')).toBeHidden();
    await expect(page.locator('[data-tour-zoom]')).toBeHidden();
  } finally { await context.close(); }
});
