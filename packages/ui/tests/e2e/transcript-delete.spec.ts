// packages/ui/tests/e2e/transcript-delete.spec.ts
//
// E2E for transcript paragraph deletion, the destructive counterpart
// to transcript-edit.spec.ts (which only covers inline editing).
//
// Flow:
//   1. Open /sessions/1, hover the "anxious" paragraph, click the
//      "Delete paragraph" icon button.
//   2. Assert the "Delete Paragraph" AlertDialog shows the paragraph
//      text, confirm, and assert the paragraph is gone, the remaining
//      paragraphs stay, and the "Paragraph deleted successfully."
//      toast appears.
//   3. Cancel path: request deletion of another paragraph, cancel,
//      and assert nothing changed.
//
// Reference: packages/ui/src/components/SessionView/Transcription/
// Transcription.tsx (deleteParagraphMutation + confirm dialog) and
// packages/ui/src/mocks/handlers/sessions.ts (stateful DELETE).
import { test, expect } from '@playwright/test';
import { gotoAndResetMocks } from './helpers';

test.describe.serial('Transcript paragraph deletion', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAndResetMocks(page);
  });

  test('deletes a transcript paragraph after confirmation', async ({
    page,
  }) => {
    await page.goto('/sessions/1');
    await expect(page.getByText('I have been feeling anxious')).toBeVisible();

    const paragraph = page
      .locator('.group')
      .filter({ hasText: 'I have been feeling anxious' })
      .first();
    await paragraph.hover();
    await paragraph.getByRole('button', { name: 'Delete paragraph' }).click();

    // Confirm dialog quotes the paragraph under deletion.
    const dialog = page.getByRole('alertdialog');
    await expect(
      dialog.getByRole('heading', { name: 'Delete Paragraph' })
    ).toBeVisible();
    await expect(dialog.getByText(/I have been feeling anxious/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Delete Paragraph' }).click();

    // Toast + paragraph removed; siblings untouched.
    await expect(
      page.getByText('Paragraph deleted successfully.').first()
    ).toBeVisible();
    await expect(page.getByText('I have been feeling anxious')).toHaveCount(0);
    await expect(
      page.getByText('That sounds difficult. Let us explore that together.')
    ).toBeVisible();
  });

  test('canceling the delete dialog leaves the transcript intact', async ({
    page,
  }) => {
    await page.goto('/sessions/1');
    await expect(
      page.getByText('That sounds difficult. Let us explore that together.')
    ).toBeVisible();

    const paragraph = page
      .locator('.group')
      .filter({ hasText: 'That sounds difficult.' })
      .first();
    await paragraph.hover();
    await paragraph.getByRole('button', { name: 'Delete paragraph' }).click();

    const dialog = page.getByRole('alertdialog');
    await expect(
      dialog.getByRole('heading', { name: 'Delete Paragraph' })
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    // No toast, no deletion.
    await expect(page.getByText('Paragraph deleted successfully.')).toHaveCount(
      0
    );
    await expect(
      page.getByText('That sounds difficult. Let us explore that together.')
    ).toBeVisible();
    await expect(page.getByText('I have been feeling anxious')).toBeVisible();
  });
});
