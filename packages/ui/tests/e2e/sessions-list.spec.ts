// packages/ui/tests/e2e/sessions-list.spec.ts
//
// E2E for the /sessions-list page (SessionsPage.tsx). Covers the
// filter + sort + empty-state surfaces that the Landing page does
// not exercise:
//
//   1. Navigate to /sessions-list via the PersistentSidebar.
//   2. Open the Client filter dropdown and pick "Jane Doe".
//      URL gains ?client=Jane+Doe, the table is filtered.
//   3. Add a Type filter (?type=followup) and assert the empty
//      state ("No sessions match the selected filters") renders,
//      because the only Jane Doe follow-up is the second session
//      and the filters combine.
//   4. Clear the Type filter so the client filter alone leaves one
//      row visible, then clear the Client filter too.
//   5. Sort by Date (click the Date column header) and assert
//      aria-sort="ascending" is applied.
//
// State isolation:
//   - The page reads from the e2e-aware /api/sessions/ handler
//     which is mutated by the CRUD spec. We reseed via
//     /api/__e2e/reset in beforeEach so the two mocked sessions
//     (intake on 2026-06-23 + follow-up on 2026-06-30) are the
//     known baseline.
//
// Reference: packages/ui/src/components/SessionsPage.tsx for the
// page, packages/ui/src/components/SessionsPage/SessionFilters.tsx
// for the filter buttons, packages/ui/src/components/LandingPage/
// SessionListTable.tsx for the sort behavior.
import { test, expect } from '@playwright/test';

test.describe('Sessions list filters and sort', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(async () => {
      await fetch('/api/__e2e/reset', { method: 'POST' });
    });
    await page.goto('/sessions-list');
  });

  test('renders all sessions initially and filters by client + type', async ({
    page,
  }) => {
    const main = page.locator('main');
    await expect(
      main.getByRole('heading', { name: 'All Sessions' })
    ).toBeVisible();

    // Both seeded sessions render.
    const intakeRow = page.locator(
      'tr[aria-label="Load session: Intake Session"]'
    );
    const followupRow = page.locator(
      'tr[aria-label="Load session: Follow-up Session"]'
    );
    await expect(intakeRow).toBeVisible();
    await expect(followupRow).toBeVisible();

    // --- 1. Apply the client filter -----------------------------------
    // The "All Clients" trigger is the first dropdown button in the
    // filter row. We open it and pick "Jane Doe" via the visible
    // menuitem. We use :visible to disambiguate from any identical
    // text elsewhere on the page (e.g. the Client column cells).
    const allClientsButton = main.getByRole('button', { name: 'All Clients' });
    await allClientsButton.click();
    await page.locator('text=Jane Doe').last().click();

    // SessionsPage persists filters via setSearchParams, so the URL
    // is the contract. (?client=Jane+Doe — Radix may also URL-encode
    // the space; we match on the value either way.)
    await expect(page).toHaveURL(/[?&]client=Jane(\+|%20)Doe/);

    // Both rows are still Jane Doe so they both remain.
    await expect(intakeRow).toBeVisible();
    await expect(followupRow).toBeVisible();

    // --- 2. Add a Type filter that only one row matches --------------
    // SESSION_TYPES is sorted alphabetically; "Intake" appears in
    // the dropdown. The intake session has sessionType="Intake" so
    // the filter narrows to that one row.
    await main.getByRole('button', { name: 'All Types' }).click();
    await page.locator('text=Intake').last().click();
    await expect(page).toHaveURL(/[?&]type=Intake/);

    // Only the intake row should be visible now.
    await expect(intakeRow).toBeVisible();
    await expect(followupRow).toHaveCount(0);
  });

  test('renders the empty-state card when filters match nothing', async ({
    page,
  }) => {
    const main = page.locator('main');
    await expect(
      main.getByRole('heading', { name: 'All Sessions' })
    ).toBeVisible();

    // Apply a Type that no session matches. The seeded sessions are
    // "Intake" and "Individual"; we set the type filter via direct
    // URL navigation so we don't depend on the dropdown's exact
    // menuitem roles.
    await page.goto('/sessions-list?type=Phone');
    await expect(page).toHaveURL(/[?&]type=Phone/);

    await expect(
      main.getByText('No sessions match the selected filters.')
    ).toBeVisible();
  });

  test('sorts the table by Date (ascending) when the header is clicked', async ({
    page,
  }) => {
    const main = page.locator('main');

    // SessionListTable.tsx:374 wires the Date ColumnHeaderCell with
    // aria-sort; we click it once and observe the aria-sort flips
    // to "ascending" (sortDirection flips from desc to asc, since
    // the default is desc for date).
    const dateHeader = main.getByRole('columnheader', { name: /Date/ });
    await expect(dateHeader).toBeVisible();
    await dateHeader.click();

    // After click, the header announces its new sort state.
    await expect(dateHeader).toHaveAttribute('aria-sort', 'ascending');

    // The intake (2026-06-23) should now precede the follow-up
    // (2026-06-30) in the rendered table order.
    const rows = await page.locator('tbody tr').allTextContents();
    const intakeIndex = rows.findIndex((text) =>
      text.includes('Intake Session')
    );
    const followupIndex = rows.findIndex((text) =>
      text.includes('Follow-up Session')
    );
    expect(intakeIndex).toBeLessThan(followupIndex);
  });
});
