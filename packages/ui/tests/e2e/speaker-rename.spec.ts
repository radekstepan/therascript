// packages/ui/tests/e2e/speaker-rename.spec.ts
//
// E2E for renaming transcript speaker labels (RenameSpeakersModal +
// PATCH /api/sessions/:id/speakers) — previously the only transcript
// mutation path with no e2e coverage:
//
//   1. Open /sessions/1, open the "Transcription options" menu, pick
//      "Rename Speakers".
//   2. Rename the "Jane" label to "Client" and save.
//   3. Assert the success toast and that the refetched transcript shows
//      the new speaker badge (and no "Jane" badge remains).
//   4. Cancelling the modal leaves labels unchanged.
//
// State isolation:
//   - GET /api/sessions/1/transcript is served from the mutable
//     `e2eSession1Transcript` list; the speakers PATCH mutates it.
//     beforeEach posts /api/__e2e/reset to reseed the baseline.
//
// Reference: packages/ui/src/mocks/handlers/sessions.ts,
// packages/ui/src/components/SessionView/Transcription/RenameSpeakersModal.tsx,
// packages/ui/src/components/SessionView/Transcription/Transcription.tsx.
import { test, expect } from '@playwright/test';
import { gotoAndResetMocks } from './helpers';

test.describe.serial('Speaker rename', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAndResetMocks(page);
  });

  test('renames a speaker label via the transcription options menu', async ({
    page,
  }) => {
    await page.goto('/sessions/1');

    // Transcript fixture renders.
    await expect(page.getByText('I have been feeling anxious')).toBeVisible();
    await expect(page.getByText('Jane', { exact: true }).first()).toBeVisible();

    // Open Transcription options → Rename Speakers.
    await page.getByRole('button', { name: 'Transcription options' }).click();
    await page.getByRole('menuitem', { name: /Rename Speakers/ }).click();

    // The modal lists one TextField per detected label (placeholder =
    // original). Rename "Jane" → "Client", leave "Therapist" alone.
    const dialog = page.getByRole('dialog').first();
    await expect(dialog.getByText('Rename Speakers')).toBeVisible();
    await dialog.getByPlaceholder('Jane').fill('Client');
    await dialog.getByRole('button', { name: 'Save' }).click();

    // Success toast; the modal closes and the transcript refetches.
    await expect(
      page.getByText('Speaker labels updated successfully.').first()
    ).toBeVisible();
    await expect(
      page.getByText('Client', { exact: true }).first()
    ).toBeVisible();
    await expect(page.getByText('Jane', { exact: true })).toHaveCount(0);
  });

  test('cancelling the modal leaves speaker labels unchanged', async ({
    page,
  }) => {
    await page.goto('/sessions/1');
    await expect(page.getByText('I have been feeling anxious')).toBeVisible();

    await page.getByRole('button', { name: 'Transcription options' }).click();
    await page.getByRole('menuitem', { name: /Rename Speakers/ }).click();

    const dialog = page.getByRole('dialog').first();
    await expect(dialog.getByText('Rename Speakers')).toBeVisible();
    await dialog.getByPlaceholder('Jane').fill('Someone Else');
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    // No toast, no refetch: the original badge is still there and no
    // "Someone Else" badge appeared.
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Jane', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Someone Else', { exact: true })).toHaveCount(
      0
    );
  });
});
