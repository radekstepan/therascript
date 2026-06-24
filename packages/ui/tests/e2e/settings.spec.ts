import { test, expect } from '@playwright/test';

test.describe.serial('Settings Page', () => {
  test('renders settings page and performs basic interactions', async ({
    page,
  }) => {
    await page.goto('/');

    // Go to settings
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.waitForURL('**/settings');

    await expect(
      page.getByRole('heading', { name: 'Application Settings' })
    ).toBeVisible();

    // Test Markdown toggle
    const mdToggle = page.getByRole('switch', {
      name: 'Toggle Markdown rendering for AI responses',
    });
    await expect(mdToggle).toBeVisible();
    await mdToggle.click();

    // Test Accent Color picker
    const accentButton = page.getByRole('button', {
      name: 'Set accent to Ruby',
    });
    await expect(accentButton).toBeVisible();
    await accentButton.click();

    // Open Data Management modal
    const reindexButton = page.getByRole('button', { name: 'Re-index Search' });
    await expect(reindexButton).toBeVisible();
    await reindexButton.click();

    const dialog = page.getByRole('alertdialog');
    await expect(dialog.getByText('Confirm Re-index').first()).toBeVisible();

    await dialog.getByRole('button', { name: 'Confirm Re-index' }).click();

    // Expect success toast
    await expect(page.getByText(/Elasticsearch Re-index/)).toBeVisible();
  });
});
