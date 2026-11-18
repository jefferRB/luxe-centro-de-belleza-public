import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';

/** Admin panel against a running admin server with TEST credentials (never production):
 *   LUXE_E2E_ADMIN_URL=http://localhost:4322 LUXE_E2E_USER=… LUXE_E2E_PASSWORD=… npx playwright test admin
 * Skipped when those variables are absent (the regular suite runs on astro dev). */
const base = process.env.LUXE_E2E_ADMIN_URL;
const user = process.env.LUXE_E2E_USER ?? '';
const password = process.env.LUXE_E2E_PASSWORD ?? '';
test.skip(!base || !user || !password, 'Admin e2e needs LUXE_E2E_ADMIN_URL, LUXE_E2E_USER and LUXE_E2E_PASSWORD');

async function signIn(page: Page) {
  await page.goto(`${base}/admin`);
  await page.getByLabel('Usuario').fill(user);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
}

test('acceso inválido muestra un error claro y no entra', async ({ page }) => {
  await page.goto(`${base}/admin`);
  await expect(page).toHaveTitle(/Panel de fotografías/);
  expect(await page.locator('meta[name="robots"]').getAttribute('content')).toContain('noindex');
  await page.getByLabel('Usuario').fill(user);
  await page.getByLabel('Contraseña').fill(`${password}-incorrecta`);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByRole('alert')).toHaveText('Usuario o contraseña incorrectos.');
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toHaveCount(0);
});

test('panel: secciones reales, previsualización, edición de texto, orden y cierre de sesión', async ({ page }) => {
  await signIn(page);
  for (const name of ['Portada', 'Trabajos', 'Mundo LUXE', 'Espacio', 'Fachada']) await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  await expect(page.locator('.photo-card')).toHaveCount(1);
  await expect(page.locator('.photo-card img')).toHaveJSProperty('complete', true);

  // Replace dialog: local preview before saving; cancel leaves everything as it was.
  await page.getByRole('button', { name: 'Reemplazar' }).click();
  const dialog = page.getByRole('dialog');
  const photo = await sharp({ create: { width: 900, height: 1200, channels: 3, background: '#103d32' } }).jpeg().toBuffer();
  await dialog.locator('input[type="file"]').setInputFiles({ name: 'nueva.jpg', mimeType: 'image/jpeg', buffer: photo });
  await expect(dialog.locator('.admin-preview__img')).toBeVisible();
  await expect(dialog.getByText(/900×1200 px/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Alt text of the facade. The edit persists in the local store (./.luxe-media), so it keeps
  // describing the demo illustration: later specs in the same run still read a truthful alt.
  await page.getByRole('button', { name: 'Fachada', exact: true }).click();
  await page.getByRole('button', { name: 'Editar texto' }).click();
  const alt = page.getByRole('dialog').getByRole('textbox');
  await alt.fill('Ilustración de demostración de una fachada de noche, con rótulos iluminados y luces cálidas.');
  await page.getByRole('dialog').getByRole('button', { name: 'Guardar' }).click();
  await expect(page.locator('.admin-toast').first()).toContainText('Textos guardados');
  await expect(page.locator('.photo-card__alt')).toContainText('rótulos iluminados');

  // Works: filter, move, then discard the unsaved order.
  await page.getByRole('button', { name: 'Trabajos', exact: true }).click();
  await page.getByRole('button', { name: /^Uñas \(\d+\)$/ }).click();
  const first = await page.locator('.photo-card h3').first().textContent();
  await page.locator('.photo-card').first().getByRole('button', { name: /después/ }).click();
  await expect(page.getByText('Cambiaste el orden.')).toBeVisible();
  await expect(page.locator('.photo-card h3').nth(1)).toHaveText(first!);
  await page.getByRole('button', { name: 'Descartar' }).click();
  await expect(page.locator('.photo-card h3').first()).toHaveText(first!);

  // Retiring asks for confirmation; cancelling keeps the photo.
  await page.locator('.photo-card').first().getByRole('button', { name: 'Retirar' }).click();
  await expect(page.getByRole('dialog')).toContainText('¿Retirar esta fotografía?');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click();

  await page.getByRole('button', { name: 'Mundo LUXE', exact: true }).click();
  await expect(page.locator('.globe-card')).toHaveCount(5);

  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page.getByRole('button', { name: 'Ingresar' })).toBeVisible();
  const response = await page.request.get(`${base}/admin/api/photos`);
  expect(response.status()).toBe(401);
});

test('móvil: sin desplazamiento horizontal y acciones al alcance', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page);
  for (const tab of ['Portada', 'Trabajos', 'Mundo LUXE', 'Espacio']) {
    await page.getByRole('button', { name: tab, exact: true }).click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${tab} overflows`).toBeLessThanOrEqual(0);
  }
  const button = page.locator('.photo-card').first().getByRole('button', { name: 'Reemplazar' });
  const box = await button.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
});
