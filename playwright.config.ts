import { defineConfig } from '@playwright/test';

/** Start the local server with npm run dev before running these checks.
 * No foreground server is spawned: AGENTS requires Astro background mode.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 20_000,
  expect: { timeout: 5_000 },
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4321',
    browserName: 'chromium',
    channel: process.platform === 'win32' && !process.env.CI ? 'chrome' : undefined,
    headless: true,
    locale: 'es-CR',
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'no-preference',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
