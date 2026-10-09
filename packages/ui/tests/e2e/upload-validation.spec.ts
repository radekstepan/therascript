// packages/ui/tests/e2e/upload-validation.spec.ts
//
// E2E for the UploadModal validation paths that upload.spec.ts skips
// on its way to the happy path: no-file gating, invalid file-type
// rejection, required-field errors, and the Number-of-Speakers select.
//
// Flow:
//   1. Open "New Session": "Upload & Start" is disabled with no file.
//      Attaching a .txt file surfaces the invalid-type callout.
//      Attaching an .mp3 enables the button; submitting with the
//      client name missing surfaces the required-fields callout;
//      filling it completes the upload to /sessions/3.
//   2. The speakers select defaults to "Off (no speaker detection)",
//      switching to "3 speakers" sticks, and the upload still
//      succeeds end to end.
//
// Reference: packages/ui/src/components/UploadModal/UploadModal.tsx
// (handleFileSelection, handleStartClick).
import { test, expect, type Page, type Locator } from '@playwright/test';
import { gotoAndResetMocks } from './helpers';

test.describe.serial('Upload modal validation', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAndResetMocks(page);
  });

  async function openUploadModal(page: Page): Promise<Locator> {
    await page.goto('/');
    await page.getByRole('button', { name: /New Session/ }).click();
    const dialog = page.getByRole('dialog').first();
    await expect(dialog.getByText('Upload New Session')).toBeVisible();
    return dialog;
  }

  test('gates on file, rejects non-audio, and requires client name', async ({
    page,
  }) => {
    const dialog = await openUploadModal(page);
    const uploadButton = dialog.getByRole('button', {
      name: /Upload & Start/,
    });

    // No file → cannot submit.
    await expect(uploadButton).toBeDisabled();

    const fileInput = dialog.locator('input[type="file"]');

    // Non-audio file → invalid-type callout, still disabled.
    await fileInput.setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('not audio'),
    });
    await expect(dialog.getByText(/Invalid file type/)).toBeVisible();
    await expect(uploadButton).toBeDisabled();

    // Valid audio → selected, button enabled. The filename has no
    // dash so the modal does NOT auto-fill the client name (see
    // handleFileSelection) — it stays missing for the next step.
    await fileInput.setInputFiles({
      name: 'testaudio.mp3',
      mimeType: 'audio/mpeg',
      buffer: Buffer.from('mock audio content'),
    });
    await expect(dialog.getByText(/Selected:.*testaudio\.mp3/)).toBeVisible();
    await expect(uploadButton).toBeEnabled();

    // Session name auto-fills from the filename and the date defaults
    // to today, so only the client name is missing.
    await uploadButton.click();
    await expect(
      dialog.getByText(/Please fill in all required fields: Client Name/)
    ).toBeVisible();
    await expect(page).not.toHaveURL(/\/sessions\/3/);

    await dialog.getByPlaceholder("Client's Full Name").fill('John Doe');
    await uploadButton.click();
    await page.waitForURL('**/sessions/3');
    await expect(page.getByText('New session transcript.')).toBeVisible();
  });

  test('number-of-speakers selection sticks through a successful upload', async ({
    page,
  }) => {
    const dialog = await openUploadModal(page);

    // The speakers Select.Trigger is the combobox showing the current
    // choice; the other two comboboxes are Session Type / Therapy.
    const speakersSelect = dialog
      .getByRole('combobox')
      .filter({ hasText: /Off \(no speaker detection\)|speakers/ });
    await expect(speakersSelect).toBeVisible();
    await speakersSelect.click();
    await page.getByRole('option', { name: '3 speakers' }).click();
    await expect(
      dialog.getByRole('combobox').filter({ hasText: '3 speakers' })
    ).toBeVisible();

    await dialog.getByPlaceholder('e.g., Weekly Check-in').fill('Test Session');
    await dialog.getByPlaceholder("Client's Full Name").fill('John Doe');
    await dialog.locator('input[type="date"]').fill('2026-06-25');
    await dialog.locator('input[type="file"]').setInputFiles({
      name: 'test-audio.mp3',
      mimeType: 'audio/mpeg',
      buffer: Buffer.from('mock audio content'),
    });
    await expect(dialog.getByText(/Selected:.*test-audio\.mp3/)).toBeVisible();
    await dialog.getByRole('button', { name: /Upload & Start/ }).click();

    await page.waitForURL('**/sessions/3');
    await expect(page.getByText('New session transcript.')).toBeVisible();
  });
});
