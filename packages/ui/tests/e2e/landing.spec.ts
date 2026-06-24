// packages/ui/tests/e2e/landing.spec.ts
//
// Happy-path E2E for the Landing page. Verifies that:
//   - the readiness overlay clears (msw /api/status/readiness returns ready:true)
//   - the mocked session row renders in the main table
//   - the standalone chat fallback row renders
//
// This is intentionally minimal. Add more specs as the handler surface in
// packages/ui/src/mocks/handlers.ts grows.
//
// Note: the "Recent Sessions" sidebar link also renders each session's name
// (e.g. "Intake Session" via PersistentSidebar), so we scope the row
// assertions to the <main> content to avoid strict-mode violations.
import { test, expect } from '@playwright/test';

test('landing page renders mocked sessions and standalone chats', async ({
  page,
}) => {
  await page.goto('/');

  // Readiness overlay must clear so the rest of the page can mount.
  const main = page.locator('main');
  await expect(
    main.getByRole('heading', { name: /Session History/i })
  ).toBeVisible();

  // Mocked session from src/mocks/handlers.ts.
  await expect(main.getByText('Intake Session').first()).toBeVisible();
  // The analysis e2e spec added a second session with the same client
  // name; use .first() so strict-mode getByText does not reject the
  // two matching cells.
  await expect(main.getByText('Jane Doe').first()).toBeVisible();

  // Standalone chats card + the timestamp-fallback label
  // (LandingPage.tsx renders `Chat (${formatTimestamp(...)})` when name is null).
  await expect(
    main.getByRole('heading', { name: /Standalone Chats/i })
  ).toBeVisible();
  await expect(main.getByText(/^Chat \(/).first()).toBeVisible();
});
