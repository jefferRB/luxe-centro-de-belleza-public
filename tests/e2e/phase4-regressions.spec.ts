import { test, expect, type Page } from '@playwright/test';

/** Scenarios carried over from the Fase 3–3.3 suites (whose components this phase
 * replaces), re-pointed at the specialty globe, the crown and the space walk. */
const BOOKING = 'https://www.dragocr.com/reservar/luxecentrobelleza';

async function open(page: Page, reducedMotion: 'reduce' | 'no-preference' = 'reduce') {
  await page.emulateMedia({ reducedMotion });
  await page.addInitScript(() => sessionStorage.setItem('luxe:intro:seen:v1', '1'));
  await page.goto('/');
  await expect(page.locator('luxe-specialties[data-ready]')).toHaveCount(1);
  await expect(page.locator('luxe-showcase[data-ready]')).toHaveCount(1);
}
const FEATURED: Record<string, string> = { barberia: 'corte-peinado', peluqueria: 'peluqueria-rubio-ondas', 'unas-pedicura': 'unas-flores', cejas: 'cejas-definidas', facial: 'facial-proceso' };
const row = (page: Page, id: string) => page.locator(`[data-specialty-row="${id}"]`);
const tab = (page: Page, name: string) => page.getByRole('tab', { name: new RegExp(`^${name}`) });
const counter = (page: Page) => page.locator('[data-slot="counter"]');

/** The Mundo LUXE opens on its welcome clip: no specialty chosen yet. */
async function expectWelcome(page: Page) {
  await expect(page.locator('[data-specialty-row][data-active]')).toHaveCount(0);
  await expect(page.locator('[data-globe-panel][data-featured]')).toHaveAttribute('data-key', 'ritual-toallas-calidas');
  await expect(page.locator('[data-specialty-slot="name"]')).toHaveText('El cuidado se siente en cada detalle.');
}
async function expectSelected(page: Page, id: string) {
  await expect(row(page, id)).toHaveAttribute('data-active', '');
  await expect(page.locator('[data-globe-panel][data-featured]')).toHaveCount(1);
  await expect(page.locator('[data-globe-panel][data-featured]')).toHaveAttribute('data-key', FEATURED[id]!);
}

test('anuncios: especialidad, categoría y posición se comunican a lectores de pantalla', async ({ page }) => {
  await open(page);
  await page.locator('#servicios').getByRole('button', { name: 'Cejas', exact: true }).click();
  await expect(page.locator('[data-specialty-status]')).toContainText('Cejas. Diseño y definición de cejas.');
  await tab(page, 'Uñas').click();
  await expect(page.locator('[data-status]')).toHaveText(/^Uñas: 9 trabajos\. Trabajo 1 de 9\./);
  await page.getByRole('button', { name: 'Trabajo siguiente' }).click();
  await expect(page.locator('[data-status]')).toHaveText(/^Trabajo 2 de 9\./);
  await expect(page.locator('[data-slot="position"]')).toHaveText('Trabajo 2 de 9');
});

test('filtros por teclado: flechas, Inicio y Fin mueven foco y selección', async ({ page }) => {
  await open(page);
  await tab(page, 'Todos').focus();
  await page.keyboard.press('ArrowRight');
  await expect(tab(page, 'Cortes y barbería')).toBeFocused();
  await expect(tab(page, 'Cortes y barbería')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  await expect(tab(page, 'Faciales')).toHaveAttribute('aria-selected', 'true');
  await expect(counter(page)).toHaveText('01 / 02');
  await page.keyboard.press('Home');
  await expect(tab(page, 'Todos')).toBeFocused();
  await expect(page.locator('#showcase-panel')).toHaveAttribute('aria-labelledby', 'showcase-tab-all');
});

test('hover intencional: cruzar filas no cambia nada; reposar selecciona; salir conserva', async ({ page }) => {
  await open(page);
  await page.locator('#servicios .signature').scrollIntoViewIfNeeded();
  const center = async (id: string) => { const box = (await row(page, id).boundingBox())!; return [box.x + box.width / 3, box.y + box.height / 2] as const; };
  const [x1, y1] = await center('peluqueria');
  const [, y4] = await center('cejas');
  await page.mouse.move(x1, y1);
  await page.mouse.move(x1, y4, { steps: 3 });
  await page.mouse.move(x1 - 400, y4, { steps: 2 });
  await page.waitForTimeout(400);
  await expectWelcome(page);
  const [x3, y3] = await center('unas-pedicura');
  await page.mouse.move(x3, y3);
  await page.mouse.move(x3 + 4, y3 + 2);
  await page.waitForTimeout(300);
  await expectSelected(page, 'unas-pedicura');
  await page.mouse.move(5, 5);
  await page.waitForTimeout(400);
  await expectSelected(page, 'unas-pedicura');
});

test('desplazar la página con el cursor quieto sobre la lista no cambia la selección', async ({ page }) => {
  await open(page);
  await page.locator('#servicios .signature').evaluate((element) => element.scrollIntoView({ block: 'center' }));
  const box = (await row(page, 'cejas').boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 10);
  await page.mouse.move(box.x + 40, box.y + box.height / 2, { steps: 4 });
  await page.waitForTimeout(300);
  await expectSelected(page, 'cejas');
  for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 90); await page.waitForTimeout(60); }
  await page.waitForTimeout(400);
  await expectSelected(page, 'cejas');
});

test('altura estable: cambiar de especialidad, trabajo o ambiente no mueve la página', async ({ page }) => {
  await open(page);
  const heights = async () => page.evaluate(() => ['#servicios', '#trabajos', '#espacio'].map((id) => Math.round(document.querySelector(id)!.getBoundingClientRect().height)));
  const before = await heights();
  for (const name of ['Peluquería', 'Cuidado facial', 'Uñas y pedicura']) await page.locator('#servicios').getByRole('button', { name, exact: true }).click();
  for (const name of ['Cejas', 'Uñas', 'Todos']) await tab(page, name).click();
  await page.getByRole('button', { name: 'Trabajo siguiente' }).click();
  await page.locator('#espacio').getByRole('tab', { name: /Manicura/ }).click();
  expect(await heights()).toEqual(before);
});

test('módulos ausentes: el contenido estático sigue completo y sin controles inertes', async ({ page }) => {
  await page.route('**/src/scripts/specialties*', (route) => route.abort());
  await page.route('**/src/scripts/showcase*', (route) => route.abort());
  await page.route('**/src/scripts/space-tour*', (route) => route.abort());
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('.service-row')).toHaveCount(5);
  await expect(page.locator('[data-globe-panel][data-kind="photo"]')).toHaveCount(19);
  await expect(page.locator('[data-specialty-slot="name"]')).toHaveText('El cuidado se siente en cada detalle.');
  await expect(page.locator('[data-globe-controls]')).toBeHidden();
  await expect(page.locator('#trabajos [data-orbit-card]:visible')).toHaveCount(1);
  await expect(page.locator('[data-slot="title"]')).toHaveText('Textura arriba, degradado al costado.');
  await expect(page.locator('[data-tabs]')).toBeHidden();
  await expect(page.locator('[data-nav]')).toBeHidden();
  await expect(page.locator('[data-tour-view]:visible')).toHaveCount(1);
  await expect(page.locator('[data-tour-nav]')).toBeHidden();
  await expect(page.getByRole('navigation', { name: 'Acciones rápidas' })).toBeVisible();
});

test('desconexión y reconexión: limpieza completa, sin botones ni estados duplicados', async ({ page }) => {
  await open(page);
  await page.locator('#servicios').getByRole('button', { name: 'Cejas', exact: true }).click();
  await tab(page, 'Uñas').click();
  for (const tag of ['luxe-specialties', 'luxe-showcase', 'luxe-space-tour', 'luxe-hours']) {
    await page.locator(tag).evaluate((element) => { const parent = element.parentElement!; const next = element.nextSibling; element.remove(); parent.insertBefore(element, next); });
  }
  await expect(page.locator('.signature-trigger')).toHaveCount(5);
  await expectWelcome(page);
  await expect(tab(page, 'Todos')).toHaveAttribute('aria-selected', 'true');
  await expect(counter(page)).toHaveText('01 / 23');
  await expect(page.locator('#espacio [role="tab"][aria-selected="true"]')).toHaveCount(1);
  await page.locator('#servicios').getByRole('button', { name: 'Cuidado facial', exact: true }).click();
  await expectSelected(page, 'facial');
  await tab(page, 'Cejas').click();
  await expect(counter(page)).toHaveText('01 / 01');
});

test('imágenes no disponibles: navegación, texto y reserva siguen funcionando sin errores', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route(/_image\?.*(works%2F(corte-rizado|unas-azul)\.webp|spaces%2Fmanicura\.webp)/, (route) => route.abort());
  await open(page, 'no-preference');
  await page.locator('#servicios').getByRole('button', { name: 'Uñas y pedicura', exact: true }).click();
  await expectSelected(page, 'unas-pedicura');
  await tab(page, 'Cortes y barbería').click();
  for (let index = 0; index < 4; index++) await page.getByRole('button', { name: 'Trabajo siguiente' }).click();
  await expect(counter(page)).toHaveText('05 / 08');
  await page.locator('#espacio').getByRole('tab', { name: /Manicura/ }).click();
  await expect(page.locator('[data-tour-slot="title"]')).toHaveText('Área de manicura');
  await expect(page.locator('.showcase-cta')).toHaveAttribute('href', BOOKING);
  expect(errors).toEqual([]);
});

test('activar movimiento reducido en plena animación la detiene en su estado final', async ({ page }) => {
  await open(page, 'no-preference');
  await page.locator('#servicios .signature').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1_500);
  await page.locator('#servicios').getByRole('button', { name: 'Cejas', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => page.locator('main').evaluate((element) => element.getAnimations({ subtree: true }).filter((animation) => animation.playState === 'running').length)).toBe(0);
  await expectSelected(page, 'cejas');
});

test('sin promociones, precios ni reservas inventadas; solo la reserva oficial', async ({ page }) => {
  const requested: string[] = [];
  page.on('request', (request) => { if (request.resourceType() === 'image') requested.push(request.url()); });
  await open(page);
  await page.locator('#trabajos').scrollIntoViewIfNeeded();
  await expect(page.locator('main')).not.toContainText(/₡|₵|\$\d|15[.,]000/);
  for (const href of await page.locator('a[href*="dragocr.com"]').evaluateAll((links) => links.map((link) => link.getAttribute('href')))) expect(href).toBe(BOOKING);
  expect(requested.some((url) => url.includes('6219225aac964eaf9b1aeaa6dc07bb35'))).toBe(false);
  // The byte-identical original of the alternative barber view is never requested.
  expect(requested.some((url) => url.includes('Documentos'))).toBe(false);
});
