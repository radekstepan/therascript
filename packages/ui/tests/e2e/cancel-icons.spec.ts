// packages/ui/tests/e2e/cancel-icons.spec.ts
//
// E2E for the cancel-button icon fix: every cancel affordance used
// Radix `StopIcon`, whose SVG path is a hollow even-odd square
// outline that renders as an empty rectangle (tofu box) at 15px.
// Cancel buttons must render the `Cross2Icon` X glyph instead — the
// pattern used by CreateAnalysisJobModal, EditEntityModal, etc.
//
// Each test locates a cancel affordance at a different call site and
// asserts its inline `<svg><path d="...">` is the Cross2 X path and
// NOT the hollow-square StopIcon path:
//
//   StopIcon d (verbatim from the installed
//   @radix-ui/react-icons bundle):
//   M2 3C2 2.44772 ... V3ZM12 3H3V12H12V3Z
//   Cross2Icon d starts with: M11.7816 4.03157
//
// State isolation:
//   - The analysis tests are read-only (open a dropdown / load the
//     detail view, never confirm), so they run in the global pool
//     after gotoAndResetMocks reseeds jobs 100/101.
//   - The chat test sends one `__slow__` message (the mock holds the
//     stream open 8s), asserts the icon, then clicks Cancel and
//     awaits the delayed unload request — the same cleanup flow as
//     chat-stop.spec.ts, leaving no hanging stream.
//
// Reference: packages/ui/src/components/Analysis/AnalysisJobsPage.tsx
// (row dropdown + detail header), packages/ui/src/components/
// SessionView/Chat/ChatInput.tsx (aria-label "Cancel AI response").
import { test, expect, type Locator, type Page } from '@playwright/test';
import { gotoAndResetMocks } from './helpers';

// Verbatim `d` of StopIcon in the installed @radix-ui/react-icons
// bundle: outer rounded rect minus inner rect (fillRule evenodd) —
// the hollow square that read as an empty rectangle.
const STOPICON_SQUARE_D =
  'M2 3C2 2.44772 2.44772 2 3 2H12C12.5523 2 13 2.44772 13 3V12C13 12.5523 12.5523 13 12 13H3C2.44772 13 2 12.5523 2 12V3ZM12 3H3V12H12V3Z';

// Prefix of the Cross2Icon `d` (diagonal X glyph).
const CROSS2_D_PREFIX = 'M11.7816 4.03157';

const PROCESSING_JOB = 'Sleep Issues (mapping)';
const SELECTED_LOCAL_MODEL = 'qwen2.5-7b-instruct';

async function expectCrossGlyph(iconHost: Locator): Promise<void> {
  const path = iconHost.locator('svg path');
  await expect(path).toHaveCount(1);
  const d = await path.getAttribute('d');
  expect(d).not.toBe(STOPICON_SQUARE_D);
  expect(d?.startsWith(CROSS2_D_PREFIX)).toBe(true);
}

async function loadLocalModel(page: Page): Promise<void> {
  // Mirrors chat-stop.spec.ts: configure + load the local model so a
  // chat turn can start streaming.
  const configureButton = page
    .getByRole('button', { name: 'Configure AI Model' })
    .first();
  await expect(configureButton).toBeVisible();
  await configureButton.click();

  const dialog = page.getByRole('dialog').first();
  await expect(dialog.getByText('Configure AI Model')).toBeVisible();
  const modelCombobox = dialog.getByRole('combobox');
  await modelCombobox.click();
  await page
    .getByRole('option', { name: new RegExp(SELECTED_LOCAL_MODEL) })
    .click();
  await dialog.getByRole('button', { name: /Save & Load Model/ }).click();
  await expect(page.getByText(SELECTED_LOCAL_MODEL).first()).toBeVisible();
}

test.describe('Cancel button icons', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAndResetMocks(page);
  });

  test('analysis row dropdown Cancel item renders the X glyph', async ({
    page,
  }) => {
    await page.goto('/analysis-jobs');
    const main = page.locator('main');
    const processingRow = main
      .locator('tr')
      .filter({ hasText: PROCESSING_JOB });
    await expect(processingRow).toBeVisible();

    await processingRow.getByRole('button', { name: 'Job Actions' }).click();
    const cancelItem = page.getByRole('menuitem', { name: /Cancel Job/ });
    await expect(cancelItem).toBeVisible();
    await expectCrossGlyph(cancelItem);
  });

  test('analysis detail header Cancel button renders the X glyph', async ({
    page,
  }) => {
    // Job 100 is the seeded `mapping` (cancellable) job.
    await page.goto('/analysis-jobs/100');
    const cancelButton = page.getByRole('button', { name: 'Cancel Job' });
    await expect(cancelButton).toBeVisible();
    await expectCrossGlyph(cancelButton);
  });

  test('chat Cancel AI response button renders the X glyph', async ({
    page,
  }) => {
    await page.goto('/sessions/1');
    await loadLocalModel(page);

    const chatInput = page
      .locator('[data-testid="chat-input"]:visible')
      .first();
    await expect(chatInput).toBeEnabled();
    // Listen BEFORE canceling: the UI fires the delayed unload 500ms
    // after the abort (chat-stop.spec.ts precedent).
    const unloadRequest = page.waitForRequest(/\/api\/llm\/unload/);
    await chatInput.fill('check the cancel glyph __slow__');
    await chatInput.press('Enter');

    const cancelButton = page.getByRole('button', {
      name: 'Cancel AI response',
    });
    await expect(cancelButton).toBeVisible();
    await expectCrossGlyph(cancelButton);

    // Cleanup: cancel the held-open stream so nothing hangs.
    await cancelButton.click();
    await unloadRequest;
    await expect(cancelButton).toHaveCount(0);
  });
});
