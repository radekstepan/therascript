// packages/ui/tests/e2e/analysis-jobs.spec.ts
//
// E2E for the /analysis-jobs list view's row-level actions:
//
//   1. List renders the two seeded jobs ("Sleep Issues (processing)"
//      + "Client Progress (completed)").
//   2. Cancel the processing job — the AlertDialog opens with the
//      job id, confirm, and the row's status flips to "canceled".
//   3. Delete the completed job — the AlertDialog opens, confirm,
//      and the row is removed from the list.
//
// State isolation:
//   - The /api/analysis-jobs handler reads from `e2eAnalysisJobs`
//     in handlers.ts. We reseed via /api/__e2e/reset in beforeEach
//     so the two seeded jobs are guaranteed present, and the spec
//     runs as a serial block in one worker.
//
// Reference: packages/ui/src/mocks/handlers.ts for the mock
// surface, packages/ui/src/components/Analysis/AnalysisJobsPage.tsx
// for the row actions, the AlertDialog at line 1038 (cancel) and
// line 1072 (delete).
import { test, expect } from '@playwright/test';

const PROCESSING_JOB = 'Sleep Issues (mapping)';
const COMPLETED_JOB = 'Client Progress (completed)';

test.describe.serial('Analysis jobs list actions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(async () => {
      await fetch('/api/__e2e/reset', { method: 'POST' });
    });
    await page.goto('/analysis-jobs');
  });

  test('renders the seeded analysis jobs', async ({ page }) => {
    const main = page.locator('main');
    await expect(main.getByText(PROCESSING_JOB)).toBeVisible();
    await expect(main.getByText(COMPLETED_JOB)).toBeVisible();
  });

  test('cancels a processing job from the row dropdown', async ({ page }) => {
    const main = page.locator('main');

    // Pin the row by its unique short_prompt text.
    const processingRow = main
      .locator('tr')
      .filter({ hasText: PROCESSING_JOB });
    await expect(processingRow).toBeVisible();

    // AnalysisJobsPage.tsx:835-844 renders the IconButton with
    // aria-label="Job Actions" inside each row's last cell.
    await processingRow.getByRole('button', { name: 'Job Actions' }).click();
    // The "Cancel Job" menuitem is the only one that is enabled
    // (Delete is disabled because the job is not terminal).
    await page.locator('text=Cancel Job').last().click();

    // Confirm via the AlertDialog.
    const dialog = page.getByRole('alertdialog');
    await expect(dialog.getByText('Cancel Analysis')).toBeVisible();
    await dialog.getByRole('button', { name: /Confirm Cancel/ }).click();

    // The mock transitions the row to "canceled" and the toast
    // surfaces the response message ("Job 100 cancellation requested.").
    await expect(page.getByText(/cancellation requested/i)).toBeVisible();
    await expect(processingRow.getByText('canceled').first()).toBeVisible();
  });

  test('deletes a completed job from the row dropdown', async ({ page }) => {
    const main = page.locator('main');

    const completedRow = main.locator('tr').filter({ hasText: COMPLETED_JOB });
    await expect(completedRow).toBeVisible();

    await completedRow.getByRole('button', { name: 'Job Actions' }).click();
    await page.locator('text=Delete Job').last().click();

    const dialog = page.getByRole('alertdialog');
    await expect(dialog.getByText('Delete Analysis')).toBeVisible();
    await dialog.getByRole('button', { name: /Delete/ }).click();

    // The mock removes the job and the toast surfaces the
    // response message. `.first()` pins the assertion to the
    // first matching node (the toast is rendered once in the
    // Toast.Root and again in the aria-live region — both are
    // correct visually but trigger strict-mode violations).
    await expect(page.getByText(/Job 101 deleted/).first()).toBeVisible();
    await expect(main.getByText(COMPLETED_JOB)).toHaveCount(0);
  });
});
