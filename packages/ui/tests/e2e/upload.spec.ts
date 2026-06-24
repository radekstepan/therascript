import { test, expect } from '@playwright/test';

test.describe.serial('Upload Session', () => {
  test('uploads a new session successfully', async ({ page }) => {
    await page.goto('/');

    // Click "New Session" in the top toolbar
    await page.getByRole('button', { name: /New Session/ }).click();

    // Verify modal is open
    const dialog = page.getByRole('dialog').first();
    await expect(dialog.getByText('Upload New Session')).toBeVisible();

    // Fill out form
    await dialog.getByPlaceholder('e.g., Weekly Check-in').fill('Test Session');
    await dialog.getByPlaceholder("Client's Full Name").fill('John Doe');

    // Date input
    const dateInput = dialog.locator('input[type="date"]');
    await dateInput.fill('2026-06-25');

    // The input file is hidden
    const fileInput = dialog.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'test-audio.mp3',
      mimeType: 'audio/mpeg',
      buffer: Buffer.from('mock audio content'),
    });

    // Wait for the file to be parsed
    await expect(dialog.getByText(/Selected:.*test-audio\.mp3/)).toBeVisible();

    // Click Upload & Start
    await dialog.getByRole('button', { name: /Upload & Start/ }).click();

    // Should navigate to session view after completion
    await page.waitForURL('**/sessions/3');

    // Wait for transcript to load
    await expect(page.getByText('New session transcript.')).toBeVisible();
  });
});
