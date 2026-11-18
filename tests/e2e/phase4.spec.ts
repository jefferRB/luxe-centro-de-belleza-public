import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { resolve, extname, sep } from 'node:path';
import { test, expect, type Page, type Locator } from '@playwright/test';

/** Fase 4–4.2: specialty photo globe, works crown, space walk, visit (facade, hours,
 * Waze), shared lightbox and the always-available action dock. */
const LINKS = {
  booking: 'https://www.dragocr.com/reservar/luxecentrobelleza',
  whatsapp: 'https://wa.me/50671620752',
  instagram: 'https://www.instagram.com/luxe_centrodebelleza/',
  maps: 'https://maps.app.goo.gl/z7ss3mpVHJqMxDbe6',
  waze: 'https://waze.com/ul/hd1u22w6m3',
};
const frames = (page: Page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));

async function open(page: Page, reducedMotion: 'reduce' | 'no-preference' = 'reduce') {
  await page.emulateMedia({ reducedMotion });
  await page.addInitScript(() => sessionStorage.setItem('luxe:intro:seen:v1', '1'));
  await page.goto('/');
  await expect(page.locator('luxe-specialties[data-ready]')).toHaveCount(1);
  await expect(page.locator('luxe-showcase[data-ready]')).toHaveCount(1);
  await expect(page.locator('luxe-space-tour[data-ready]')).toHaveCount(1);
}

// ——— Especialidades: globo 3D de fotografías ———
const specialtyButton = (page: Page, name: string) => page.locator('#servicios').getByRole('button', { name, exact: true });
const slot = (page: Page, name: string) => page.locator(`[data-specialty-slot="${name}"]`);
const lightbox = (page: Page) => page.locator('dialog.lightbox');
const stage = (page: Page) => page.locator('[data-globe-stage]');
const featuredPanel = (page: Page) => page.locator('[data-globe-panel][data-featured]');
const FEATURED: Record<string, [string, string]> = {
  barberia: ['Barbería y barba', 'corte-peinado'], peluqueria: ['Peluquería', 'peluqueria-rubio-ondas'], 'unas-pedicura': ['Uñas y pedicura', 'unas-flores'],
  cejas: ['Cejas', 'cejas-definidas'], facial: ['Cuidado facial', 'facial-proceso'],
};

/** The rotor's rotation matrix (row-major 3×3), read from its computed transform. */
const rotation = (page: Page) => page.locator('[data-globe-rotor]').evaluate((rotor) => {
  const m = new DOMMatrix(getComputedStyle(rotor).transform);
  return [m.m11, m.m21, m.m31, m.m12, m.m22, m.m32, m.m13, m.m23, m.m33];
});
/** Angle (degrees) between two orientations. Uses ‖A − B‖ = 2√2·sin(θ/2), which is exact
 * at 0 (acos of the trace is not: rounding alone would read identical matrices as ~0.05°). */
const angleBetween = (a: number[], b: number[]) => {
  const distance = Math.sqrt(a.reduce((sum, value, index) => sum + (value - b[index]!) ** 2, 0));
  return 2 * Math.asin(Math.min(1, distance / (2 * Math.SQRT2))) * 180 / Math.PI;
};
/** Where every panel sits in screen space (x right, y down, z towards the visitor). */
const worldVectors = (page: Page) => page.evaluate(() => {
  const m = new DOMMatrix(getComputedStyle(document.querySelector('[data-globe-rotor]')!).transform);
  return [...document.querySelectorAll<HTMLElement>('[data-globe-panel]')].map((panel) => {
    const lat = Number(panel.dataset.lat) * Math.PI / 180;
    const lon = Number(panel.dataset.lon) * Math.PI / 180;
    const x = Math.cos(lat) * Math.sin(lon), y = -Math.sin(lat), z = Math.cos(lat) * Math.cos(lon);
    return { key: panel.dataset.key!, kind: panel.dataset.kind!, v: [m.m11 * x + m.m21 * y + m.m31 * z, m.m12 * x + m.m22 * y + m.m32 * z, m.m13 * x + m.m23 * y + m.m33 * z] as const };
  });
});
/** Depth of every panel (1 = facing the visitor). */
const depths = async (page: Page) => (await worldVectors(page)).map(({ key, kind, v }) => ({ key, kind, depth: v[2] }));
/** Largest change of one screen axis across all panels between two moments. */
const axisShift = (before: Awaited<ReturnType<typeof worldVectors>>, after: Awaited<ReturnType<typeof worldVectors>>, axis: 0 | 1 | 2) =>
  Math.max(...before.map((panel, index) => Math.abs(panel.v[axis] - after[index]!.v[axis])));
async function drag(page: Page, dx: number, dy: number, options: { from?: [number, number]; rest?: number } = {}) {
  await stage(page).scrollIntoViewIfNeeded();
  const box = (await stage(page).boundingBox())!;
  const [fx, fy] = options.from ?? [.5, .5];
  const x = box.x + box.width * fx;
  const y = box.y + box.height * fy;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 10 });
  if (options.rest) await page.waitForTimeout(options.rest);
  await page.mouse.up();
}
async function expectSpecialty(page: Page, id: string) {
  const [name, key] = FEATURED[id]!;
  await expect(page.locator(`[data-specialty-row="${id}"]`)).toHaveAttribute('data-active', '');
  await expect(page.locator('[data-specialty-row][data-active]')).toHaveCount(1);
  await expect(specialtyButton(page, name)).toHaveAttribute('aria-pressed', 'true');
  await expect(slot(page, 'name')).toHaveText(name);
  await expect(page.locator('#specialty-panel .signature-cta')).toHaveAttribute('href', LINKS.booking);
  await expect(featuredPanel(page)).toHaveCount(1);
  await expect(featuredPanel(page)).toHaveAttribute('data-key', key);
}
/** The featured panel has turned to the front. */
async function expectFacing(page: Page, key: string) {
  await expect.poll(async () => (await depths(page)).find((panel) => panel.key === key)!.depth, { timeout: 3_000 }).toBeGreaterThan(.97);
}

test('globo: una esfera de paneles reales en distintas latitudes y longitudes, nunca una fila', async ({ page }) => {
  await open(page);
  const panels = page.locator('[data-globe-panel]');
  expect(await panels.count()).toBeGreaterThanOrEqual(26);
  // Mundo LUXE: a curated mix of 19 photos (works and interiors) and the two real clips.
  const photos = page.locator('[data-globe-panel][data-kind="photo"]');
  await expect(photos).toHaveCount(19);
  await expect(page.locator('[data-globe-panel][data-kind="video"]')).toHaveCount(2);
  const keys = await photos.evaluateAll((items) => items.map((item) => (item as HTMLElement).dataset.key));
  expect(new Set(keys).size).toBe(19);
  for (const id of ['corte-fade-perfil', 'peluqueria-rubio-ondas', 'peluqueria-liso', 'barberia-perfil-barba', 'unas-grafico', 'facial-aparatologia']) expect(keys).toContain(id);
  const coords = await panels.evaluateAll((items) => items.map((item) => [Number((item as HTMLElement).dataset.lat), Number((item as HTMLElement).dataset.lon)]));
  expect(new Set(coords.map(([lat]) => lat)).size).toBe(coords.length);
  expect(Math.max(...coords.map(([lat]) => lat!))).toBeGreaterThan(60);
  expect(Math.min(...coords.map(([lat]) => lat!))).toBeLessThan(-60);
  // A real 3D context: one rotor, preserve-3d all the way down, panels tangent to the sphere.
  expect(await page.locator('[data-globe-rotor]').evaluate((rotor) => getComputedStyle(rotor).transformStyle)).toBe('preserve-3d');
  expect(await panels.first().evaluate((panel) => getComputedStyle(panel).transformStyle)).toBe('preserve-3d');
  // Several depths at once: some pieces in front, some on the sides, some behind.
  const all = await depths(page);
  expect(all.filter((panel) => panel.depth > .6).length).toBeGreaterThan(3);
  expect(all.filter((panel) => panel.depth < -.4).length).toBeGreaterThan(3);
  // The rendered silhouette is round: as wide as it is tall.
  const boxes = await panels.evaluateAll((items) => items.map((item) => item.getBoundingClientRect()).filter((r) => r.width > 0));
  const width = Math.max(...boxes.map((r) => r.right)) - Math.min(...boxes.map((r) => r.left));
  const height = Math.max(...boxes.map((r) => r.bottom)) - Math.min(...boxes.map((r) => r.top));
  expect(Math.abs(width - height) / width).toBeLessThan(.12);
  expect(width).toBeGreaterThanOrEqual(480);
  await expect(page.locator('#servicios')).not.toContainText(/Arrastrá para girar/);
});

test('globo: arrastre horizontal gira sobre el eje vertical; vertical, sobre el horizontal, sin límite', async ({ page }) => {
  await open(page);
  const start = await worldVectors(page);
  await drag(page, 160, 0, { rest: 150 });
  const turned = await worldVectors(page);
  // A horizontal drag turns about the vertical axis: heights do not change, x/z do.
  expect(axisShift(start, turned, 1)).toBeLessThan(.02);
  expect(axisShift(start, turned, 0)).toBeGreaterThan(.4);
  await drag(page, 0, -400, { rest: 150 });
  const tilted = await worldVectors(page);
  // A vertical drag turns about the horizontal axis: x does not change.
  expect(axisShift(turned, tilted, 0)).toBeLessThan(.02);
  expect(axisShift(turned, tilted, 1)).toBeGreaterThan(.4);
  // Far past the old ±38° limit: a long upward drag keeps turning.
  const before = await rotation(page);
  await drag(page, 0, -600, { from: [.5, .9], rest: 150 });
  expect(angleBetween(before, await rotation(page))).toBeGreaterThan(90);
  // The whole sculpture turns: panels keep their own coordinates on the sphere.
  const coords = await page.locator('[data-globe-panel]').evaluateAll((items) => items.map((item) => (item as HTMLElement).style.getPropertyValue('--lat') + (item as HTMLElement).style.getPropertyValue('--lon')));
  await drag(page, -120, 40, { rest: 150 });
  expect(await page.locator('[data-globe-panel]').evaluateAll((items) => items.map((item) => (item as HTMLElement).style.getPropertyValue('--lat') + (item as HTMLElement).style.getPropertyValue('--lon')))).toEqual(coords);
  // A drag never opens the viewer; with reduced motion nothing settles or changes by itself.
  await expect(lightbox(page)).not.toHaveAttribute('open', '');
  await expect(page.locator('[data-specialty-row][data-active]')).toHaveCount(0);
  await expect(featuredPanel(page)).toHaveAttribute('data-key', 'ritual-toallas-calidas');
});

test('globo: vueltas verticales y horizontales completas, sin saltos al cruzar los polos', async ({ page }) => {
  await open(page);
  await stage(page).focus();
  const start = await rotation(page);
  let previous = start;
  // 15 × 24° = 360° upwards: every step is exactly one step, through both poles.
  for (let step = 0; step < 15; step++) {
    await page.keyboard.press('ArrowUp');
    const now = await rotation(page);
    expect(angleBetween(previous, now)).toBeCloseTo(24, 0);
    previous = now;
  }
  expect(angleBetween(start, previous)).toBeLessThan(1.5);
  // And 30 × 24° = 720° to the right: two horizontal turns, back where it started.
  for (let step = 0; step < 30; step++) await page.keyboard.press('ArrowRight');
  expect(angleBetween(start, await rotation(page))).toBeLessThan(2);
  // Mixed directions never accumulate drift.
  for (const key of ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowDown', 'ArrowUp']) await page.keyboard.press(key);
  const mixed = await rotation(page);
  const back = [...mixed];
  expect(back.every(Number.isFinite)).toBe(true);
  // Choosing a specialty from any orientation shows its photo upright and in front.
  await specialtyButton(page, 'Uñas y pedicura').click();
  await expectFacing(page, 'unas-flores');
  const upright = await featuredPanel(page).evaluate((panel) => { const r = panel.getBoundingClientRect(); return r.height > r.width; });
  expect(upright).toBe(true);
});

test('globo: rotar ~90° revela fotografías que estaban detrás, sin espejos', async ({ page }) => {
  await open(page);
  const start = await depths(page);
  const hidden = start.filter((panel) => panel.kind === 'photo' && panel.depth < -.3).map((panel) => panel.key);
  expect(hidden.length).toBeGreaterThan(0);
  await stage(page).scrollIntoViewIfNeeded();
  const box = (await stage(page).boundingBox())!;
  await drag(page, box.width * .9, 0, { rest: 150 });
  const after = await depths(page);
  expect(after.filter((panel) => hidden.includes(panel.key) && panel.depth > .2).length).toBeGreaterThan(0);
  // A panel seen from behind never shows its photo: the hit target at its centre is never its image.
  const mirrored = await page.evaluate((list) => list.filter((panel) => panel.depth < -.25).flatMap((panel) => {
    const element = document.querySelector<HTMLElement>(`[data-globe-panel][data-key="${panel.key}"]`)!;
    const image = element.querySelector('img');
    if (!image) return [];
    const r = image.getBoundingClientRect();
    if (!r.width) return [];
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit === image ? [panel.key] : [];
  }), after);
  expect(mirrored).toEqual([]);
  expect(await page.locator('[data-globe-panel] .gp-front').first().evaluate((face) => getComputedStyle(face).backfaceVisibility)).toBe('hidden');
});

test('globo: la inercia continúa brevemente y se detiene sola', async ({ page }) => {
  await open(page, 'no-preference');
  await stage(page).scrollIntoViewIfNeeded();
  await stage(page).hover(); // pauses the idle drift
  const box = (await stage(page).boundingBox())!;
  await page.mouse.move(box.x + box.width * .3, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .7, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  const released = await rotation(page);
  await page.waitForTimeout(150);
  expect(angleBetween(released, await rotation(page))).toBeGreaterThan(.5);
  // It slows down and stops by itself (headless frames can be sparse: wait for stillness).
  let last = await rotation(page);
  await expect.poll(async () => {
    await page.waitForTimeout(300);
    const now = await rotation(page);
    const moved = angleBetween(last, now);
    last = now;
    return moved;
  }, { timeout: 8_000 }).toBeLessThan(.01);
  const settled = await rotation(page);
  await page.waitForTimeout(600);
  expect(angleBetween(settled, await rotation(page))).toBeLessThan(.01);
});

test('globo: cada especialidad gira hacia su región y destaca su foto; el globo sigue completo', async ({ page }) => {
  await open(page);
  const count = await page.locator('[data-globe-panel]').count();
  for (const id of ['unas-pedicura', 'cejas', 'facial', 'peluqueria', 'barberia']) {
    await specialtyButton(page, FEATURED[id]![0]).click();
    await expectSpecialty(page, id);
    await expectFacing(page, FEATURED[id]![1]);
    await expect(page.locator('[data-globe-panel]')).toHaveCount(count);
    // The featured photo is at the centre of the globe, in front of everything else.
    const center = await featuredPanel(page).evaluate((panel) => { const r = panel.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    const box = (await stage(page).boundingBox())!;
    expect(Math.abs(center[0]! - (box.x + box.width / 2))).toBeLessThan(box.width * .08);
  }
  // Peluquería now has real works: its photo leads, with the real editorial copy.
  await specialtyButton(page, 'Peluquería').click();
  await expect(slot(page, 'caption')).toHaveText('Rubio con ondas');
  await expect(slot(page, 'message')).toContainText('Rubios, ondas o un liso');
  await expect(slot(page, 'works')).toHaveAttribute('data-showcase-link', 'peluqueria');
  await expect(page.locator('[data-globe-zoom]')).toBeVisible();
  await expect(page.locator('[data-globe-panel][data-kind="emblem"]')).toHaveCount(0);
  await expect(page.locator('[data-globe-panel][data-kind="photo"]')).toHaveCount(19);
});

test('globo: clic en una foto la destaca y sincroniza la especialidad; segundo clic la amplía', async ({ page }) => {
  await open(page);
  // Turn so the nails region faces the visitor, then pick a nail photo that is not featured.
  await specialtyButton(page, 'Uñas y pedicura').click();
  await expectSpecialty(page, 'unas-pedicura');
  await specialtyButton(page, 'Cejas').click();
  await page.locator('[data-globe-panel][data-key="cejas-definidas"]').click();
  await expect(lightbox(page)).toHaveAttribute('open', '');
  await page.keyboard.press('Escape');
  await expect(stage(page)).toBeFocused();
  // Rotate to the nails region by drag, then click a nails photo: it selects Uñas.
  await specialtyButton(page, 'Uñas y pedicura').click();
  const front = (await depths(page)).filter((panel) => panel.kind === 'photo' && panel.key !== 'unas-flores' && panel.depth > .5);
  const target = front.find((panel) => panel.key.startsWith('unas')) ?? front[0]!;
  await page.locator(`[data-globe-panel][data-key="${target.key}"] img`).click({ force: true });
  await expect(featuredPanel(page)).toHaveAttribute('data-key', target.key);
  await expectFacing(page, target.key);
  if (target.key.startsWith('unas')) await expect(page.locator('[data-specialty-row="unas-pedicura"]')).toHaveAttribute('data-active', '');
  await expect(lightbox(page)).not.toHaveAttribute('open', '');
  await featuredPanel(page).locator('img').click({ force: true });
  await expect(lightbox(page)).toHaveAttribute('open', '');
  await expect(lightbox(page).locator('img')).toHaveAttribute('alt', (await featuredPanel(page).locator('img').getAttribute('alt'))!);
  await page.keyboard.press('Escape');
  // A drag that starts on a photo is a rotation, not a click.
  const held = await rotation(page);
  const box = (await featuredPanel(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  expect(angleBetween(held, await rotation(page))).toBeGreaterThan(5);
  await expect(lightbox(page)).not.toHaveAttribute('open', '');
});

test('globo: una foto del espacio no cambia la especialidad elegida', async ({ page }) => {
  await open(page);
  await specialtyButton(page, 'Cejas').click();
  await page.locator('[data-globe-panel][data-key="manicura"] img').evaluate((image) => (image as HTMLElement).click());
  await expect(featuredPanel(page)).toHaveAttribute('data-key', 'manicura');
  await expectFacing(page, 'manicura');
  await expect(page.locator('[data-specialty-row="cejas"]')).toHaveAttribute('data-active', '');
  await expect(slot(page, 'caption')).toHaveText(/^El espacio · Manicura/);
});

test('globo: teclado y controles accesibles giran, inclinan y amplían', async ({ page }) => {
  await open(page);
  await stage(page).focus();
  const before = await rotation(page);
  const vectors = await worldVectors(page);
  await page.keyboard.press('ArrowRight');
  expect(angleBetween(before, await rotation(page))).toBeCloseTo(24, 0);
  expect(axisShift(vectors, await worldVectors(page), 1)).toBeLessThan(.01);
  await page.keyboard.press('ArrowUp');
  await page.getByRole('button', { name: 'Inclinar hacia abajo' }).click();
  await page.getByRole('button', { name: 'Girar a la izquierda' }).click();
  expect(angleBetween(before, await rotation(page))).toBeLessThan(1);
  await stage(page).focus();
  await page.keyboard.press('Enter');
  await expect(lightbox(page)).toHaveAttribute('open', '');
  await page.keyboard.press('Escape');
  await page.locator('[data-globe-zoom]').click();
  await expect(lightbox(page)).toHaveAttribute('open', '');
  await page.keyboard.press('Escape');
  await specialtyButton(page, 'Barbería y barba').focus();
  await page.keyboard.press('End');
  await expectSpecialty(page, 'facial');
  await expect(page.locator('[data-specialty-status]')).toContainText('Cuidado facial.');
});

test('globo: cambios rápidos y repetidos de especialidad terminan coherentes', async ({ page }) => {
  await open(page, 'no-preference');
  await stage(page).scrollIntoViewIfNeeded();
  for (const name of ['Cejas', 'Uñas y pedicura', 'Peluquería', 'Cuidado facial', 'Cejas', 'Barbería y barba', 'Uñas y pedicura', 'Cejas']) await specialtyButton(page, name).click({ delay: 0 });
  await expectSpecialty(page, 'cejas');
  await expectFacing(page, 'cejas-definidas');
  await drag(page, 80, 0);
  await specialtyButton(page, 'Cuidado facial').click();
  await expectSpecialty(page, 'facial');
  await expectFacing(page, 'facial-proceso');
});

test('globo: giro en reposo lento, se detiene al interactuar; nunca con movimiento reducido', async ({ page }) => {
  test.setTimeout(40_000);
  await open(page, 'no-preference');
  await stage(page).scrollIntoViewIfNeeded();
  await page.mouse.move(5, 5);
  await page.waitForTimeout(6_500);
  const a = await rotation(page);
  await page.waitForTimeout(1_000);
  const speed = angleBetween(a, await rotation(page));
  expect(speed).toBeGreaterThan(1);
  expect(speed).toBeLessThan(8); // very slow: a few degrees per second
  await stage(page).hover();
  await page.waitForTimeout(200);
  const c = await rotation(page);
  await page.waitForTimeout(800);
  expect(angleBetween(c, await rotation(page))).toBeLessThan(.01);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.mouse.move(5, 5);
  await page.waitForTimeout(6_500);
  const d = await rotation(page);
  await page.waitForTimeout(800);
  expect(angleBetween(d, await rotation(page))).toBeLessThan(.01);
});

test('movimiento reducido: selección inmediata, sin animaciones; corona sin animar', async ({ page }) => {
  await open(page);
  await specialtyButton(page, 'Cejas').click();
  await expectSpecialty(page, 'cejas');
  expect((await depths(page)).find((panel) => panel.key === 'cejas-definidas')!.depth).toBeGreaterThan(.97);
  await page.getByRole('tab', { name: /^Uñas/ }).click();
  await page.getByRole('button', { name: 'Trabajo siguiente' }).click();
  expect(await page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === 'running').length)).toBe(0);
});

test('móvil: globo liviano, giro táctil en ambos ejes dentro del globo y scroll fuera de él', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  try {
    const page = await context.newPage();
    await page.addInitScript(() => sessionStorage.setItem('luxe:intro:seen:v1', '1'));
    await page.goto('http://localhost:4321/');
    await expect(page.locator('luxe-specialties[data-ready]')).toHaveCount(1);
    await expect(page.locator('[data-specialty-list]')).toHaveAttribute('data-more', '');
    // Fewer pieces on phones: decorative facets and inner plates are not rendered.
    expect(await page.locator('[data-globe-panel][data-filler]').evaluateAll((items) => items.every((item) => getComputedStyle(item).display === 'none'))).toBe(true);
    await expect(page.locator('[data-globe-panel][data-kind="photo"]:visible')).toHaveCount(19);
    await expect(page.locator('[data-globe-panel][data-kind="video"]:visible')).toHaveCount(2);
    const strip = (await page.locator('[data-specialty-index]').boundingBox())!;
    const globeBox = (await stage(page).boundingBox())!;
    expect(globeBox.y - (strip.y + strip.height)).toBeLessThan(48);
    expect(globeBox.x).toBeGreaterThanOrEqual(0);
    expect(globeBox.x + globeBox.width).toBeLessThanOrEqual(390);
    // A finger on the globe belongs to the world (no panning; two fingers may still zoom);
    // the copy under it scrolls the page as usual. Real touch gestures: tests/e2e/tactil.spec.ts.
    expect(await stage(page).evaluate((element) => getComputedStyle(element).touchAction)).toBe('pinch-zoom');
    expect(await page.locator('.globe-copy').evaluate((element) => getComputedStyle(element).touchAction)).toBe('auto');
    // Pointer streams on the globe follow the finger in both axes.
    const touch = (dx: number, dy: number) => stage(page).evaluate((element, [dx, dy]) => {
      const r = element.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const fire = (type: string, px: number, py: number) => element.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: px, clientY: py, bubbles: true }));
      fire('pointerdown', x, y);
      for (let i = 1; i <= 6; i++) fire('pointermove', x + dx * i / 6, y + dy * i / 6);
      fire('pointerup', x + dx, y + dy);
    }, [dx, dy] as const);
    const before = await worldVectors(page);
    await touch(4, 90);
    const vertical = await worldVectors(page);
    expect(axisShift(before, vertical, 1)).toBeGreaterThan(.2);
    await touch(110, 8);
    expect(axisShift(vertical, await worldVectors(page), 0)).toBeGreaterThan(.2);
    await page.locator('[data-specialty-row="unas-pedicura"]').tap();
    await expectSpecialty(page, 'unas-pedicura');
    await expect(page.getByRole('button', { name: 'Girar a la derecha' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  } finally { await context.close(); }
});

// ——— Nuestro trabajo: corona ———
const crownFront = (page: Page) => page.locator('#trabajos [data-orbit-card][data-front]');
const crownVisible = (page: Page) => page.locator('#trabajos [data-orbit-card]:not([data-off])');
const counter = (page: Page) => page.locator('[data-slot="counter"]');
const tab = (page: Page, name: string) => page.locator('#trabajos').getByRole('tab', { name: new RegExp(`^${name}`) });

test('corona: filtros reales, solo trabajos de la categoría, contador y CTA', async ({ page }) => {
  await open(page);
  await expect(page.getByRole('tablist', { name: 'Especialidades' }).getByRole('tab')).toHaveText([/^Todos/, /^Cortes y barbería/, /^Peluquería/, /^Uñas/, /^Cejas/, /^Faciales/]);
  await expect(crownVisible(page)).toHaveCount(23);
  await expect(counter(page)).toHaveText('01 / 23');
  await expect(tab(page, 'Todos').locator('.tab-count')).toHaveText('23');
  for (const [name, category, count] of [['Cortes y barbería', 'cortes', 8], ['Peluquería', 'peluqueria', 3], ['Uñas', 'unas', 9], ['Cejas', 'cejas', 1], ['Faciales', 'faciales', 2], ['Todos', '', 23]] as const) {
    await expect(tab(page, name).locator('.tab-count')).toHaveText(String(count).padStart(2, '0'));
    await tab(page, name).click();
    await expect(crownVisible(page)).toHaveCount(count);
    if (category) expect(new Set(await crownVisible(page).evaluateAll((cards) => cards.map((card) => (card as HTMLElement).dataset.category)))).toEqual(new Set([category]));
    await expect(counter(page)).toHaveText(`01 / ${String(count).padStart(2, '0')}`);
    await expect(page.locator('#trabajos .showcase-cta')).toHaveAttribute('href', LINKS.booking);
  }
});

test('corona: flechas avanzan, la foto central, el texto y el contador cambian juntos', async ({ page }) => {
  await open(page);
  await tab(page, 'Cortes y barbería').click();
  const next = page.getByRole('button', { name: 'Trabajo siguiente' });
  for (let index = 2; index <= 9; index++) {
    await next.click();
    const shown = ((index - 1) % 8) + 1;
    await expect(counter(page)).toHaveText(`0${shown} / 08`);
    await expect(page.locator('[data-slot="title"]')).toHaveText((await crownFront(page).getAttribute('data-title'))!);
    await expect(page.locator('[data-slot="cta"]')).toHaveText('Reservar mi corte');
  }
  await page.getByRole('button', { name: 'Trabajo anterior' }).click();
  await expect(counter(page)).toHaveText('08 / 08');
});

test('corona: una sola fotografía no simula rotación', async ({ page }) => {
  await open(page);
  await tab(page, 'Cejas').click();
  await expect(crownVisible(page)).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Trabajo siguiente' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Trabajo anterior' })).toBeDisabled();
  await expect(crownFront(page)).toHaveAttribute('data-id', 'cejas-definidas');
  const transform = await crownFront(page).evaluate((card) => (card as HTMLElement).style.transform);
  expect(transform).toContain('rotateY(0deg)');
});

test('corona: arrastre y deslizamiento cambian de trabajo; las fotos no se deforman', async ({ page }) => {
  await open(page);
  const stage = page.locator('#trabajos [data-stage]');
  await stage.scrollIntoViewIfNeeded();
  const box = (await stage.boundingBox())!;
  await page.mouse.move(box.x + box.width * .7, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .3, box.y + box.height / 2, { steps: 10 });
  await page.waitForTimeout(150);
  await page.mouse.up();
  await expect(counter(page)).not.toHaveText('01 / 23');
  for (const card of await crownVisible(page).all()) {
    const ratio = await card.evaluate((element) => {
      const image = element.querySelector('img')!;
      const frame = element.getBoundingClientRect();
      return { natural: image.naturalWidth / image.naturalHeight, frame: (element as HTMLElement).offsetWidth / (element as HTMLElement).offsetHeight, ok: frame.width > 0 };
    });
    if (ratio.natural) expect(Math.abs(ratio.natural - ratio.frame)).toBeLessThan(.02);
  }
});

test('corona + visor: clic en la foto central, navegación, foco atrapado y Escape', async ({ page }) => {
  await open(page);
  await tab(page, 'Uñas').click();
  await crownFront(page).click();
  await expect(lightbox(page)).toHaveAttribute('open', '');
  await expect(lightbox(page).locator('[data-lightbox-counter]')).toHaveText('01 / 09');
  await page.keyboard.press('ArrowRight');
  await expect(lightbox(page).locator('[data-lightbox-counter]')).toHaveText('02 / 09');
  await lightbox(page).getByRole('button', { name: 'Fotografía siguiente' }).click();
  await expect(lightbox(page).locator('[data-lightbox-counter]')).toHaveText('03 / 09');
  for (let index = 0; index < 6; index++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('dialog.lightbox')))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(lightbox(page)).not.toHaveAttribute('open', '');
  await expect(page.locator('#trabajos [data-stage]')).toBeFocused();
});

test('“Ver trabajos” de especialidades abre la categoría en la corona', async ({ page }) => {
  await open(page);
  await page.locator('#service-unas-pedicura .service-link').click();
  await expect(tab(page, 'Uñas')).toHaveAttribute('aria-selected', 'true');
  await expect(crownVisible(page)).toHaveCount(9);
});

// ——— Nuestro espacio ———
const tourTab = (page: Page, name: RegExp) => page.locator('#espacio').getByRole('tab', { name });
const tourVisible = (page: Page) => page.locator('[data-tour-view]:not([hidden])');

test('espacio: recorrido con las fotos nuevas, sin saltos de altura ni recortes', async ({ page }) => {
  await open(page);
  const tabs = page.locator('#espacio [role="tab"]');
  await expect(tabs).toHaveCount(5);
  await expect(tabs).toHaveText([/Barbería.*Estaciones/, /Barbería.*Otra perspectiva/, /Peluquería/, /Manicura/, /Sala de espera/]);
  const stage = page.locator('[data-tour-stage]');
  await stage.scrollIntoViewIfNeeded();
  const height = (await stage.boundingBox())!.height;
  for (const [name, alt] of [[/Otra perspectiva/, /barbería vista de frente/], [/Manicura/, /área de manicura/]] as const) {
    await tourTab(page, name).click();
    await expect(tourTab(page, name)).toHaveAttribute('aria-selected', 'true');
    await expect(tourVisible(page)).toHaveCount(1);
    await expect(tourVisible(page).locator('img')).toHaveAttribute('alt', alt);
    await expect.poll(() => tourVisible(page).locator('img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    await expect(tourVisible(page).locator('img')).toHaveCSS('object-fit', 'contain');
    expect((await stage.boundingBox())!.height).toBe(height);
  }
  await expect(page.locator('[data-tour-slot="title"]')).toHaveText('Área de manicura');
  await expect(page.locator('[data-tour-counter]')).toHaveText('04 / 05');
});

test('espacio: flechas, teclado y visor con todos los ambientes', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Ambiente siguiente' }).click();
  await expect(tourTab(page, /Otra perspectiva/)).toHaveAttribute('aria-selected', 'true');
  await tourTab(page, /Otra perspectiva/).focus();
  await page.keyboard.press('ArrowRight');
  await expect(tourTab(page, /Peluquería/)).toBeFocused();
  await expect(tourTab(page, /Peluquería/)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  await expect(tourTab(page, /Sala de espera/)).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Ambiente siguiente' }).click();
  await expect(tourTab(page, /Estaciones/)).toHaveAttribute('aria-selected', 'true');
  await page.locator('[data-tour-zoom]').click();
  await expect(lightbox(page)).toHaveAttribute('open', '');
  await expect(lightbox(page).locator('[data-lightbox-counter]')).toHaveText('01 / 05');
  await lightbox(page).getByRole('button', { name: 'Cerrar visor' }).click();
  await expect(page.locator('[data-tour-zoom]')).toBeFocused();
});

// ——— Ubicación: fachada, horario y Waze ———
test('ubicación: fachada completa, dirección, Waze exacto y Maps como alternativa', async ({ page }) => {
  await open(page);
  const facade = page.locator('.visit-facade img');
  await facade.scrollIntoViewIfNeeded();
  await expect(facade).toHaveAttribute('alt', /fachada de noche/);
  await expect.poll(() => facade.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  // Rendered at its own 16:9 proportion: the LUXE signs are never cropped.
  const ratio = await facade.evaluate((image: HTMLImageElement) => ({ natural: image.naturalWidth / image.naturalHeight, box: image.clientWidth / image.clientHeight }));
  expect(Math.abs(ratio.natural - ratio.box)).toBeLessThan(.01);
  await expect(page.locator('#ubicacion address')).toHaveText(/Concepción, La Unión\s*Cartago, Costa Rica/);
  const waze = page.locator('#ubicacion').getByRole('link', { name: /Cómo llegar con Waze/ });
  await expect(waze).toHaveAttribute('href', LINKS.waze);
  await expect(waze).toHaveAttribute('target', '_blank');
  await expect(waze).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(page.locator('#ubicacion').getByRole('link', { name: /Google Maps/ })).toHaveAttribute('href', LINKS.maps);
  for (const [name, href] of [[/Reservar cita/, LINKS.booking], [/WhatsApp/, LINKS.whatsapp], [/Instagram/, LINKS.instagram]] as const) {
    await expect(page.locator('#ubicacion').getByRole('link', { name })).toHaveAttribute('href', href);
  }
  await page.locator('[data-zoom-trigger]').click();
  await expect(lightbox(page)).toHaveAttribute('open', '');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-zoom-trigger]')).toBeFocused();
});

test.describe('horario en hora de Costa Rica desde otra zona horaria', () => {
  test.use({ timezoneId: 'Asia/Tokyo' });
  const at = async (page: Page, iso: string) => {
    await page.clock.setFixedTime(new Date(iso));
    await open(page);
    await page.locator('luxe-hours').scrollIntoViewIfNeeded();
  };
  test('lunes 10:00 (CR): abierto, cierra a las 7:00 p. m.; panel expandible con hoy marcado', async ({ page }) => {
    await at(page, '2026-11-02T16:00:00Z');
    await expect(page.locator('[data-hours-state]')).toHaveText('Abierto ahora');
    await expect(page.locator('[data-hours-detail]')).toHaveText('Cierra a las 7:00 p. m.');
    const summary = page.locator('.hours-summary');
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-hours-panel]')).toHaveAttribute('open', '');
    await expect(page.locator('.hours-table tr')).toHaveText([/Lunes.*9:00 a\. m\. – 7:00 p\. m\./, /Martes/, /Miércoles/, /Jueves/, /Viernes/, /Sábado/, /Domingo.*Cerrado/]);
    await expect(page.locator('.hours-table tr[data-today]')).toHaveText(/Lunes/);
  });
  test('lunes 19:00 (CR, ya martes en Tokio): cerrado, abre mañana', async ({ page }) => {
    await at(page, '2026-11-03T01:00:00Z');
    await expect(page.locator('[data-hours-state]')).toHaveText('Cerrado ahora');
    await expect(page.locator('[data-hours-detail]')).toHaveText('Abre mañana a las 9:00 a. m.');
    await expect(page.locator('.hours-table tr[data-today]')).toHaveText(/Lunes/);
  });
  test('sábado 19:30 (CR): cerrado, abre el lunes; domingo: abre mañana', async ({ page }) => {
    await at(page, '2026-11-08T01:30:00Z');
    await expect(page.locator('[data-hours-detail]')).toHaveText('Abre el lunes a las 9:00 a. m.');
    await page.clock.setFixedTime(new Date('2026-11-08T18:00:00Z'));
    await page.reload();
    await expect(page.locator('[data-hours-state]')).toHaveText('Cerrado ahora');
    await expect(page.locator('[data-hours-detail]')).toHaveText('Abre mañana a las 9:00 a. m.');
    await expect(page.locator('.hours-table tr[data-today]')).toHaveText(/Domingo/);
  });
});

// ——— Dock flotante ———
const dock = (page: Page) => page.getByRole('navigation', { name: 'Acciones rápidas' });

async function expectDockUsable(page: Page, width: number, height: number, label: string) {
  await expect(dock(page), label).toBeVisible();
  const box = (await dock(page).boundingBox())!;
  expect(box.x, label).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, label).toBeLessThanOrEqual(width);
  expect(box.y + box.height, label).toBeLessThanOrEqual(height + 1);
  // Nothing paints over it: each action is the top element at its own centre.
  const reachable = await dock(page).locator('a').evaluateAll((links) => links.map((link) => {
    const r = link.getBoundingClientRect();
    return link.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
  }));
  expect(reachable, label).toEqual([true, true, true]);
}

/** Visible controls and text blocks of the page that intersect the dock's box. */
const coveredByDock = (page: Page) => page.evaluate(() => {
  const d = document.querySelector('[data-action-dock]')!.getBoundingClientRect();
  return [...document.querySelectorAll<HTMLElement>('main a, main button, main [role="tab"], main h2, main h3, main p, footer a, footer p:not([aria-hidden])')]
    .filter((element) => {
      if (element.closest('[data-action-dock]') || element.closest('.sr-only')) return false;
      const r = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      // 1 px tolerance: a fractional page height leaves sub-pixel rounding at the very end.
      return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && r.right > d.left && r.left < d.right && r.bottom > d.top + 1 && r.top < d.bottom;
    }).map((element) => element.textContent?.trim().slice(0, 40));
});

for (const viewport of [{ width: 1280, height: 800 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
  test(`dock a ${viewport.width}px: riel en el margen lateral, nunca sobre contenido ni controles`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    await open(page);
    const total = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y <= total; y += Math.round(viewport.height * .5)) {
      await page.evaluate((top) => window.scrollTo(0, top), y);
      await frames(page);
      await expectDockUsable(page, viewport.width, viewport.height, `scroll ${y}`);
      expect(await coveredByDock(page), `scroll ${y}`).toEqual([]);
    }
    // Interacting with the galleries never moves it into the content.
    await specialtyButton(page, 'Cejas').click();
    await tab(page, 'Uñas').click();
    expect(await coveredByDock(page)).toEqual([]);
  });
}

for (const viewport of [{ width: 320, height: 640 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }]) {
  test(`dock a ${viewport.width}px: barra inferior opaca; ningún control enfocado queda debajo`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    await open(page);
    await expect(dock(page).getByRole('link', { name: /Reservar/ })).toHaveAttribute('href', LINKS.booking);
    await expect(dock(page).getByRole('link', { name: 'Escribinos por WhatsApp' })).toHaveAttribute('href', LINKS.whatsapp);
    await expect(dock(page).getByRole('link', { name: 'Instagram de LUXE' })).toHaveAttribute('href', LINKS.instagram);
    for (const anchor of await dock(page).locator('a').all()) {
      const target = (await anchor.boundingBox())!;
      expect(Math.min(target.width, target.height)).toBeGreaterThanOrEqual(44);
    }
    // A full-width opaque bar at the bottom edge: content ends above it, never peeks around it.
    const box = (await dock(page).boundingBox())!;
    expect(Math.round(box.x)).toBe(0);
    expect(Math.round(box.width)).toBe(viewport.width);
    expect(Math.round(box.y + box.height)).toBe(viewport.height);
    expect(await dock(page).evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgb(11, 42, 34)');
    const total = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y <= total; y += Math.round(viewport.height * .6)) {
      await page.evaluate((top) => window.scrollTo(0, top), y);
      await frames(page);
      await expectDockUsable(page, viewport.width, viewport.height, `scroll ${y}`);
    }
    // Keyboard: every control in the page, once focused, is scrolled clear of the bar.
    await page.evaluate(() => window.scrollTo(0, 0));
    const hidden: string[] = [];
    for (let step = 0; step < 70; step++) {
      await page.keyboard.press('Tab');
      const result = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null;
        if (!element || element === document.body || element.closest('[data-action-dock]') || element.closest('dialog')) return null;
        const r = element.getBoundingClientRect();
        const bar = document.querySelector('[data-action-dock]')!.getBoundingClientRect();
        return r.bottom > bar.top + 1 && r.top < bar.bottom ? (element.textContent?.trim().slice(0, 30) || element.tagName) : '';
      });
      if (result) hidden.push(result);
    }
    expect(hidden).toEqual([]);
    // At the very end the reserved space keeps the footer clear of the bar.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await frames(page);
    expect(await coveredByDock(page)).toEqual([]);
  });
}

test('dock: permanece al interactuar con galerías y visor; existe sin JavaScript', async ({ page, browser }) => {
  await open(page, 'no-preference');
  await specialtyButton(page, 'Cejas').click();
  await expectDockUsable(page, 1440, 1000, 'tras elegir especialidad');
  await tab(page, 'Uñas').click();
  await page.getByRole('button', { name: 'Trabajo siguiente' }).click();
  await expectDockUsable(page, 1440, 1000, 'tras usar la corona');
  await crownFront(page).click();
  await expect(lightbox(page)).toHaveAttribute('open', '');
  await page.keyboard.press('Escape');
  await expectDockUsable(page, 1440, 1000, 'tras cerrar el visor');
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const noJs = await context.newPage();
    await noJs.goto('http://localhost:4321/');
    await expect(noJs.getByRole('navigation', { name: 'Acciones rápidas' })).toBeVisible();
  } finally { await context.close(); }
});

// ——— Sin JavaScript, responsive, reflow y consola ———
test('sin JavaScript: contenido completo, primera foto de cada galería y sin controles inertes', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto('http://localhost:4321/');
    await expect(page.locator('.service-row h3')).toHaveText(['Barbería y barba', 'Peluquería', 'Uñas y pedicura', 'Cejas', 'Cuidado facial']);
    // Without JS the globe is still a static 3D sphere of real photos and the clips' posters.
    await expect(page.locator('[data-globe-panel][data-kind="photo"]')).toHaveCount(19);
    await expect(page.locator('[data-globe-panel][data-kind="video"] noscript')).toHaveCount(2);
    await expect(page.locator('[data-specialty-slot="name"]')).toHaveText('El cuidado se siente en cada detalle.');
    expect(await page.locator('[data-globe-rotor]').evaluate((rotor) => getComputedStyle(rotor).transformStyle)).toBe('preserve-3d');
    await expect(page.locator('#trabajos [data-orbit-card]:visible')).toHaveCount(1);
    await expect(page.locator('[data-tour-view]:visible')).toHaveCount(1);
    await expect(page.locator('[data-hours-state]')).toHaveText('Lunes a sábado: 9:00 a. m. – 7:00 p. m.');
    for (const selector of ['[data-globe-controls]', '[data-nav]', '[data-tour-nav]', '[data-tour-zoom]', '[data-zoom-trigger]', '[data-zoom]', '[role="tablist"]']) {
      await expect(page.locator(selector).first()).toBeHidden();
    }
  } finally { await context.close(); }
});

for (const width of [320, 360, 390, 768, 1024, 1440, 1920]) {
  test(`recorrido a ${width}px: sin overflow, sin errores y controles dentro del ancho`, async ({ page }) => {
    test.setTimeout(60_000);
    const problems: string[] = [];
    page.on('pageerror', (error) => problems.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') problems.push(message.text()); });
    page.on('response', (response) => { if (response.status() >= 400) problems.push(`${response.status()} ${response.url()}`); });
    await page.setViewportSize({ width, height: width < 768 ? 800 : 900 });
    await open(page, 'no-preference');
    const total = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < total; y += 600) { await page.evaluate((top) => window.scrollTo(0, top), y); await frames(page); }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const controls: Locator[] = [
      page.locator('.signature-cta'), page.getByRole('button', { name: 'Girar a la derecha' }), page.locator('.showcase-cta'),
      page.getByRole('button', { name: 'Trabajo siguiente' }), page.getByRole('button', { name: 'Ambiente siguiente' }),
      page.locator('#ubicacion').getByRole('link', { name: /Cómo llegar con Waze/ }), page.locator('.hours-summary'),
    ];
    for (const control of controls) {
      await control.scrollIntoViewIfNeeded();
      const box = (await control.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    // The globe set and the crown stay inside the viewport.
    for (const stage of ['#specialty-panel', '#trabajos [data-stage]']) {
      const box = (await page.locator(stage).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(-1);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    }
    expect(problems).toEqual([]);
  });
}

test('reflow al 200 % (1440 × 900 → 720 × 450): todo operable y sin desbordes', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 720, height: 450 });
  await open(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await specialtyButton(page, 'Cejas').click();
  await expectSpecialty(page, 'cejas');
  await tab(page, 'Uñas').click();
  await page.getByRole('button', { name: 'Trabajo siguiente' }).click();
  await expect(counter(page)).toHaveText('02 / 09');
  await tourTab(page, /Manicura/).click();
  await expect(tourVisible(page)).toHaveCount(1);
  await expect(tourVisible(page).locator('img')).toHaveAttribute('alt', /área de manicura/);
  await expectDockUsable(page, 720, 450, 'reflow');
});

// ——— Build público (medios de demostración; ninguna fotografía privada) ———
// The empty states of a build without approved media are covered by the unit tests
// (tests/media.test.ts, globe.test.ts, showcase.test.ts, orbit.test.ts).
test.describe('build público: medios de demostración, con horario, Waze y dock', () => {
  let server: Server;
  let origin: string;
  test.beforeAll(async () => {
    const root = resolve('dist', 'client');
    server = createServer(async (request, response) => {
      const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
      const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!file.startsWith(root + sep)) { response.writeHead(403).end(); return; }
      try {
        const content = await readFile(file);
        const mime: Record<string, string> = {
          '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml',
          '.webp': 'image/webp', '.avif': 'image/avif', '.jpg': 'image/jpeg', '.png': 'image/png', '.ico': 'image/x-icon', '.webm': 'video/webm',
        };
        response.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' }).end(content);
      } catch { response.writeHead(404).end(); }
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server address');
    origin = `http://127.0.0.1:${address.port}`;
  });
  test.afterAll(async () => { await new Promise<void>((done, fail) => server.close((error) => error ? fail(error) : done())); });

  test('globo con medios demo, aviso de demostración, horario dinámico, Waze y dock', async ({ page }) => {
    const images: string[] = [];
    const errors: string[] = [];
    page.on('request', (request) => { if (['image', 'media'].includes(request.resourceType())) images.push(request.url()); });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(origin);
    await expect(page.locator('luxe-specialties[data-ready]')).toHaveCount(1);
    // Every specialty has demo media, so no emblem stands in for a missing photo.
    await expect(page.locator('[data-globe-panel][data-kind="emblem"]')).toHaveCount(0);
    expect(await page.locator('[data-globe-panel]').count()).toBeGreaterThanOrEqual(26);
    await page.locator('#servicios').getByRole('button', { name: 'Peluquería', exact: true }).click();
    await expect(page.locator('[data-globe-panel][data-featured]')).toHaveAttribute('data-key', 'peluqueria-rubio-ondas');
    await expect(page.locator('[data-specialty-slot="name"]')).toHaveText('Peluquería');
    await expect(page.locator('dialog.lightbox')).toHaveCount(1);
    await expect(page.locator('[data-showcase-empty]')).toHaveCount(0);
    // The page says the images are illustrative, and every image alt says so too.
    await expect(page.locator('[data-demo-media]')).toBeVisible();
    for (const alt of await page.locator('main img[alt]:not([alt=""])').evaluateAll((items) => items.map((item) => item.getAttribute('alt')!))) {
      expect(alt).toMatch(/de demostración/);
    }
    await expect(page.locator('[data-hours-state]')).toHaveText(/^(Abierto|Cerrado) ahora$/);
    await expect(page.locator('#ubicacion').getByRole('link', { name: /Cómo llegar con Waze/ })).toHaveAttribute('href', LINKS.waze);
    await expect(page.getByRole('navigation', { name: 'Acciones rápidas' })).toBeVisible();
    const types = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((text) => JSON.parse(text)['@type']);
    expect(types).toEqual(['BeautySalon', 'WebSite']);
    // Media come only from the build itself: optimised assets and the site icons.
    expect(images.length).toBeGreaterThan(0);
    expect(images.filter((url) => !url.startsWith(`${origin}/_astro/`) && !/\/(favicon|icon-|apple-touch)/.test(url))).toEqual([]);
    expect(errors).toEqual([]);
  });
});
