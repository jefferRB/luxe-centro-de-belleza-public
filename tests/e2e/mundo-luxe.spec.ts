import { test, expect, type Page } from '@playwright/test';

/** Mundo LUXE (01) and «Cada detalle, de cerca» (02): the clips are pieces of the 3D world,
 * only one plays, playback follows visibility and preferences, the welcome plays once,
 * and the gallery keeps every work with real counters. */
async function open(page: Page, reducedMotion: 'reduce' | 'no-preference' = 'no-preference') {
  await page.emulateMedia({ reducedMotion });
  await page.addInitScript(() => sessionStorage.setItem('luxe:intro:seen:v1', '1'));
  await page.goto('/');
  await expect(page.locator('luxe-specialties[data-ready]')).toHaveCount(1);
}
const world = (page: Page) => page.locator('luxe-specialties');
const stage = (page: Page) => page.locator('[data-globe-stage]');
const hero = (page: Page) => page.locator('[data-globe-panel][data-key="ritual-toallas-calidas"]');
const playing = (page: Page) => page.locator('[data-globe-panel][data-playing]');
const showGlobe = (page: Page) => page.locator('#servicios .signature').evaluate((element) => element.scrollIntoView({ block: 'center' }));
/** The clip's position on screen and its depth, read from the rotor's real matrix. */
const heroPose = (page: Page) => hero(page).evaluate((panel) => {
  const m = new DOMMatrix(getComputedStyle(document.querySelector('[data-globe-rotor]')!).transform);
  const lat = Number((panel as HTMLElement).dataset.lat) * Math.PI / 180;
  const lon = Number((panel as HTMLElement).dataset.lon) * Math.PI / 180;
  const x = Math.cos(lat) * Math.sin(lon), y = -Math.sin(lat), z = Math.cos(lat) * Math.cos(lon);
  const r = panel.getBoundingClientRect();
  return { cx: r.left + r.width / 2, depth: m.m13 * x + m.m23 * y + m.m33 * z };
});
async function drag(page: Page, dx: number, dy: number) {
  const box = (await stage(page).boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 12 });
  await page.waitForTimeout(160); // rest: no throw
  await page.mouse.up();
}

test('el video del ritual abre el mundo dentro de la esfera, se reproduce en silencio y sin controles', async ({ page }) => {
  await open(page);
  await expect(hero(page)).toHaveAttribute('data-featured', '');
  await expect(hero(page)).toHaveAttribute('data-kind', 'video');
  // It is a piece of the rotor (same 3D context), not an overlay.
  expect(await hero(page).evaluate((panel) => panel.parentElement?.hasAttribute('data-globe-rotor'))).toBe(true);
  const video = hero(page).locator('video');
  // Nothing is requested before the globe is close (the loader looks 300px ahead): while it is
  // further away the clip is not even mounted. In the desktop scene the world can already be
  // that close on arrival, and then it may mount at once.
  const far = await stage(page).evaluate((element) => element.getBoundingClientRect().top > innerHeight + 300);
  if (far) await expect(video).toHaveCount(0);
  await showGlobe(page);
  await expect(playing(page)).toHaveCount(1);
  await expect(playing(page)).toHaveAttribute('data-key', 'ritual-toallas-calidas');
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => !element.paused && element.muted && !element.controls && element.playsInline)).toBe(true);
  await expect(video).toHaveAttribute('data-live', '', { timeout: 8_000 });
  // The clip next to it keeps its poster and has not been requested.
  expect(await page.locator('[data-globe-panel][data-key="limpieza-facial"] video').evaluate((element: HTMLVideoElement) => element.paused && !element.getAttribute('src'))).toBe(true);
  // The welcome copy accompanies it, outside the card.
  await expect(page.locator('[data-specialty-slot="name"]')).toHaveText('El cuidado se siente en cada detalle.');
  await expect(page.locator('[data-specialty-slot="message"]')).toHaveText('Un momento para relajarte y disfrutar de una atención dedicada.');
  await expect(page.locator('[data-globe-zoom]')).toHaveText(/Ver video/);
});

test('el video gira con el mundo: se aleja, se pausa, y vuelve al frente al seguir girando', async ({ page }) => {
  await open(page);
  await showGlobe(page);
  await expect(playing(page)).toHaveCount(1);
  const left = page.getByRole('button', { name: 'Girar a la izquierda' });
  const start = await heroPose(page);
  expect(start.depth).toBeGreaterThan(.97);
  await left.click();
  await expect.poll(async () => Math.abs((await heroPose(page)).cx - start.cx)).toBeGreaterThan(40);
  expect((await heroPose(page)).depth).toBeLessThan(start.depth);
  // Far enough away (towards the back): it rests on its poster.
  for (let index = 1; index < 5; index++) await left.click();
  await expect.poll(async () => (await heroPose(page)).depth).toBeLessThan(.2);
  await expect(hero(page).locator('video')).toHaveJSProperty('paused', true);
  expect(await playing(page).count()).toBeLessThanOrEqual(1);
  // Keep turning the same way: 15 × 24° = one full turn brings it back and it plays again.
  for (let index = 5; index < 15; index++) {
    await left.click();
    expect(await playing(page).count()).toBeLessThanOrEqual(1);
  }
  await expect.poll(async () => (await heroPose(page)).depth).toBeGreaterThan(.97);
  await expect(playing(page)).toHaveAttribute('data-key', 'ritual-toallas-calidas');
});

test('arriba, abajo, izquierda y derecha sin topes; arrastrar nunca abre el visor', async ({ page }) => {
  await open(page, 'reduce');
  await showGlobe(page);
  const matrix = () => page.locator('[data-globe-rotor]').evaluate((rotor) => getComputedStyle(rotor).transform);
  for (const [dx, dy] of [[0, -260], [0, -260], [0, -260], [0, 260], [260, 0], [-260, 0], [-260, 0]] as const) {
    const before = await matrix();
    await drag(page, dx, dy);
    expect(await matrix()).not.toBe(before);
  }
  await expect(page.locator('dialog.lightbox')).not.toHaveAttribute('open', '');
});

test('el visor reproduce el video con controles, pausa la esfera y al cerrar conserva la posición', async ({ page }) => {
  await open(page);
  await showGlobe(page);
  await expect(playing(page)).toHaveCount(1);
  await stage(page).hover();
  await page.locator('[data-globe-zoom]').click();
  const viewer = page.locator('dialog.lightbox [data-lightbox-video]');
  await expect(viewer).toBeVisible();
  await expect(viewer).toHaveJSProperty('controls', true);
  await expect(viewer).toHaveJSProperty('muted', true);
  await expect(page.locator('[data-lightbox-caption]')).toHaveText('Ritual de toallas cálidas');
  await expect(hero(page).locator('video')).toHaveJSProperty('paused', true);
  await page.keyboard.press('ArrowRight');
  await expect(viewer).toBeHidden();
  await expect(page.locator('dialog.lightbox [data-lightbox-image]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-globe-zoom]')).toBeFocused();
  expect(await viewer.evaluate((element: HTMLVideoElement) => element.getAttribute('src'))).toBeNull();
  // The world kept its position (only the ambient sway, a few degrees, may resume).
  expect((await heroPose(page)).depth).toBeGreaterThan(.95);
  await expect(playing(page)).toHaveCount(1);
});

test('fuera de la pantalla, la esfera no reproduce nada', async ({ page }) => {
  await open(page);
  await showGlobe(page);
  await expect(playing(page)).toHaveCount(1);
  await page.locator('#ubicacion').scrollIntoViewIfNeeded();
  await expect(playing(page)).toHaveCount(0);
  expect(await page.locator('[data-globe-video]').evaluateAll((videos) => videos.every((video) => (video as HTMLVideoElement).paused))).toBe(true);
});

test('movimiento reducido: solo portadas, sin presentación, mensaje completo y legible', async ({ page }) => {
  await open(page, 'reduce');
  await showGlobe(page);
  await page.waitForTimeout(800);
  await expect(playing(page)).toHaveCount(0);
  expect(await page.locator('[data-globe-video]').evaluateAll((videos) => videos.every((video) => !(video as HTMLVideoElement).getAttribute('src')))).toBe(true);
  await expect(world(page)).not.toHaveAttribute('data-intro', /.+/);
  expect(await page.locator('.globe-name').evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
});

test('ahorro de datos: solo portadas', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'connection', { value: { saveData: true }, configurable: true }));
  await open(page);
  await showGlobe(page);
  await page.waitForTimeout(800);
  await expect(playing(page)).toHaveCount(0);
});

test('presentación: ocurre una sola vez al llegar, no bloquea y no se repite', async ({ page }) => {
  await open(page);
  await expect(world(page)).toHaveAttribute('data-intro', 'pending');
  await showGlobe(page);
  await expect(world(page)).toHaveAttribute('data-intro', 'play');
  // Controls respond meanwhile.
  await page.getByRole('button', { name: 'Girar a la derecha' }).click();
  await expect(world(page)).toHaveAttribute('data-intro', 'done', { timeout: 4_000 });
  await page.locator('#ubicacion').scrollIntoViewIfNeeded();
  await showGlobe(page);
  await expect(world(page)).toHaveAttribute('data-intro', 'done');
  expect(await page.locator('.globe-stage').evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
});

test('nuestros trabajos: todos los trabajos, contadores reales y revelado editorial único', async ({ page }) => {
  await open(page);
  const section = page.locator('#trabajos');
  await expect(section).toHaveAttribute('data-reveal', 'pending');
  await expect(section.getByRole('heading', { level: 2 })).toHaveText(/El resultado\s*habla por sí solo\./);
  await section.locator('[data-stage]').scrollIntoViewIfNeeded();
  await expect(section).toHaveAttribute('data-reveal', 'play');
  await expect(section).toHaveAttribute('data-reveal', 'done', { timeout: 4_000 });
  const counts = await section.locator('[role="tab"] .tab-count').allInnerTexts();
  expect(counts).toEqual(['23', '08', '03', '09', '01', '02']);
  for (const [name, ids] of [
    ['Cortes y barbería', ['barberia-perfil-barba']], ['Peluquería', ['peluqueria-rubio-texturizado']], ['Faciales', ['facial-aparatologia']],
    ['Uñas', ['unas-vino-animal-print', 'unas-grafico', 'unas-francesa-flores', 'unas-dorado-puntos', 'unas-azul-animal-print']],
  ] as const) {
    await section.getByRole('tab', { name: new RegExp(`^${name}`) }).click();
    const visible = await section.locator('[data-orbit-card]:not([data-off])').evaluateAll((cards) => cards.map((card) => (card as HTMLElement).dataset.id));
    for (const id of ids) expect(visible).toContain(id);
  }
  // Vertical originals keep their proportions (no distortion, no crop of the work).
  for (const card of await section.locator('[data-orbit-card]:not([data-off])').all()) {
    const { natural, frame } = await card.evaluate((element) => {
      const image = element.querySelector('img')!;
      return { natural: image.naturalWidth / image.naturalHeight, frame: (element as HTMLElement).offsetWidth / (element as HTMLElement).offsetHeight };
    });
    if (natural) expect(Math.abs(natural - frame)).toBeLessThan(.02);
  }
});

for (const width of [360, 390, 768, 1440, 1920]) {
  test(`mundo y galería a ${width}px: sin desbordes, sin errores y el video dentro del globo`, async ({ page }) => {
    const problems: string[] = [];
    page.on('pageerror', (error) => problems.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') problems.push(message.text()); });
    await page.setViewportSize({ width, height: width < 768 ? 800 : 1000 });
    await open(page);
    await showGlobe(page);
    await expect(playing(page)).toHaveCount(1);
    const globe = (await stage(page).boundingBox())!;
    const clip = (await hero(page).boundingBox())!;
    expect(clip.x).toBeGreaterThanOrEqual(globe.x);
    expect(clip.x + clip.width).toBeLessThanOrEqual(globe.x + globe.width);
    // The contextual line never covers the clip: it lives in the copy below the globe
    // (phones, tablets) or in the rail beside it (desktop scene).
    const copy = (await page.locator('.globe-name').boundingBox())!;
    expect(copy.y >= clip.y + clip.height || copy.x >= globe.x + globe.width).toBe(true);
    await page.locator('#trabajos [data-stage]').scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    expect(problems).toEqual([]);
  });
}

test('táctil: el video del frente se reproduce aunque el mundo esté quieto, y un dedo sobre el mundo es solo del mundo', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'no-preference' });
  try {
    const page = await context.newPage();
    await page.addInitScript(() => sessionStorage.setItem('luxe:intro:seen:v1', '1'));
    await page.goto('http://localhost:4321/');
    await expect(page.locator('luxe-specialties[data-ready]')).toHaveCount(1);
    await showGlobe(page);
    await expect(playing(page)).toHaveAttribute('data-key', 'ritual-toallas-calidas');
    // No panning on the world (two fingers may still zoom): gestures in tests/e2e/tactil.spec.ts.
    expect(await stage(page).evaluate((element) => getComputedStyle(element).touchAction)).toBe('pinch-zoom');
  } finally { await context.close(); }
});
