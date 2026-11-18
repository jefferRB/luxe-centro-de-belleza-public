import { mkdir } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';

const sessionKey = 'luxe:intro:seen:v1';
const html = (page: Page) => page.locator('html');
const intro = (page: Page) => page.locator('#luxe-intro');

async function expectHero(page: Page) {
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const photo = page.locator('main img').first();
  await expect(photo).toBeVisible();
  await expect.poll(() => photo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
}

async function expectIntroClean(page: Page) {
  await expect.poll(() => intro(page).evaluate((element) => {
    const style = getComputedStyle(element);
    return style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0';
  })).toBe(true);
  await expect.poll(() => intro(page).evaluate((element) =>
    element.getAnimations({ subtree: true }).filter((animation) => animation.playState === 'running').length,
  )).toBe(0);
  await expect(page.locator('[data-intro-skip]')).toBeHidden();
  expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe('hidden');
}

for (const width of [360, 390, 768, 1440, 1920]) {
  test(`portada legible y sin overflow a ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await expectHero(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await expect(page.getByRole('navigation', { name: 'Navegación principal' })).toBeVisible();
    if (width === 390 || width === 1440) {
      await mkdir('test-results/qa', { recursive: true });
      await page.screenshot({ path: `test-results/qa/fase-2-${width === 390 ? 'mobile' : 'desktop'}.png`, fullPage: true });
    }
  });
}

test('primera visita reproduce y la recarga de sesión omite', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(html(page)).toHaveAttribute('data-luxe-intro', 'playing');
  await expect(html(page)).toHaveAttribute('data-luxe-intro', 'completed');
  expect(await page.evaluate((key) => sessionStorage.getItem(key), sessionKey)).toBe('1');
  await expectIntroClean(page);
  await page.reload();
  await expect(html(page)).toHaveAttribute('data-luxe-intro', 'skipped');
  await expectIntroClean(page);
});

test('movimiento reducido omite incluso con replay de desarrollo', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?intro=replay');
  await expect(html(page)).toHaveAttribute('data-luxe-intro', 'skipped');
  await expectIntroClean(page);
  await expectHero(page);
});

test('saltar mediante teclado limpia la escena y lleva el foco al contenido', async ({ page }) => {
  await page.goto('/?intro=replay', { waitUntil: 'domcontentloaded' });
  const skip = page.locator('[data-intro-skip]');
  await expect(skip).toBeVisible();
  await skip.focus();
  await page.keyboard.press('Enter');
  await expect(html(page)).toHaveAttribute('data-luxe-intro', 'skipped');
  await expectIntroClean(page);
  await expect(page.locator('main')).toBeFocused();
});

test('storage denegado no genera excepción ni bloqueo', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() { throw new DOMException('Storage blocked for test', 'SecurityError'); },
    });
  });
  await page.goto('/');
  await expect(html(page)).toHaveAttribute('data-luxe-intro', /^(skipped|completed)$/);
  await expectIntroClean(page);
  await expectHero(page);
  expect(errors).toEqual([]);
});

test('pagehide interrumpe sin dejar animaciones ni estilos bloqueantes', async ({ page }) => {
  await page.goto('/?intro=replay', { waitUntil: 'domcontentloaded' });
  await expect(html(page)).toHaveAttribute('data-luxe-intro', 'playing');
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  await expect(html(page)).toHaveAttribute('data-luxe-intro', 'skipped');
  await expectIntroClean(page);
  await expectHero(page);
});

test('cambiar a movimiento reducido durante el corte lo interrumpe', async ({ page }) => {
  await page.goto('/?intro=replay', { waitUntil: 'domcontentloaded' });
  await expect(html(page)).toHaveAttribute('data-luxe-intro', 'playing');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(html(page)).toHaveAttribute('data-luxe-intro', 'skipped');
  await expectIntroClean(page);
});

test('replay de desarrollo permite repetir sin borrar sesión', async ({ page }) => {
  await page.addInitScript((key) => sessionStorage.setItem(key, '1'), sessionKey);
  await page.goto('/?intro=replay', { waitUntil: 'domcontentloaded' });
  await expect(html(page)).toHaveAttribute('data-luxe-intro', 'playing');
  await expect(html(page)).toHaveAttribute('data-luxe-intro', 'completed');
});

test('un módulo de intro ausente no deja la cortina visible', async ({ page }) => {
  await page.route('**/src/scripts/intro.ts*', (route) => route.abort());
  await page.goto('/?intro=replay', { waitUntil: 'domcontentloaded' });
  await expect(html(page)).toHaveAttribute('data-luxe-intro', 'completed');
  await expectIntroClean(page);
  await expectHero(page);
});

test('cancelar la animación libera la escena', async ({ page }) => {
  await page.goto('/?intro=replay', { waitUntil: 'domcontentloaded' });
  await expect(html(page)).toHaveAttribute('data-luxe-intro', 'playing');
  await intro(page).evaluate((element) => {
    for (const animation of element.getAnimations()) animation.cancel();
  });
  await expect(html(page)).toHaveAttribute('data-luxe-intro', 'skipped');
  await expectIntroClean(page);
});

test('la tijera recorre la línea y completa el corte', async ({ page }) => {
  // Sample the scissors on every frame from the very start: a short intro can travel most of
  // its line before a test step gets to measure it, so polling after load races the animation.
  await page.addInitScript(() => {
    const samples: number[] = [];
    (window as unknown as { __scissorsX: number[] }).__scissorsX = samples;
    const sample = () => {
      const track = document.querySelector('.scissors-track');
      if (track && document.documentElement.dataset.luxeIntro === 'playing') samples.push(track.getBoundingClientRect().x);
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.goto('/?intro=replay', { waitUntil: 'domcontentloaded' });
  await expect(html(page)).toHaveAttribute('data-luxe-intro', /playing|completed/);
  await expect(html(page)).toHaveAttribute('data-luxe-intro', 'completed');
  const samples = await page.evaluate(() => (window as unknown as { __scissorsX: number[] }).__scissorsX);
  expect(samples.length, 'frames sampled while playing').toBeGreaterThan(5);
  // Left to right along the line: it starts near the left and travels across the viewport.
  expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(300);
  expect(samples.at(-1)!).toBeGreaterThan(samples[0]!);
  await expectIntroClean(page);
});

test('texto y fotografía funcionan sin JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  try {
    await page.goto('http://localhost:4321/');
    await expectHero(page);
    await expectIntroClean(page);
    await expect(page.locator('main')).toBeVisible();
  } finally {
    await context.close();
  }
});

test('navegación solo usa destinos existentes y no publica reservas falsas', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const links = await page.locator('a[href]').evaluateAll((elements) => elements.map((element) => element.getAttribute('href')));
  expect(links.length).toBeGreaterThan(0);
  // Fase 3.2: booking and contact URLs are now confirmed; anything else external is still a failure.
  // Fase 4: the Waze share link is confirmed as well.
  const confirmed = ['https://www.dragocr.com/reservar/luxecentrobelleza', 'https://wa.me/50671620752', 'https://www.instagram.com/luxe_centrodebelleza/', 'https://maps.app.goo.gl/z7ss3mpVHJqMxDbe6', 'https://waze.com/ul/hd1u22w6m3'];
  for (const href of links) {
    expect(href).toBeTruthy();
    const url = new URL(href ?? '', 'http://localhost:4321/');
    if (url.origin !== 'http://localhost:4321') { expect(confirmed).toContain(href); continue; }
    expect(url.pathname).toBe('/');
    if (url.hash) expect(await page.locator(`[id="${url.hash.slice(1)}"]`).count()).toBe(1);
  }
  const headerBooking = page.locator('header').getByRole('link', { name: /^Reservar( cita)?$/ });
  await expect(headerBooking).toHaveAttribute('href', confirmed[0]!);
  await expect(headerBooking).toHaveAttribute('rel', 'noopener noreferrer');
  expect(links.some((href) => /dragocr\.com\/(fidelidad|opinar)/.test(href ?? ''))).toBe(false);
});

test('reflow con escala CSS de 200% conserva texto y navegación', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  // CSS zoom exercises reflow; this is not a claim of native browser zoom coverage.
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  await expectHero(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await expect(page.getByRole('navigation', { name: 'Navegación principal' })).toBeVisible();
});
