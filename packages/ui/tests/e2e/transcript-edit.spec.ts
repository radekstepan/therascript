import { test, expect } from '@playwright/test';

test.describe.serial('Transcript Editing', () => {
  test('edits a transcript paragraph', async ({ page }) => {
    await page.goto('/sessions/1');

    // Wait for transcript to load
    await expect(page.getByText('I have been feeling anxious')).toBeVisible();

    // Hover over the paragraph to show the edit button. The `.group` Flex
    // is the visible container; once editing starts a second `.group`
    // renders with `visibility: hidden`, so .first() pins the locator to
    // the visible row.
    const paragraph = page
      .locator('.group')
      .filter({ hasText: 'I have been feeling anxious' })
      .first();
    await paragraph.hover();

    // Click edit
    await paragraph.getByRole('button', { name: 'Edit paragraph' }).click();

    // The editing overlay is rendered as a sibling of `.group` (not
    // nested), so we look up the textarea by its aria-label rather than
    // scoping it to the paragraph locator.
    const textarea = page.getByLabel('Edit paragraph 1');
    await textarea.fill('I have been feeling VERY anxious');

    // Click Save — the button is also inside the overlay, so look it up
    // by its accessible name on the page (visible only when editing).
    await page.getByRole('button', { name: 'Save' }).click();

    // Expect the new text to be visible
    await expect(
      page.getByText('I have been feeling VERY anxious')
    ).toBeVisible();
  });
});
