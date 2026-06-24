// packages/ui/tests/e2e/templates.spec.ts
//
// E2E for the /templates page (TemplatesPage.tsx). Covers the four
// mutation flows that the page supports straight from the UI:
//
//   1. List renders the two seeded templates (one system prompt
//      + one user template).
//   2. Create a new user template via the "Create New Template"
//      button + EditEntityModal.
//   3. Edit an existing user template (the Pencil1Icon in its
//      card) and assert the new text persists.
//   4. Delete a user template via the trash button + AlertDialog.
//
// State isolation:
//   - The /api/templates handler reads from `e2eTemplates` in
//     handlers.ts. We reseed via /api/__e2e/reset in beforeEach
//     so the spec runs as a serial block in one worker and the
//     two seeded templates are guaranteed present.
//
// Reference: packages/ui/src/mocks/handlers.ts for the mock
// surface, packages/ui/src/components/TemplatesPage.tsx for the
// page, packages/ui/src/components/Shared/EditEntityModal.tsx for
// the create/edit modal shape.
import { test, expect } from '@playwright/test';

const SYSTEM_PROMPT_TITLE = 'Analyst';
const USER_TEMPLATE_TITLE = 'CBT reframing coach';
const NEW_TEMPLATE_TITLE = 'Mindfulness grounding';
const NEW_TEMPLATE_TEXT =
  'Walk the user through a 5-4-3-2-1 grounding exercise, then summarize which senses they engaged most strongly.';

test.describe.serial('Templates page CRUD', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(async () => {
      await fetch('/api/__e2e/reset', { method: 'POST' });
    });
    await page.goto('/templates');
  });

  test('renders the seeded system and user templates', async ({ page }) => {
    const main = page.locator('main');
    await expect(
      main.getByRole('heading', { name: 'Message Templates' })
    ).toBeVisible();
    // System prompts strip the "system_" prefix and title-case the
    // remainder (TemplatesPage.tsx:46-54).
    await expect(
      main.getByRole('heading', { name: SYSTEM_PROMPT_TITLE })
    ).toBeVisible();
    await expect(
      main.getByRole('heading', { name: USER_TEMPLATE_TITLE })
    ).toBeVisible();
  });

  test('creates a new user template', async ({ page }) => {
    const main = page.locator('main');
    await main.getByRole('button', { name: /Create New Template/ }).click();

    // EditEntityModal renders with a "Create New Template" title
    // (entityTypeLabel is "Template"). Fill the title + text inputs
    // and save.
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Create New Template')).toBeVisible();
    await dialog
      .getByPlaceholder('Enter a short, descriptive title')
      .fill(NEW_TEMPLATE_TITLE);
    await dialog
      .getByPlaceholder('Enter the template text...')
      .fill(NEW_TEMPLATE_TEXT);
    await dialog.getByRole('button', { name: /Save Changes/ }).click();

    // Toast + the new card title renders in the user templates grid.
    // `.first()` pins the toast assertion to the visible toast (the
    // same text is also mirrored in the aria-live region).
    await expect(
      page.getByText(/Template created successfully/).first()
    ).toBeVisible();
    await expect(
      main.getByRole('heading', { name: NEW_TEMPLATE_TITLE })
    ).toBeVisible();
  });

  test('edits an existing user template', async ({ page }) => {
    const main = page.locator('main');

    // The user template card has a Pencil1Icon IconButton at
    // TemplatesPage.tsx:308-314. We scope to the card with the
    // existing user template title to avoid clicking the system
    // prompt's edit button.
    const userCard = main
      .locator('article, [class*="rt-Card"]')
      .filter({ hasText: USER_TEMPLATE_TITLE });
    await userCard.getByRole('button').first().click();

    // The EditEntityModal opens with "Edit Template" title.
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Edit Template')).toBeVisible();

    // Append a recognizable suffix to the template text. The
    // TextArea is the multi-line field with the matching
    // placeholder.
    const textarea = dialog.getByPlaceholder('Enter the template text...');
    await textarea.fill(
      'Reframing coach (updated) — focus on all-or-nothing thinking.'
    );

    await dialog.getByRole('button', { name: /Save Changes/ }).click();

    await expect(
      page.getByText(/Template updated successfully/).first()
    ).toBeVisible();
    // The new text shows in the user template card body.
    await expect(main.getByText(/Reframing coach \(updated\)/)).toBeVisible();
  });

  test('deletes a user template', async ({ page }) => {
    const main = page.locator('main');

    // Pin the user template card and click its trash button
    // (TemplatesPage.tsx:315-322).
    const userCard = main
      .locator('article, [class*="rt-Card"]')
      .filter({ hasText: USER_TEMPLATE_TITLE });
    // The card has two IconButtons: edit (Pencil1Icon) + delete
    // (TrashIcon). The delete is the second one.
    const buttons = userCard.getByRole('button');
    await buttons.nth(1).click();

    // AlertDialog confirm.
    const dialog = page.getByRole('alertdialog');
    await expect(dialog.getByText(/Are you sure/)).toBeVisible();
    await dialog.getByRole('button', { name: /Delete/ }).click();

    // Toast + the user template card is gone (the system prompt
    // card remains). `.first()` pins the toast assertion to the
    // visible toast (the same text is also mirrored in the
    // aria-live region).
    await expect(
      page.getByText(/Template deleted successfully/).first()
    ).toBeVisible();
    await expect(
      main.getByRole('heading', { name: USER_TEMPLATE_TITLE })
    ).toHaveCount(0);
  });
});
