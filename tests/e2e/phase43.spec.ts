import { test, expect, type Page } from '@playwright/test';

/** Fase 4.3: the space-walk empty-frame bug, the hero opening line, «Visitanos», the footer
 * and the five new works. */
const LINKS = {
  booking: 'https://www.dragocr.com/reservar/luxecentrobelleza',
  whatsapp: 'https://wa.me/50671620752',
  instagram: 'https://www.instagram.com/luxe_centrodebelleza/',
  maps: 'https://maps.app.goo.gl/z7ss3mpVHJqMxDbe6',
  waze: 'https://waze.com/ul/hd1u22w6m3',
};

async function open(page: Page, reducedMotion: 'reduce' | 'no-preference' = 'reduce') {
  await page.emulateMedia({ reducedMotion });
  await page.addInitScript(() => sessionStorage.setItem('luxe:intro:seen:v1', '1'));
  await page.goto('/');
  await expect(page.locator('luxe-space-tour[data-ready]')).toHaveCount(1);
}

// ——— «El espacio»: the photo on screen is always painted ———
const next = (page: Page) => page.getByRole('button', { name: 'Ambiente siguiente' });
const previous = (page: Page) => page.getByRole('button', { name: 'Ambiente anterior' });
/** Every visible view: index, painted opacity, loaded photo and leftover effects. Two frames
 * are awaited first: headless Chrome only advances animations when frames are produced. */
const onScreen = (page: Page) => page.evaluate(async () => {
  await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  return [...document.querySelectorAll<HTMLElement>('[data-tour-view]')]
  .filter((view) => !view.hidden && getComputedStyle(view).visibility !== 'hidden')
  .map((view) => {
    const image = view.querySelector('img')!;
    return { index: Number(view.dataset.tourView), opacity: Number(getComputedStyle(view).opacity), loaded: image.complete && image.naturalWidth > 0, failed: view.hasAttribute('data-failed'), effects: view.getAnimations().length };
  });
});
/** After the dust settles: exactly the selected view, opaque, painted, with no effects left. */
async function expectSettled(page: Page, index: number) {
  // Generous: in dev, Astro transforms the 1–2 MB interior PNGs on first request.
  await expect.poll(async () => JSON.stringify(await onScreen(page)), { timeout: 20_000 })
    .toBe(JSON.stringify([{ index, opacity: 1, loaded: true, failed: false, effects: 0 }]));
  await expect(page.locator('[data-tour-counter]')).toHaveText(`0${index + 1} / 05`);
}

test('espacio: volver a una vista ya visitada la muestra completa (causa del rectángulo vacío)', async ({ page }) => {
  test.setTimeout(90_000);
  await open(page, 'no-preference');
  await page.locator('#espacio .tour').scrollIntoViewIfNeeded();
  await next(page).click();
  await expectSettled(page, 1);
  await previous(page).click();
  // Before the fix this view kept a finished "fade out" effect and ended at opacity 0.
  await expectSettled(page, 0);
  await page.waitForTimeout(800);
  await expectSettled(page, 0);
  for (const index of [2, 0, 2, 4, 2]) {
    await page.locator('#espacio').getByRole('tab').nth(index).click();
    await expectSettled(page, index);
  }
});

test('espacio: elegir otra vista en plena transición no deja el marco vacío (segunda causa)', async ({ page }) => {
  test.setTimeout(90_000);
  await open(page, 'no-preference');
  await page.locator('#espacio .tour').scrollIntoViewIfNeeded();
  const tabs = page.locator('#espacio').getByRole('tab');
  // Warm two views, then switch between them while the crossfade is still running.
  await tabs.nth(2).click();
  await expectSettled(page, 2);
  await tabs.nth(4).click();
  await expectSettled(page, 4);
  for (let round = 0; round < 4; round++) {
    await tabs.nth(2).click();
    await page.waitForTimeout(120 + round * 60);
    await tabs.nth(4).click();
    await page.waitForTimeout(90);
    expect((await onScreen(page)).some((view) => view.opacity > .05)).toBe(true);
  }
  await tabs.nth(2).click();
  await expectSettled(page, 2);
});

test('espacio: siguiente/anterior repetidos y muy rápidos nunca dejan el marco vacío', async ({ page }) => {
  await open(page, 'no-preference');
  await page.locator('#espacio .tour').scrollIntoViewIfNeeded();
  for (let round = 0; round < 3; round++) {
    for (let step = 0; step < 6; step++) await next(page).click({ delay: 0 });
    for (let step = 0; step < 4; step++) await previous(page).click({ delay: 0 });
    // At every moment at least one painted, visible photo.
    const now = await onScreen(page);
    expect(now.some((view) => view.loaded && view.opacity > .05)).toBe(true);
  }
  // 3 × (+6 −4) = +6 → view 1 of 5.
  await expectSettled(page, 1);
});

test('espacio: con red lenta la foto anterior sigue visible hasta que la nueva está lista', async ({ page }) => {
  // Long enough to outlast the limited preloading of neighbours (which starts when the
  // section comes into view), so the guarantee is still observed deterministically.
  await page.route(/_image\?.*spaces%2F(barberia-perspectiva|salon)\.webp/, async (route) => { await new Promise((resolve) => setTimeout(resolve, 6_000)); await route.continue(); });
  await open(page, 'no-preference');
  await page.locator('#espacio .tour').scrollIntoViewIfNeeded();
  await expectSettled(page, 0);
  await next(page).click();
  // While the next photo is on its way: the previous one stays, plus a discreet loading cue.
  await page.waitForTimeout(900);
  const waiting = await onScreen(page);
  expect(waiting).toEqual([{ index: 0, opacity: 1, loaded: true, failed: false, effects: 0 }]);
  await expect(page.locator('[data-tour-stage]')).toHaveAttribute('data-loading', '');
  await expect(page.locator('[data-tour-stage]')).toHaveAttribute('aria-busy', 'true');
  // The caption already names the chosen view; the photo follows as soon as it is ready.
  await expect(page.locator('[data-tour-slot="title"]')).toHaveText('Otra perspectiva');
  await expectSettled(page, 1);
  await expect(page.locator('[data-tour-stage]')).not.toHaveAttribute('data-loading', '');
});

test('espacio: una foto que falla muestra un respaldo y se recupera con «Reintentar»', async ({ page }) => {
  let block = true;
  await page.route(/_image\?.*spaces%2Fmanicura\.webp/, (route) => (block ? route.abort() : route.continue()));
  await open(page);
  await page.locator('#espacio').getByRole('tab', { name: /Manicura/ }).click();
  const view = page.locator('[data-tour-view="3"]');
  await expect(view).toHaveAttribute('data-failed', '');
  await expect(view.getByText('No pudimos cargar esta fotografía.')).toBeVisible();
  // The rest of the walk keeps working.
  await next(page).click();
  await expectSettled(page, 4);
  await previous(page).click();
  block = false;
  await view.getByRole('button', { name: 'Reintentar' }).click();
  await expectSettled(page, 3);
});

test('espacio: cambios rápidos también en móvil', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'no-preference' });
  try {
    const page = await context.newPage();
    await page.addInitScript(() => sessionStorage.setItem('luxe:intro:seen:v1', '1'));
    await page.goto('http://localhost:4321/');
    await expect(page.locator('luxe-space-tour[data-ready]')).toHaveCount(1);
    await page.locator('#espacio .tour').scrollIntoViewIfNeeded();
    for (const index of [1, 3, 1, 0, 4, 3]) await page.locator('#espacio').getByRole('tab').nth(index).tap();
    await expectSettled(page, 3);
  } finally { await context.close(); }
});

// ——— Portada: abierto/cerrado con la misma fuente que «Visitanos» ———
test.describe('portada: indicador de apertura en hora de Costa Rica', () => {
  test.use({ timezoneId: 'Europe/Madrid' });
  const at = async (page: Page, iso: string) => { await page.clock.setFixedTime(new Date(iso)); await open(page); };
  const hero = (page: Page) => page.locator('.hero luxe-open-now');

  test('lunes 10:00 (CR): «Abierto ahora · Hasta las 7:00 p. m.», igual que «Visitanos»', async ({ page }) => {
    await at(page, '2026-11-02T16:00:00Z');
    await expect(hero(page).locator('[data-open-state]')).toHaveText('Abierto ahora');
    await expect(hero(page).locator('[data-open-detail]')).toHaveText('Hasta las 7:00 p. m.');
    await expect(hero(page)).toHaveAttribute('data-open', 'true');
    await expect(page.locator('#ubicacion [data-hours-state]')).toHaveText('Abierto ahora');
  });
  test('cierre exacto 7:00 p. m.: cerrado, abrimos mañana', async ({ page }) => {
    await at(page, '2026-11-03T01:00:00Z');
    await expect(hero(page).locator('[data-open-state]')).toHaveText('Cerrado ahora');
    await expect(hero(page).locator('[data-open-detail]')).toHaveText('Abrimos mañana a las 9:00 a. m.');
    await expect(page.locator('#ubicacion [data-hours-state]')).toHaveText('Cerrado ahora');
  });
  test('sábado después del cierre: abrimos el lunes, no el domingo', async ({ page }) => {
    await at(page, '2026-11-08T02:30:00Z');
    await expect(hero(page).locator('[data-open-detail]')).toHaveText('Abrimos el lunes a las 9:00 a. m.');
    await expect(page.locator('#ubicacion [data-hours-detail]')).toHaveText('Abre el lunes a las 9:00 a. m.');
  });
  test('apertura exacta 9:00 a. m. y actualización sin recargar', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-11-02T14:59:30Z') }); // 8:59:30 in Costa Rica
    await open(page);
    await expect(hero(page).locator('[data-open-detail]')).toHaveText('Abrimos hoy a las 9:00 a. m.');
    await page.clock.runFor(60_000);
    await expect(hero(page).locator('[data-open-state]')).toHaveText('Abierto ahora');
    await expect(page.locator('#ubicacion [data-hours-state]')).toHaveText('Abierto ahora');
  });
  test('sin JavaScript: un horario neutral y verdadero, nunca un estado congelado', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    try {
      const page = await context.newPage();
      await page.goto('http://localhost:4321/');
      await expect(page.locator('.hero luxe-open-now')).toHaveText(/Lunes a sábado\s*·\s*9:00 a\. m\. – 7:00 p\. m\./);
      await expect(page.locator('.hero luxe-open-now')).not.toHaveAttribute('data-open', /.*/);
    } finally { await context.close(); }
  });
});

test('portada: el indicador no mueve el hero ni compite con el CTA', async ({ page }) => {
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await open(page);
    const box = (await page.locator('.hero luxe-open-now').boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.height).toBeLessThan(80);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
});

// ——— «Visitanos» y footer ———
test('visitanos: fachada protagonista sin cortar el rótulo, jerarquía de acciones y enlaces reales', async ({ page }) => {
  await open(page);
  const visit = page.locator('#ubicacion');
  await visit.scrollIntoViewIfNeeded();
  await expect(visit.getByRole('heading', { level: 2 })).toHaveText(/Te esperamos\s*en Concepción\./);
  const photo = (await page.locator('.visit-facade-photo').boundingBox())!;
  const panel = (await page.locator('.visit-panel').boundingBox())!;
  expect(photo.width).toBeGreaterThan(560);
  // The right sign ends at ~93% of the photo: the panel never covers it.
  expect(panel.x >= photo.x + photo.width * .93 || panel.y >= photo.y + photo.height * .5).toBe(true);
  await expect(visit.locator('address')).toContainText('Concepción, La Unión');
  // Priority: booking first and largest, then directions, hours, contact.
  const order = await visit.locator('.visit-panel a, .visit-panel summary').evaluateAll((items) => items.map((item) => item.textContent!.replace(/\s+/g, ' ').trim()));
  expect(order.findIndex((text) => text.startsWith('Reservar cita'))).toBeLessThan(order.findIndex((text) => text.includes('Waze')));
  const book = (await visit.getByRole('link', { name: /Reservar cita/ }).boundingBox())!;
  const route = (await visit.getByRole('link', { name: /Cómo llegar con Waze/ }).boundingBox())!;
  expect(book.height).toBeGreaterThan(route.height);
  for (const [name, href] of [[/Reservar cita/, LINKS.booking], [/Cómo llegar con Waze/, LINKS.waze], [/Google Maps/, LINKS.maps], [/WhatsApp/, LINKS.whatsapp], [/Instagram/, LINKS.instagram]] as const) {
    const link = visit.getByRole('link', { name });
    await expect(link).toHaveAttribute('href', href);
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  }
  // Full schedule on demand, in the same panel.
  await visit.locator('.hours-summary').click();
  await expect(visit.locator('.hours-table tr')).toHaveCount(7);
});

test('footer: cierre de marca con reserva, columnas alineadas y enlaces válidos', async ({ page }) => {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await open(page);
    const footer = page.locator('footer');
    await footer.scrollIntoViewIfNeeded();
    await expect(footer.locator('.footer-name')).toHaveText('LUXE.');
    await expect(footer.getByRole('link', { name: /Reservar cita/ })).toHaveAttribute('href', LINKS.booking);
    for (const [name, href] of [[/Cómo llegar con Waze/, LINKS.waze], [/Google Maps/, LINKS.maps], [/WhatsApp/, LINKS.whatsapp], [/Instagram/, LINKS.instagram]] as const) {
      await expect(footer.getByRole('link', { name })).toHaveAttribute('href', href);
    }
    for (const href of await footer.locator('a[href^="#"]').evaluateAll((links) => links.map((link) => link.getAttribute('href')))) {
      expect(await page.locator(`[id="${href!.slice(1)}"]`).count()).toBe(1);
    }
    if (width >= 768) {
      const tops = await footer.locator('.footer-title').evaluateAll((titles) => titles.map((title) => Math.round(title.getBoundingClientRect().top)));
      expect(new Set(tops).size).toBe(1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
});

// ——— Fotos nuevas ———
test('fotos nuevas: en la corona con su categoría, sin deformarse, y la versión completa en el visor', async ({ page }) => {
  await open(page);
  await page.locator('#trabajos').getByRole('tab', { name: /^Peluquería/ }).click();
  const cards = page.locator('#trabajos [data-orbit-card]:not([data-off])');
  // Mundo LUXE adds a third hair work after these two.
  await expect(cards).toHaveCount(3);
  expect(await cards.evaluateAll((items) => items.map((item) => (item as HTMLElement).dataset.id).sort())).toEqual(['peluqueria-liso', 'peluqueria-rubio-ondas', 'peluqueria-rubio-texturizado']);
  for (const card of await cards.all()) {
    const image = card.locator('img');
    await image.scrollIntoViewIfNeeded();
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
    expect(await image.evaluate((element) => getComputedStyle(element).objectFit)).toBe('cover');
  }
  await page.locator('#trabajos [data-orbit-card][data-front]').click();
  await expect(page.locator('dialog.lightbox img')).toHaveAttribute('src', /peluqueria-rubio-ondas(?!-globo)/);
  await page.keyboard.press('Escape');
  // The globe shows the light variant; its lightbox the full one.
  const globePanel = page.locator('[data-globe-panel][data-key="peluqueria-rubio-ondas"]');
  await page.locator('[data-globe-stage]').scrollIntoViewIfNeeded();
  await expect(globePanel.locator('img')).toHaveAttribute('src', /peluqueria-rubio-ondas-globo/);
  await expect(globePanel).toHaveAttribute('data-full-src', /peluqueria-rubio-ondas(?!-globo)/);
  // New works are never in the space walk.
  await expect(page.locator('[data-tour-view] img[src*="trabajos-nuevos"]')).toHaveCount(0);
});
