// packages/ui/tests/e2e/session-navigation.spec.ts
//
// E2E for SessionView prev/next session navigation
// (SessionView.tsx + SessionNavButton):
//
//   1. From /sessions-list in default (date desc) order, opening the
//      first row (Follow-up) shows a disabled prev button and an enabled
//      next button whose tooltip names the Intake session; clicking next
//      lands on session 1 (redirected to its latest chat).
//   2. After flipping the table sort to date asc, opening the first row
//      (Intake) reverses the neighbors: prev disabled, next targets the
//      Follow-up session — proving navigation follows the table's sort
//      order, not id order.
//
// State isolation: reseed via /api/__e2e/reset in beforeEach so the two
// mocked sessions (Intake id 1 on 2026-06-23 + Follow-up id 2 on
// 2026-06-30) are the known baseline.
//
// Reference: packages/ui/src/components/SessionView/SessionView.tsx for
// the buttons, packages/ui/src/components/LandingPage/SessionListTable.tsx
// for the router-state order handoff, packages/ui/src/utils/sortSessions.ts
// for the shared comparator.
import { test, expect } from '@playwright/test';

test.describe.serial('Session prev/next navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(async () => {
      await fetch('/api/__e2e/reset', { method: 'POST' });
    });
    await page.goto('/sessions-list');
  });

  test('walks the default date-desc order with a named tooltip', async ({
    page,
  }) => {
    // Default sort is date desc: Follow-up (id 2) first, Intake (id 1) last.
    await page
      .locator('tr[aria-label="Load session: Follow-up Session"]')
      .click();
    await page.waitForURL(/\/sessions\/2$/);

    const prevButton = page.getByTestId('session-prev-button');
    const nextButton = page.getByTestId('session-next-button');
    await expect(prevButton).toBeVisible();
    await expect(nextButton).toBeVisible();

    // First in order: no previous, next targets Intake by name.
    await expect(prevButton).toBeDisabled();
    await expect(prevButton).toHaveAttribute(
      'aria-label',
      'No previous session'
    );
    await expect(nextButton).toBeEnabled();
    await expect(nextButton).toHaveAttribute(
      'aria-label',
      'Next session: Intake Session'
    );

    // The Radix tooltip names the target session on hover.
    await nextButton.hover();
    await expect(
      page.getByRole('tooltip', { name: 'Next session: Intake Session' })
    ).toBeVisible({ timeout: 5000 });

    // Next lands on session 1, auto-redirected to its latest chat (id 11).
    await nextButton.click();
    await page.waitForURL(/\/sessions\/1\/chats\/11/);

    // Last in order: prev targets Follow-up, next is disabled.
    await expect(prevButton).toBeEnabled();
    await expect(prevButton).toHaveAttribute(
      'aria-label',
      'Previous session: Follow-up Session'
    );
    await expect(nextButton).toBeDisabled();

    // Walking back preserves the table order across navigations.
    await prevButton.click();
    await page.waitForURL(/\/sessions\/2$/);
  });

  test('follows the table sort order after re-sorting to date asc', async ({
    page,
  }) => {
    // Flip Date desc -> asc: Intake first, Follow-up last.
    const main = page.locator('main');
    await main.getByText('Date').click();
    await expect(main.locator('th[aria-sort="ascending"]')).toBeVisible();

    await page.locator('tr[aria-label="Load session: Intake Session"]').click();
    await page.waitForURL(/\/sessions\/1\/chats\/11/);

    // Neighbors are reversed relative to the desc baseline.
    const prevButton = page.getByTestId('session-prev-button');
    const nextButton = page.getByTestId('session-next-button');
    await expect(prevButton).toBeDisabled();
    await expect(nextButton).toBeEnabled();
    await expect(nextButton).toHaveAttribute(
      'aria-label',
      'Next session: Follow-up Session'
    );

    await nextButton.click();
    await page.waitForURL(/\/sessions\/2$/);
  });
});
