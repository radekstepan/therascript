// packages/ui/tests/e2e/llm-pull-delete.spec.ts
//
// E2E for the Model Manager flows beyond set/unload (which the chat
// specs already cover): downloading a model (pull → status polling →
// cancel) and deleting a local model.
//
// Flow:
//   1. Open /settings → "Open Model Manager" → "Manage Language
//      Model" lists both seeded local models.
//   2. Pull: enter a GGUF URL → Download → downloading status with
//      progress renders → Cancel → "Pull canceled" toast and the
//      Download button returns.
//   3. Delete: row actions for mistral-7b-local → "Delete Model..."
//      → confirm → deleted toast + request fired. The modal's
//      optimistic cache patch + scheduled refetch use a mismatched
//      query key, so the list only refreshes on the next fetch:
//      close + reopen the manager and assert the model is gone while
//      qwen2.5-7b-instruct remains.
//
// Reference: packages/ui/src/components/SessionView/Modals/
// LlmManagementModal.tsx and packages/ui/src/mocks/handlers/llm.ts
// (pull state machine + mutable local catalog).
import { test, expect, type Page, type Locator } from '@playwright/test';
import { gotoAndResetMocks } from './helpers';

const PULL_URL = 'https://example.com/models/test-model.gguf';
const PULL_MODEL_NAME = 'test-model.gguf';

test.describe.serial('LLM model pull and delete', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAndResetMocks(page);
  });

  async function openModelManager(page: Page): Promise<Locator> {
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Open Model Manager' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Manage Language Model')).toBeVisible();
    return dialog;
  }

  test('pulls a model and cancels the download', async ({ page }) => {
    const dialog = await openModelManager(page);
    await expect(dialog.getByText('qwen2.5-7b-instruct')).toBeVisible();
    await expect(dialog.getByText('mistral-7b-local')).toBeVisible();

    await dialog.getByPlaceholder(/Enter GGUF model URL/).fill(PULL_URL);
    await dialog.getByRole('button', { name: 'Download' }).click();

    // Downloading status block with progress. Note "Status for
    // <name>:" is split across elements (Text + Strong), so assert
    // the parts separately.
    await expect(dialog.getByText('Status for')).toBeVisible();
    await expect(dialog.getByText(PULL_MODEL_NAME).first()).toBeVisible();
    await expect(dialog.locator('[role=progressbar]')).toBeVisible();
    await expect(
      dialog.getByText(new RegExp(`Downloading ${PULL_MODEL_NAME}`))
    ).toBeVisible();

    // Cancel before the mock reports completion (3rd poll).
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(
      page.getByText(new RegExp(`Pull canceled for ${PULL_MODEL_NAME}`)).first()
    ).toBeVisible();
    // Idle again: the Download action returns.
    await expect(
      dialog.getByRole('button', { name: 'Download' })
    ).toBeVisible();
  });

  test('deletes a local model after confirmation', async ({ page }) => {
    const dialog = await openModelManager(page);
    await expect(dialog.getByText('mistral-7b-local')).toBeVisible();

    // Observe the delete request so the test does not depend on the
    // modal's (key-mismatched) optimistic cache patch.
    const deleteRequest = page.waitForRequest(/\/api\/llm\/delete-model/);
    await dialog
      .getByRole('button', { name: 'Actions for mistral-7b-local' })
      .click();
    await page.getByRole('menuitem', { name: /Delete Model/ }).click();

    const confirm = page.getByRole('alertdialog');
    await expect(confirm.getByText('Delete Model')).toBeVisible();
    await confirm.getByRole('button', { name: 'Delete' }).click();
    await deleteRequest;

    await expect(
      page.getByText(/mistral-7b-local deleted/).first()
    ).toBeVisible();

    // The list refreshes on the next fetch: reopen and assert.
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole('button', { name: 'Open Model Manager' }).click();
    const reopened = page.getByRole('dialog');
    await expect(reopened.getByText('Manage Language Model')).toBeVisible();
    await expect(reopened.getByText('mistral-7b-local')).toHaveCount(0);
    await expect(reopened.getByText('qwen2.5-7b-instruct')).toBeVisible();
  });
});
