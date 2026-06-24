// packages/ui/tests/e2e/readiness.spec.ts
//
// E2E for the App.tsx ReadinessOverlay. The overlay renders when
// the readiness API returns ready: false (or never resolves); it
// clears once the system reports ready: true.
//
// The mock handlers expose one knob:
//
//   - POST /api/__e2e/set-ready with { ready, services } flips
//     the readiness endpoint's response. The flag is held on
//     `globalThis` in handlers.ts so it survives the page
//     navigation that happens between toggling it and reloading
//     the app — the JS bundle is re-evaluated on every nav, which
//     would otherwise reset a module-level `let` binding.
//
// The two tests:
//
//   1. The overlay mounts with the "System Initializing" heading
//      and a "Waiting for services: <name>..." sub-message when
//      the readiness endpoint reports a disconnected backend.
//   2. After flipping readiness back to ready, the overlay clears
//      and the Landing page mounts (the "Session History" card
//      heading is the contract).
//
// State isolation:
//   - The flag lives on `globalThis.__e2eIsReady` in handlers.ts.
//     The spec runs serially and the other e2e specs reset it
//     back to true via /api/__e2e/reset in their beforeEach
//     (e2eMockSeed writes back the default).
//
// Reference: packages/ui/src/App.tsx:50-104 for the overlay,
// packages/ui/src/mocks/handlers.ts:357-394 for the globalThis
// flag and the __e2e/set-ready endpoint.
import { test, expect } from '@playwright/test';

test.describe.serial('Readiness overlay', () => {
  test.beforeEach(async ({ page }) => {
    // Reseed the readiness flag to its default (ready:true) so
    // other specs in the run start from a known state. The reset
    // call survives a page navigation because the flag lives on
    // globalThis.
    await page.goto('/');
    await page.waitForResponse((resp) =>
      resp.url().endsWith('/api/status/readiness')
    );
    await page.evaluate(async () => {
      await fetch('/api/__e2e/reset', { method: 'POST' });
    });
  });

  test('shows the overlay when the system reports a disconnected service', async ({
    page,
  }) => {
    // Flip readiness to false; the flag is held on globalThis so
    // the very next navigation observes the not-ready response.
    await page.evaluate(async () => {
      await fetch('/api/__e2e/set-ready', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ready: false,
          services: {
            database: 'disconnected',
            elasticsearch: 'connected',
            llm: 'connected',
            whisper: 'connected',
          },
        }),
      });
    });

    // Navigate to a different URL first (to force a hard nav from
    // the current SPA route), then back to / so the App's
    // useQuery for readiness re-runs and reads the globalThis flag.
    await page.goto('/chats/42');
    await page.goto('/');

    // The overlay is rendered as a fixed Card. App.tsx:57-99.
    // The Landing page's main content is still in the DOM but is
    // visually covered by the overlay; Playwright's `toBeVisible`
    // does not account for occlusion, so we assert on the overlay
    // contract (heading + sub-message) rather than the occluded
    // Landing page.
    await expect(page.getByText('System Initializing')).toBeVisible();
    await expect(
      page.getByText(/Waiting for services: database/)
    ).toBeVisible();
  });

  test('clears the overlay when the system reports ready: true', async ({
    page,
  }) => {
    // Start in the not-ready state, then flip back to ready and
    // navigate to /. The globalThis flag carries through, and
    // the App's useQuery observes ready:true on the next load.
    await page.evaluate(async () => {
      await fetch('/api/__e2e/set-ready', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ready: false,
          services: { database: 'disconnected' },
        }),
      });
    });
    await page.goto('/');
    await expect(page.getByText('System Initializing')).toBeVisible();

    await page.evaluate(async () => {
      await fetch('/api/__e2e/set-ready', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ready: true }),
      });
    });
    await page.goto('/');

    await expect(page.getByText('System Initializing')).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: /Session History/i })
    ).toBeVisible();
  });
});
