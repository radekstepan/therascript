// packages/ui/tests/e2e/helpers.ts
//
// Shared e2e setup helpers.
import { expect, type Page } from '@playwright/test';

/**
 * Navigate to / and reseed the MSW mock state via POST
 * /api/__e2e/reset.
 *
 * The reset fetch MUST wait until the MSW service worker controls the
 * page. On a fresh browser context the worker is still registering
 * when `page.goto('/')` resolves; a fetch issued in that window
 * bypasses MSW, hits the webpack-dev-server proxy (HPM ECONNREFUSED
 * noise in the WebServer log), and silently fails to reseed — leaking
 * state into the test. Waiting for `serviceWorker.controller` closes
 * the race.
 *
 * The reset response status is asserted: a non-200 means the request
 * never reached MSW (dead worker), which fails fast here with a clear
 * message instead of confusing downstream locator timeouts.
 */
export async function gotoAndResetMocks(page: Page): Promise<void> {
  await page.goto('/');
  await expect
    .poll(
      async () =>
        page.evaluate(() => navigator.serviceWorker.controller !== null),
      { timeout: 15000 }
    )
    .toBe(true);
  const status = await page.evaluate(async () => {
    const res = await fetch('/api/__e2e/reset', { method: 'POST' });
    return res.status;
  });
  expect(status).toBe(200);
}
