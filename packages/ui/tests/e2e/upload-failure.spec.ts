// packages/ui/tests/e2e/upload-failure.spec.ts
//
// E2E for the upload failure path — the 503 diarization-not-ready gate
// in particular (POST /api/sessions/upload → 503 +
// "Diarization is not ready…"). The existing upload.spec.ts only covers
// the 202 happy path.
//
//   1. Inject a 503 upload error via POST /api/__e2e/set-upload-error.
//   2. Fill the Upload modal and submit; assert the red alert callout
//      shows "Upload failed" and the app does NOT navigate away.
//   3. Clear the injection and assert the same form then succeeds
//      (regression guard: the error state does not poison the modal).
//
// State isolation: serial block + /api/__e2e/reset in beforeEach (which
// also clears the injected upload error).
//
// Reference: packages/ui/src/mocks/handlers/sessions.ts (upload
// handler + e2eUploadError), packages/ui/src/mocks/handlers/e2e.ts,
// packages/ui/src/components/UploadModal/UploadModal.tsx.
import { test, expect } from '@playwright/test';
import { gotoAndResetMocks } from './helpers';

const DIARIZATION_503_MESSAGE =
  'Diarization is not ready in the Whisper service. A background download may have been started — please retry in a few minutes.';

async function fillUploadForm(page) {
  await page.goto('/');
  await page.getByRole('button', { name: /New Session/ }).click();
  const dialog = page.getByRole('dialog').first();
  await expect(dialog.getByText('Upload New Session')).toBeVisible();
  await dialog.getByPlaceholder('e.g., Weekly Check-in').fill('Test Session');
  await dialog.getByPlaceholder("Client's Full Name").fill('John Doe');
  await dialog.locator('input[type="date"]').fill('2026-06-25');
  await dialog.locator('input[type="file"]').setInputFiles({
    name: 'test-audio.mp3',
    mimeType: 'audio/mpeg',
    buffer: Buffer.from('mock audio content'),
  });
  await expect(dialog.getByText(/Selected:.*test-audio\.mp3/)).toBeVisible();
  return dialog;
}

test.describe.serial('Upload failure (diarization not ready)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAndResetMocks(page);
  });

  test('shows the 503 error and stays on the upload modal', async ({
    page,
  }) => {
    const dialog = await fillUploadForm(page);

    // Inject AFTER fillUploadForm: its page.goto('/') is a full reload
    // and MSW handlers run in the page context, so module-level
    // `e2eUploadError` is reset by any navigation (see the localStorage
    // note for readiness in src/mocks/state.ts).
    await page.evaluate(async (message: string) => {
      await fetch('/api/__e2e/set-upload-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 503, message }),
      });
    }, DIARIZATION_503_MESSAGE);

    await dialog.getByRole('button', { name: /Upload & Start/ }).click();

    // Red alert callout with the failure; no navigation to a session.
    await expect(dialog.getByRole('alert')).toContainText(/Upload failed/);
    await expect(page).not.toHaveURL(/\/sessions\/3/);
    await expect(dialog.getByText('Upload New Session')).toBeVisible();
  });

  test('succeeds once the backend recovers', async ({ page }) => {
    // Fail once, then clear the injection and resubmit the same form.
    // Inject AFTER fillUploadForm (see above): the form helper's
    // page.goto('/') reloads the page and would wipe the injection.
    const dialog = await fillUploadForm(page);
    await page.evaluate(async (message: string) => {
      await fetch('/api/__e2e/set-upload-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 503, message }),
      });
    }, DIARIZATION_503_MESSAGE);

    await dialog.getByRole('button', { name: /Upload & Start/ }).click();
    await expect(dialog.getByRole('alert')).toContainText(/Upload failed/);

    await page.evaluate(async () => {
      await fetch('/api/__e2e/set-upload-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
    });
    await dialog.getByRole('button', { name: /Upload & Start/ }).click();

    await page.waitForURL('**/sessions/3');
    await expect(page.getByText('New session transcript.')).toBeVisible();
  });
});
