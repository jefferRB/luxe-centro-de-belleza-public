import { test, expect, type Page } from '@playwright/test';

/** Fase «Orbital immersive exploration»: the real camera of «El espacio» (mode A at rest,
 * mode B «Explorar en 3D», «Entrar a LUXE», the interior view and «Ver recorrido»).
 * Screenshots for the QA record go to test-results/qa/espacio-3d/. */
const SHOTS = 'test-results/qa/espacio-3d';
const host = (page: Page) => page.locator('luxe-space-tour');
const tabs = (page: Page) => page.locator('#espacio [role="tab"]');
const exploreButton = (page: Page) => page.locator('[data-space-explore]');
const enterButton = (page: Page) => page.getByRole('button', { name: 'Entrar a LUXE' });
const demoButton = (page: Page) => page.locator('[data-space-demo]');
const interior = (page: Page) => page.locator('[data-tour-interior]');

async function open(page: Page, reducedMotion: 'reduce' | 'no-preference' = 'no-preference') {
  const errors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.emulateMedia({ reducedMotion });
  await page.addInitScript(() => sessionStorage.setItem('luxe:intro:seen:v1', '1'));
  await page.goto('/');
  await expect(page.locator('luxe-space-tour[data-ready]')).toHaveCount(1);
  await page.locator('#espacio').evaluate((element) => element.scrollIntoView());
  await expect(host(page)).not.toHaveAttribute('data-reveal', /.+/, { timeout: 6_000 });
  await expect(host(page)).toHaveAttribute('data-camera', 'home');
  return errors;
}

/** Where the camera draws the portal's corners and centre (viewport px), and how it is resting. */
const scene = (page: Page) => page.evaluate(async () => {
  await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  const portal = document.querySelector<HTMLElement>('[data-tour-portal]')!;
  const orbit = document.querySelector<HTMLElement>('[data-tour-orbit]')!.getBoundingClientRect();
  const matrix = new DOMMatrix(getComputedStyle(portal).transform);
  let left = 0;
  let top = 0;
  for (let node: HTMLElement | null = portal; node && !node.hasAttribute('data-tour-orbit'); node = node.offsetParent as HTMLElement | null) { left += node.offsetLeft; top += node.offsetTop; }
  const corner = (x: number, y: number) => {
    const point = matrix.transformPoint(new DOMPoint(x, y, 0, 1));
    return { x: orbit.left + left + point.x / point.w, y: orbit.top + top + point.y / point.w };
  };
  const w = portal.offsetWidth;
  const h = portal.offsetHeight;
  const cards = [...document.querySelectorAll<HTMLElement>('[data-tour-thumb]')].map((card) => {
    const m = new DOMMatrix(getComputedStyle(card).transform);
    const p = (x: number, y: number) => { const q = m.transformPoint(new DOMPoint(x, y, 0, 1)); return { x: q.x / q.w, y: q.y / q.w }; };
    const [a, b, c, d] = [p(0, 0), p(card.offsetWidth, 0), p(0, card.offsetHeight), p(card.offsetWidth, card.offsetHeight)];
    const length = (u: { x: number; y: number }, v: { x: number; y: number }) => Math.hypot(u.x - v.x, u.y - v.y);
    return { top: length(a!, b!), bottom: length(c!, d!), left: length(a!, c!), right: length(b!, d!), images: card.querySelectorAll('img').length, visible: getComputedStyle(card).visibility !== 'hidden' };
  });
  return {
    mode: document.querySelector<HTMLElement>('luxe-space-tour')!.dataset.camera,
    moving: document.querySelector('luxe-space-tour')!.hasAttribute('data-camera-moving'),
    corners: [corner(0, 0), corner(w, 0), corner(0, h), corner(w, h)],
    layout: { x: orbit.left + left, y: orbit.top + top, w, h },
    centre: corner(w / 2, h / 2),
    cards,
  };
});

const settled = async (page: Page) => {
  await expect(host(page)).not.toHaveAttribute('data-camera-moving', '', { timeout: 5_000 });
  return scene(page);
};

test('modo A por defecto: la composición actual, el portal sin deformar y la navegación de siempre', async ({ page }) => {
  const errors = await open(page);
  const rest = await scene(page);
  // Mode A: the camera at rest draws the portal exactly where the page lays it out.
  const [a, b, c, d] = rest.corners;
  for (const [point, x, y] of [[a, 0, 0], [b, 1, 0], [c, 0, 1], [d, 1, 1]] as const) {
    expect(Math.abs(point!.x - (rest.layout.x + x * rest.layout.w))).toBeLessThan(.6);
    expect(Math.abs(point!.y - (rest.layout.y + y * rest.layout.h))).toBeLessThan(.6);
  }
  await expect(tabs(page)).toHaveCount(5);
  expect(rest.cards.every((card) => card.images === 1 && card.visible)).toBe(true);
  await expect(exploreButton(page)).toHaveText('Explorar en 3D');
  await expect(enterButton(page)).toBeVisible();
  await expect(demoButton(page)).toHaveText('Ver recorrido');
  await expect(page.locator('[data-space-viewpoints]')).toBeHidden();
  // Normal navigation is untouched: arrows, cards, drag of the crown.
  await page.getByRole('button', { name: 'Ambiente siguiente' }).click();
  await expect(page.locator('[data-tour-slot="title"]')).toHaveText('Otra perspectiva');
  await tabs(page).nth(3).click();
  await expect(page.locator('[data-tour-counter]')).toHaveText('04 / 05');
  await expect(host(page)).toHaveAttribute('data-camera', 'home');
  // The rings are drawn in depth: far half behind the portal, near half in front.
  const order = await page.evaluate(() => ['[data-tour-rings="back"]', '[data-tour-portal]', '[data-tour-rings="front"]'].map((selector) => Number(getComputedStyle(document.querySelector(selector)!).zIndex)));
  expect(order[0]).toBeLessThan(order[1]!);
  expect(order[1]).toBeLessThan(order[2]!);
  await page.screenshot({ path: `${SHOTS}/01-vista-original.png` });
  expect(errors).toEqual([]);
});

test('modo B: la cámara se separa, el arrastre recorre la órbita con perspectiva coherente y sin saltos', async ({ page }) => {
  const errors = await open(page);
  await exploreButton(page).click();
  await expect(host(page)).toHaveAttribute('data-camera', 'free');
  await expect(exploreButton(page)).toHaveText('Volver a la vista original');
  await expect(page.locator('[data-space-viewpoints]')).toBeVisible();
  const free = await settled(page);
  // A small change of perspective: the portal is no longer a flat rectangle.
  expect(Math.abs(free.corners[0]!.y - free.corners[1]!.y)).toBeGreaterThan(1);

  // Mouse drag to the left: the installation turns, the camera moves right (yaw > 0).
  const orbit = (await page.locator('[data-tour-orbit]').boundingBox())!;
  const start = { x: orbit.x + orbit.width * .7, y: orbit.y + orbit.height * .55 };
  const samples: number[] = [];
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let step = 1; step <= 24; step++) {
    await page.mouse.move(start.x - step * 12, start.y);
    samples.push((await scene(page)).centre.x);
  }
  await page.mouse.up();
  const side = await settled(page);
  // Seen from the right, the portal's right edge is the nearer one: taller on screen.
  const leftEdge = side.corners[2]!.y - side.corners[0]!.y;
  const rightEdge = side.corners[3]!.y - side.corners[1]!.y;
  expect(rightEdge).toBeGreaterThan(leftEdge);
  // No jumps or spins: the portal moves a few px per step at most, always the same way.
  const steps = samples.slice(1).map((value, index) => value - samples[index]!);
  expect(Math.max(...steps.map(Math.abs))).toBeLessThan(40);
  // Cards stay rectangles in space: no shearing beyond perspective.
  for (const card of side.cards.filter((entry) => entry.visible)) {
    expect(card.top / card.bottom).toBeGreaterThan(.6);
    expect(card.top / card.bottom).toBeLessThan(1.6);
    expect(card.left / card.right).toBeGreaterThan(.5);
    expect(card.left / card.right).toBeLessThan(2);
  }
  await page.screenshot({ path: `${SHOTS}/02-camara-lateral.png` });

  // A selection still works and the camera turns back towards the front softly.
  await tabs(page).nth(2).click();
  await expect(page.locator('[data-tour-slot="title"]')).toHaveText('Un lugar para tu momento');
  await expect(host(page)).toHaveAttribute('data-camera', 'free');
  expect(errors).toEqual([]);
});

test('modo B: puntos de vista por teclado (elevada), y vuelta a la vista original conservando la selección', async ({ page }) => {
  const errors = await open(page);
  await tabs(page).nth(4).click();
  await exploreButton(page).focus();
  await page.keyboard.press('Enter');
  await expect(host(page)).toHaveAttribute('data-camera', 'free');
  const high = page.locator('[data-viewpoint="elevada"]');
  await high.focus();
  await expect(high).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(high).toHaveAttribute('aria-pressed', 'true');
  const elevated = await settled(page);
  // From above, the top of the portal is nearer: wider than its base.
  expect(elevated.corners[1]!.x - elevated.corners[0]!.x).toBeGreaterThan(elevated.corners[3]!.x - elevated.corners[2]!.x);
  await page.screenshot({ path: `${SHOTS}/03-camara-elevada.png` });
  await page.locator('[data-viewpoint="izquierda"]').click();
  await expect(page.locator('[data-viewpoint="izquierda"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(high).toHaveAttribute('aria-pressed', 'false');
  await settled(page);
  // «Volver a la vista original»: same button, focus kept; selection kept.
  await exploreButton(page).focus();
  await page.keyboard.press('Enter');
  await expect(host(page)).toHaveAttribute('data-camera', 'home');
  await expect(exploreButton(page)).toBeFocused();
  const home = await settled(page);
  expect(Math.abs(home.corners[0]!.x - home.layout.x)).toBeLessThan(.6);
  expect(Math.abs(home.corners[3]!.y - (home.layout.y + home.layout.h))).toBeLessThan(.6);
  await expect(page.locator('[data-tour-slot="title"]')).toHaveText('Antes de empezar');
  await expect(tabs(page).nth(4)).toHaveAttribute('aria-selected', 'true');
  expect(errors).toEqual([]);
});

test('«Entrar a LUXE»: travelling continuo hacia el portal, vista interior con la foto correcta y regreso con Escape', async ({ page }) => {
  const errors = await open(page);
  await tabs(page).nth(3).click();
  await expect(page.locator('[data-tour-counter]')).toHaveText('04 / 05');
  // Sample the flight frame by frame: the portal only grows, never jumps.
  const flight = page.evaluate(async () => {
    const portal = document.querySelector<HTMLElement>('[data-tour-portal]')!;
    const scales: number[] = [];
    const start = performance.now();
    // Until the interior takes over (the flight starts once the photo is ready).
    while (!document.querySelector<HTMLDialogElement>('[data-tour-interior]')!.open && performance.now() - start < 9000) {
      await new Promise((done) => requestAnimationFrame(done));
      const m = new DOMMatrix(portal.style.transform);
      scales.push(1 / m.m44);
    }
    return scales;
  });
  await enterButton(page).click();
  await expect(host(page)).toHaveAttribute('data-camera', 'flight');
  const scales = await flight;
  const peak = Math.max(...scales);
  expect(peak).toBeGreaterThan(1.4);
  const deltas = scales.slice(1).map((value, index) => value - scales[index]!);
  expect(Math.min(...deltas)).toBeGreaterThan(-.01);
  expect(Math.max(...deltas)).toBeLessThan(.08);

  await expect(interior(page)).toHaveAttribute('open', '');
  await expect(host(page)).toHaveAttribute('data-camera', 'interior');
  await expect(page.locator('#tour-interior-title')).toHaveText('Área de manicura');
  await expect(page.getByRole('button', { name: 'Volver al mundo LUXE' })).toBeFocused();
  const photo = page.locator('[data-interior-full]');
  await expect(photo).toHaveAttribute('data-loaded', '');
  const fit = await photo.evaluate((image: HTMLImageElement) => {
    const box = image.parentElement!.getBoundingClientRect();
    return { box: box.width / box.height, natural: image.naturalWidth / image.naturalHeight, alt: image.alt, inside: box.top >= -1 && box.bottom <= innerHeight + 1 && box.left >= -1 && box.right <= innerWidth + 1 };
  });
  expect(Math.abs(fit.box - fit.natural)).toBeLessThan(.02);
  expect(fit.alt).toMatch(/manicura/i);
  expect(fit.inside).toBe(true);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/05-vista-interior.png` });

  // «Ampliar» opens the shared viewer on top; Escape closes only the viewer.
  await page.locator('[data-interior-zoom]').click();
  await expect(page.locator('luxe-lightbox dialog')).toHaveAttribute('open', '');
  await page.keyboard.press('Escape');
  await expect(page.locator('luxe-lightbox dialog')).not.toHaveAttribute('open', '');
  await expect(interior(page)).toHaveAttribute('open', '');

  // Escape: the photo goes back into the portal and the camera returns.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${SHOTS}/06-regreso.png` });
  await expect(interior(page)).not.toHaveAttribute('open', '');
  await expect(host(page)).toHaveAttribute('data-camera', 'home', { timeout: 5_000 });
  await expect(enterButton(page)).toBeFocused();
  await expect(tabs(page).nth(3)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-tour-slot="title"]')).toHaveText('Área de manicura');
  const back = await settled(page);
  expect(Math.abs(back.corners[0]!.x - back.layout.x)).toBeLessThan(.6);
  // Nothing stays locked: the page scrolls.
  const before = await page.evaluate(() => scrollY);
  await page.mouse.wheel(0, 400);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(before + 100);
  expect(errors).toEqual([]);
});

test('aproximación al portal: captura a mitad del travelling (reloj controlado)', async ({ page }) => {
  await page.clock.install();
  await open(page);
  // Click and pause in the same tick of the page's clock, then step to mid-flight.
  const pause = await page.evaluate(() => { document.querySelector<HTMLButtonElement>('[data-space-enter]')!.click(); return Date.now() + 400; });
  await page.clock.pauseAt(pause);
  await page.clock.runFor(750);
  await expect(host(page)).toHaveAttribute('data-camera', 'flight');
  await page.screenshot({ path: `${SHOTS}/04-aproximacion-portal.png` });
  await page.clock.resume();
  await expect(interior(page)).toHaveAttribute('open', '', { timeout: 5_000 });
  await page.getByRole('button', { name: 'Volver al mundo LUXE' }).click();
  await expect(host(page)).toHaveAttribute('data-camera', 'home', { timeout: 5_000 });
});

test('«Ver recorrido»: no arranca solo, se cancela con Escape o tomando el control, y completo termina en la vista interior', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = await open(page);
  await page.waitForTimeout(1500);
  await expect(host(page)).toHaveAttribute('data-camera', 'home');
  // Escape stops it in a controlled way: mode B, outside the portal.
  await demoButton(page).click();
  await expect(demoButton(page)).toHaveText('Detener recorrido');
  await expect(demoButton(page)).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(1200);
  await page.keyboard.press('Escape');
  await expect(demoButton(page)).toHaveText('Ver recorrido');
  await expect(host(page)).toHaveAttribute('data-camera', 'free');
  await settled(page);
  await expect(interior(page)).not.toHaveAttribute('open', '');
  // Taking the camera (a press on the scene) also stops it.
  await demoButton(page).click();
  await page.waitForTimeout(800);
  const orbit = (await page.locator('[data-tour-orbit]').boundingBox())!;
  await page.mouse.click(orbit.x + 20, orbit.y + orbit.height - 20);
  await expect(demoButton(page)).toHaveText('Ver recorrido');
  await expect(host(page)).toHaveAttribute('data-camera', 'free');
  await settled(page);
  // The control itself stops it too.
  await demoButton(page).click();
  await page.waitForTimeout(500);
  await demoButton(page).click();
  await expect(demoButton(page)).toHaveText('Ver recorrido');
  await settled(page);
  // Back to the original view, then a full run: it ends inside the selected photo.
  await exploreButton(page).click();
  await expect(host(page)).toHaveAttribute('data-camera', 'home');
  await settled(page);
  const started = Date.now();
  await demoButton(page).click();
  await expect(interior(page)).toHaveAttribute('open', '', { timeout: 12_000 });
  const seconds = (Date.now() - started) / 1000;
  expect(seconds).toBeGreaterThan(4.5);
  expect(seconds).toBeLessThan(9);
  await expect(page.locator('#tour-interior-title')).toHaveText('Estaciones y espejos');
  await page.getByRole('button', { name: 'Volver al mundo LUXE' }).click();
  await expect(host(page)).toHaveAttribute('data-camera', 'home', { timeout: 5_000 });
  await expect(demoButton(page)).toBeFocused();
  expect(errors).toEqual([]);
});

test('táctil en modo B: deslizar en horizontal mueve la cámara; en vertical la página se desplaza', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'es-CR', reducedMotion: 'no-preference' });
  const mobile = await context.newPage();
  try {
    const errors = await open(mobile);
    await exploreButton(mobile).click();
    await expect(host(mobile)).toHaveAttribute('data-camera', 'free');
    await expect(mobile.locator('[data-tour-orbit]')).toHaveCSS('touch-action', 'pan-y');
    await mobile.locator('[data-tour-orbit]').evaluate((element) => element.scrollIntoView({ block: 'center' }));
    const before = await settled(mobile);
    const cdp = await context.newCDPSession(mobile);
    const swipe = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
      for (let step = 1; step <= 12; step++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + ((to.x - from.x) * step) / 12, y: from.y + ((to.y - from.y) * step) / 12 }] });
      }
      await mobile.waitForTimeout(120);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    const box = (await mobile.locator('[data-tour-orbit]').boundingBox())!;
    const middle = { x: box.x + box.width / 2, y: box.y + box.height * .55 };
    await swipe({ x: middle.x + 90, y: middle.y }, { x: middle.x - 90, y: middle.y + 4 });
    const turned = await settled(mobile);
    expect(Math.abs(turned.centre.x - before.centre.x) + Math.abs(turned.corners[1]!.y - before.corners[1]!.y)).toBeGreaterThan(4);
    await expect(tabs(mobile).nth(0)).toHaveAttribute('aria-selected', 'true');
    const scrolled = await mobile.evaluate(() => scrollY);
    await swipe({ x: middle.x, y: middle.y + 60 }, { x: middle.x + 3, y: middle.y - 200 });
    await expect.poll(() => mobile.evaluate(() => scrollY)).toBeGreaterThan(scrolled + 60);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test('movimiento reducido: sin recorrido automático ni travelling; entrar y volver son inmediatos', async ({ page }) => {
  const errors = await open(page, 'reduce');
  await expect(demoButton(page)).toBeHidden();
  await exploreButton(page).click();
  await expect(host(page)).toHaveAttribute('data-camera', 'free');
  await expect(host(page)).not.toHaveAttribute('data-camera-moving', '');
  await exploreButton(page).click();
  await expect(host(page)).toHaveAttribute('data-camera', 'home');
  await enterButton(page).click();
  await expect(interior(page)).toHaveAttribute('open', '');
  await expect(page.getByRole('button', { name: 'Volver al mundo LUXE' })).toBeFocused();
  expect(await page.evaluate(() => document.querySelector('[data-interior-photo]')!.getAnimations().length)).toBe(0);
  await page.keyboard.press('Escape');
  await expect(interior(page)).not.toHaveAttribute('open', '');
  await expect(host(page)).toHaveAttribute('data-camera', 'home');
  await expect(enterButton(page)).toBeFocused();
  expect(errors).toEqual([]);
});

for (const [width, height] of [[390, 844], [768, 1024], [1440, 900]] as const) {
  test(`composición a ${width}px: controles visibles, sin desbordes, entrada y vuelta operables`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const errors = await open(page);
    await expect(page.locator('[data-tour-modes]')).toBeVisible();
    for (const button of [exploreButton(page), enterButton(page), demoButton(page)]) {
      const box = (await button.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(43);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    await exploreButton(page).click();
    await settled(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await enterButton(page).click();
    await expect(interior(page)).toHaveAttribute('open', '', { timeout: 6_000 });
    const inside = await page.locator('[data-interior-photo]').evaluate((element) => {
      const box = element.getBoundingClientRect();
      return box.left >= -1 && box.right <= innerWidth + 1 && box.top >= -1 && box.width > 100;
    });
    expect(inside).toBe(true);
    if (width === 390) await page.screenshot({ path: `${SHOTS}/07-movil-interior.png` });
    await page.getByRole('button', { name: 'Volver al mundo LUXE' }).click();
    await expect(host(page)).toHaveAttribute('data-camera', 'free', { timeout: 6_000 });
    if (width === 390) {
      await settled(page);
      await page.locator('[data-tour-orbit]').evaluate((element) => element.scrollIntoView({ block: 'center' }));
      await page.screenshot({ path: `${SHOTS}/08-movil-3d.png` });
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    expect(errors).toEqual([]);
  });
}

test('sin JavaScript: ni controles de cámara ni capas 3D; la corona queda compuesta como siempre', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    await page.goto('/');
    await expect(page.locator('[data-tour-modes]')).toBeHidden();
    await expect(page.locator('[data-tour-rings="front"]')).toBeHidden();
    await expect(page.locator('.tour-ring svg')).toBeVisible();
    await expect(page.locator('[data-tour-interior]')).not.toHaveAttribute('open', '');
  } finally { await context.close(); }
});
