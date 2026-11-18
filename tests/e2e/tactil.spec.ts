import { test, expect, type Browser, type BrowserContext, type CDPSession, type Page } from '@playwright/test';

/** Touch, through Chromium's real input pipeline (CDP Input.dispatchTouchEvent honours
 * touch-action, implicit pointer capture, pointercancel and tap → click), on phone viewports.
 * Mundo LUXE: one finger turns the world freely in both axes and the page holds still.
 * «Nuestro trabajo, de cerca»: a sideways swipe pages one photo; vertical swipes scroll.
 * Emulation, not a real iPhone or Android device: see the delivery notes. */
interface Point { x: number; y: number }
interface Touch { context: BrowserContext; page: Page; cdp: CDPSession }

async function phone(browser: Browser, width: number, height: number, reducedMotion: 'reduce' | 'no-preference'): Promise<Touch> {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true, locale: 'es-CR', reducedMotion });
  const page = await context.newPage();
  await page.addInitScript(() => sessionStorage.setItem('luxe:intro:seen:v1', '1'));
  await page.goto('http://localhost:4321/');
  await expect(page.locator('luxe-specialties[data-ready]')).toHaveCount(1);
  await expect(page.locator('luxe-showcase[data-ready]')).toHaveCount(1);
  return { context, page, cdp: await context.newCDPSession(page) };
}
const line = (from: Point, to: Point, steps = 16): Point[] => Array.from({ length: steps + 1 }, (_, step) => ({ x: from.x + ((to.x - from.x) * step) / steps, y: from.y + ((to.y - from.y) * step) / steps }));
/** One finger: down on the first point, through the rest, rests `hold` ms, lifts. */
async function gesture({ page, cdp }: Touch, points: readonly Point[], hold = 30) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [points[0]!] });
  for (const point of points.slice(1)) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point] });
  if (hold) await page.waitForTimeout(hold);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
const scrollTop = (page: Page) => page.evaluate(() => Math.round(scrollY));
const lightboxOpen = (page: Page) => page.locator('dialog.lightbox').evaluate((dialog) => (dialog as HTMLDialogElement).open);

// ——— Mundo LUXE ———
const globe = (page: Page) => page.locator('[data-globe-stage]');
/** Rotor rotation as a DOMMatrix list (read in the page). */
const rotor = (page: Page) => page.locator('[data-globe-rotor]').evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).toFloat64Array().join(','));
/** The turn between two orientations: its angle and its (screen-space) axis. */
const turnBetween = (page: Page, before: string, after: string) => page.evaluate(([a, b]) => {
  const from = new DOMMatrix(a!.split(',').map(Number));
  const to = new DOMMatrix(b!.split(',').map(Number));
  const d = to.multiply(from.inverse());
  const axis = [d.m23 - d.m32, d.m31 - d.m13, d.m12 - d.m21];
  const length = Math.hypot(...axis) || 1;
  const cos = Math.min(1, Math.max(-1, (d.m11 + d.m22 + d.m33 - 1) / 2));
  return { angle: (Math.acos(cos) * 180) / Math.PI, x: Math.abs(axis[0]!) / length, y: Math.abs(axis[1]!) / length };
}, [before, after] as const);
async function showGlobe(touch: Touch) {
  await globe(touch.page).evaluate((element) => element.scrollIntoView({ block: 'center' }));
  // The welcome (once, as the world arrives) must be over: gestures then start from rest.
  await expect(touch.page.locator('luxe-specialties')).not.toHaveAttribute('data-intro', /pending|play/, { timeout: 8_000 });
  const box = (await globe(touch.page).boundingBox())!;
  return { box, center: { x: box.x + box.width / 2, y: box.y + box.height / 2 } };
}

test('mundo táctil: un dedo lo gira en ambos ejes, en diagonal y 360° en vertical, sin mover la página', async ({ browser }) => {
  test.setTimeout(90_000);
  // Reduced motion: no throw and no settling after release, so every turn is the finger's alone.
  const touch = await phone(browser, 390, 844, 'reduce');
  const { page } = touch;
  try {
    await expect(globe(page)).toHaveCSS('touch-action', 'pinch-zoom');
    const { box, center } = await showGlobe(touch);
    await page.evaluate(() => {
      const w = window as Window & { scrolls?: number };
      w.scrolls = 0;
      addEventListener('scroll', () => { w.scrolls! += 1; }, { passive: true });
    });
    const top = await scrollTop(page);
    const reach = box.height * .3;
    const cases: [string, Point, Point, 'x' | 'y' | 'both'][] = [
      ['arriba', { x: center.x, y: center.y + reach }, { x: center.x + 2, y: center.y - reach }, 'x'],
      ['abajo', { x: center.x, y: center.y - reach }, { x: center.x - 2, y: center.y + reach }, 'x'],
      ['izquierda', { x: center.x + reach, y: center.y }, { x: center.x - reach, y: center.y + 2 }, 'y'],
      ['derecha', { x: center.x - reach, y: center.y }, { x: center.x + reach, y: center.y - 2 }, 'y'],
      ['diagonal', { x: center.x - reach * .7, y: center.y + reach * .7 }, { x: center.x + reach * .7, y: center.y - reach * .7 }, 'both'],
    ];
    for (const [name, from, to, axis] of cases) {
      const before = await rotor(page);
      await gesture(touch, line(from, to), 120);
      const turn = await turnBetween(page, before, await rotor(page));
      // One stage width ≈ 200°: a 0.6-width swipe turns the world about 100°.
      expect(turn.angle, name).toBeGreaterThan(70);
      if (axis === 'x') expect(turn.x, name).toBeGreaterThan(.97);
      if (axis === 'y') expect(turn.y, name).toBeGreaterThan(.97);
      if (axis === 'both') { expect(turn.x, name).toBeGreaterThan(.6); expect(turn.y, name).toBeGreaterThan(.6); }
      expect(await scrollTop(page), name).toBe(top);
    }

    // Consecutive vertical strokes keep rolling the same way, through the poles and past a full
    // turn, with no clamp, flip or jump between gestures.
    await page.evaluate(() => {
      const w = window as Window & { __luxeRecordedTransforms?: string[] };
      const element = document.querySelector<HTMLElement>('[data-globe-rotor]')!;
      w.__luxeRecordedTransforms = [];
      new MutationObserver(() => w.__luxeRecordedTransforms!.push(element.style.transform)).observe(element, { attributes: true, attributeFilter: ['style'] });
    });
    let total = 0;
    const start = await rotor(page);
    const stroke = { from: { x: center.x, y: center.y + box.height * .42 }, to: { x: center.x, y: center.y - box.height * .42 } };
    for (let lap = 0; lap < 3; lap++) {
      const before = await rotor(page);
      await gesture(touch, line(stroke.from, stroke.to, 24), 150);
      const turn = await turnBetween(page, before, await rotor(page));
      expect(turn.x).toBeGreaterThan(.97);
      total += turn.angle;
    }
    expect(total).toBeGreaterThan(360);
    const continuity = await page.evaluate(([initial, width, steps]) => {
      const painted = ((window as Window & { __luxeRecordedTransforms?: string[] }).__luxeRecordedTransforms ?? []).map((transform) => new DOMMatrix(transform));
      // The point of the world that faced the visitor goes all the way round (up over the top,
      // behind, and back from below); no painted step is larger than one finger move asks for
      // (a reset or a jump would be).
      const facing = new DOMMatrix(initial.split(',').map(Number)).inverse().transformPoint({ x: 0, y: 0, z: 1 });
      const fronts = painted.map((m) => m.transformPoint(facing).y);
      let largest = 0;
      for (let i = 1; i < painted.length; i++) {
        const d = painted[i]!.multiply(painted[i - 1]!.inverse());
        largest = Math.max(largest, (Math.acos(Math.min(1, (d.m11 + d.m22 + d.m33 - 1) / 2)) * 180) / Math.PI);
      }
      return { low: Math.min(...fronts), high: Math.max(...fronts), largest, perMove: (200 / width) * steps };
    }, [start, box.width, (box.height * .84) / 24] as const);
    expect(continuity.low).toBeLessThan(-.95);
    expect(continuity.high).toBeGreaterThan(.95);
    expect(continuity.largest).toBeLessThan(continuity.perMove * 1.6);

    // Not a pixel of page scroll while the finger was on the world.
    expect(await scrollTop(page)).toBe(top);
    expect(await page.evaluate(() => (window as Window & { scrolls?: number }).scrolls)).toBe(0);

    // Outside the world the page scrolls as always (the copy under it).
    const copy = (await page.locator('.globe-copy').boundingBox())!;
    const below = { x: copy.x + copy.width / 2, y: Math.min(800, copy.y + 40) };
    await gesture(touch, line(below, { x: below.x, y: below.y - 260 }));
    await expect.poll(() => scrollTop(page)).toBeGreaterThan(top + 100);

    // Selector, arrows and the viewer still respond.
    await globe(page).evaluate((element) => element.scrollIntoView({ block: 'center' }));
    await page.locator('[data-specialty-row="unas-pedicura"] button').tap();
    await expect(page.locator('[data-specialty-row="unas-pedicura"]')).toHaveAttribute('data-active', '');
    await expect(page.locator('[data-globe-panel][data-featured]')).toHaveAttribute('data-key', 'unas-flores');
    const before = await rotor(page);
    await page.getByRole('button', { name: 'Inclinar hacia arriba' }).tap();
    expect((await turnBetween(page, before, await rotor(page))).angle).toBeGreaterThan(20);
    await page.locator('[data-globe-zoom]').tap();
    await expect.poll(() => lightboxOpen(page)).toBe(true);
  } finally { await touch.context.close(); }
});

test('mundo táctil: atrapar el globo en movimiento lo detiene bajo el dedo, sin abrir ni elegir piezas', async ({ browser }) => {
  test.setTimeout(60_000);
  const touch = await phone(browser, 390, 844, 'no-preference');
  const { page } = touch;
  try {
    const { center } = await showGlobe(touch);
    const top = await scrollTop(page);
    // A quick throw: the world coasts on.
    await gesture(touch, line({ x: center.x + 100, y: center.y + 20 }, { x: center.x - 100, y: center.y - 20 }, 4), 0);
    await page.waitForTimeout(80);
    const coasting = await rotor(page);
    await page.waitForTimeout(60);
    expect((await turnBetween(page, coasting, await rotor(page))).angle).toBeGreaterThan(1);
    // A finger lands and stays: the world stops there and does not move while it is held.
    await touch.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [center] });
    await page.waitForTimeout(40);
    const held = await rotor(page);
    await page.waitForTimeout(300);
    expect((await turnBetween(page, held, await rotor(page))).angle).toBeLessThan(.05);
    await touch.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(400);
    // That touch was a catch, not a tap: the viewer stays closed.
    expect(await lightboxOpen(page)).toBe(false);
    // A short nudge (past the drag threshold, inside the tap slop) never leaks a click either.
    await page.waitForTimeout(1_500);
    await gesture(touch, line(center, { x: center.x + 9, y: center.y }, 3), 0);
    await page.waitForTimeout(500);
    expect(await lightboxOpen(page)).toBe(false);
    expect(await scrollTop(page)).toBe(top);
    // While a plain tap on the piece in front still opens it.
    const front = page.locator('[data-globe-panel][data-featured]');
    await page.locator('[data-specialty-row="peluqueria"] button').tap();
    await page.waitForTimeout(1_400);
    const box = (await front.boundingBox())!;
    await gesture(touch, [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }], 40);
    await expect.poll(() => lightboxOpen(page)).toBe(true);
  } finally { await touch.context.close(); }
});

// ——— Nuestro trabajo, de cerca ———
const crown = (page: Page) => page.locator('#trabajos [data-stage]');
const counter = (page: Page) => page.locator('#trabajos [data-slot="counter"]');
/** Once settled, the photo in front sits exactly in place: never between two positions. */
const frontSettled = async (page: Page) => expect(await page.locator('#trabajos [data-orbit-card][data-front]').evaluate((card) => (card as HTMLElement).style.transform)).toBe('translate3d(0px, 0px, 0px) rotateY(0deg) scale(1)');
async function showCrown(touch: Touch) {
  await crown(touch.page).evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await expect(touch.page.locator('[data-showcase-section]')).not.toHaveAttribute('data-reveal', /pending|play/, { timeout: 8_000 });
  const box = (await crown(touch.page).boundingBox())!;
  return { box, middle: { x: box.x + box.width / 2, y: box.y + box.height / 2 } };
}
const settle = (page: Page) => page.waitForTimeout(1_100);

test('trabajos táctil: deslizar pasa una foto por gesto, con botones, toque, filtros y scroll vertical intactos', async ({ browser }) => {
  test.setTimeout(90_000);
  const touch = await phone(browser, 390, 844, 'no-preference');
  const { page } = touch;
  try {
    await expect(crown(page)).toHaveCSS('touch-action', 'pan-y');
    const { middle } = await showCrown(touch);
    const top = await scrollTop(page);
    const left = (distance: number, steps = 12, hold = 30) => gesture(touch, line({ x: middle.x + distance / 2, y: middle.y }, { x: middle.x - distance / 2, y: middle.y + 4 }, steps), hold);
    const right = (distance: number, steps = 12, hold = 30) => gesture(touch, line({ x: middle.x - distance / 2, y: middle.y }, { x: middle.x + distance / 2, y: middle.y - 4 }, steps), hold);
    await expect(counter(page)).toHaveText('01 / 23');

    await left(180); await settle(page);
    await expect(counter(page)).toHaveText('02 / 23');
    await right(180); await settle(page);
    await expect(counter(page)).toHaveText('01 / 23');
    // Circular: back from the first work is the last one.
    await right(120, 4, 0); await settle(page);
    await expect(counter(page)).toHaveText('23 / 23');
    // A hard, long flick still moves exactly one photo.
    await left(340, 5, 0); await settle(page);
    await expect(counter(page)).toHaveText('01 / 23');
    await frontSettled(page);
    // A slow but deliberate swipe (≥ 48 px) advances; a short one snaps back.
    await left(64, 8, 400); await settle(page);
    await expect(counter(page)).toHaveText('02 / 23');
    await left(30, 6, 400); await settle(page);
    await expect(counter(page)).toHaveText('02 / 23');
    await frontSettled(page);
    // Quick consecutive swipes, each during the previous transition: one photo each.
    for (let i = 0; i < 3; i++) { await left(180); await page.waitForTimeout(140); }
    await settle(page);
    await expect(counter(page)).toHaveText('05 / 23');
    await frontSettled(page);
    // Sideways swipes never moved the page.
    expect(await scrollTop(page)).toBe(top);

    // A nudge that turned into a drag never opens the photo; a plain tap does.
    await gesture(touch, line(middle, { x: middle.x - 12, y: middle.y }, 4), 0);
    await settle(page);
    expect(await lightboxOpen(page)).toBe(false);
    await expect(counter(page)).toHaveText('05 / 23');
    await gesture(touch, [middle], 40);
    await expect.poll(() => lightboxOpen(page)).toBe(true);
    await page.getByRole('button', { name: 'Cerrar visor' }).tap();
    await expect.poll(() => lightboxOpen(page)).toBe(false);

    // The arrows work exactly as before.
    await page.getByRole('button', { name: 'Trabajo siguiente' }).tap();
    await expect(counter(page)).toHaveText('06 / 23');
    await page.getByRole('button', { name: 'Trabajo anterior' }).tap();
    await expect(counter(page)).toHaveText('05 / 23');

    // Filters: swipes page within the chosen category.
    await page.locator('#trabajos').getByRole('tab', { name: /^Uñas/ }).tap();
    await expect(counter(page)).toHaveText('01 / 09');
    await crown(page).evaluate((element) => element.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(300);
    await left(180); await settle(page);
    await expect(counter(page)).toHaveText('02 / 09');
    await expect(page.locator('#trabajos [data-orbit-card][data-front]')).toHaveAttribute('data-category', 'unas');

    // Vertical intent is the page's: it scrolls and the photo stays.
    const before = await scrollTop(page);
    await gesture(touch, line({ x: middle.x, y: middle.y + 90 }, { x: middle.x + 4, y: middle.y - 150 }));
    await expect.poll(() => scrollTop(page)).toBeGreaterThan(before + 100);
    await expect(counter(page)).toHaveText('02 / 09');
  } finally { await touch.context.close(); }
});

for (const [width, height] of [[320, 568], [430, 932]] as const) {
  test(`táctil ${width}×${height}: el mundo no desplaza la página y la galería se desliza`, async ({ browser }) => {
    test.setTimeout(60_000);
    const touch = await phone(browser, width, height, 'no-preference');
    const { page } = touch;
    try {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const { box, center } = await showGlobe(touch);
      const top = await scrollTop(page);
      const before = await rotor(page);
      await gesture(touch, line({ x: center.x, y: center.y + box.height * .3 }, { x: center.x, y: center.y - box.height * .3 }), 120);
      expect((await turnBetween(page, before, await rotor(page))).angle).toBeGreaterThan(60);
      expect(await scrollTop(page)).toBe(top);
      const { middle } = await showCrown(touch);
      await expect(counter(page)).toHaveText('01 / 23');
      await gesture(touch, line({ x: middle.x + 70, y: middle.y }, { x: middle.x - 70, y: middle.y }));
      await expect(counter(page)).toHaveText('02 / 23');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await touch.context.close(); }
  });
}
