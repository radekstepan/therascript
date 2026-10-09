// packages/ui/tests/e2e/starred-templates.spec.ts
//
// E2E for inserting a message template into the chat input via the
// star-button popover (StarredTemplatesList). TemplatesPage CRUD was
// covered, but the cross-feature "use a template in chat" workflow —
// the actual reason templates exist — had no coverage.
//
// Flow:
//   1. Open /sessions/1, load a local model (the star button is
//      disabled until the model is ready).
//   2. Click "Show templates"; assert the user template
//      ("CBT reframing coach") is listed while the system template
//      ("system_analyst") is filtered out.
//   3. Click the template and assert the chat input is prefilled with
//      its text.
//
// Reference: packages/ui/src/components/SessionView/Chat/ChatInput.tsx
// (star button + handleSelectTemplate) and StarredTemplatesList.tsx.
import { test, expect } from '@playwright/test';

const SELECTED_LOCAL_MODEL = 'qwen2.5-7b-instruct';
const TEMPLATE_TITLE = 'CBT reframing coach';
const TEMPLATE_TEXT =
  'Help the user identify cognitive distortions and propose reframes.';

test.describe.serial('Starred template insert into chat', () => {
  test('inserts a user template into the chat input', async ({ page }) => {
    await page.goto('/sessions/1');

    // Load a local model so the template star button enables.
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

    // Open the templates popover from the visible chat input row.
    const showTemplates = page
      .getByRole('button', { name: 'Show templates' })
      .first();
    await expect(showTemplates).toBeEnabled();
    await showTemplates.click();

    // User templates listed; system_ templates filtered out.
    await expect(page.getByText('Templates').first()).toBeVisible();
    await expect(
      page.getByRole('button', { name: TEMPLATE_TITLE })
    ).toBeVisible();
    await expect(page.getByText('system_analyst')).toHaveCount(0);

    // Insert and assert the input value.
    await page.getByRole('button', { name: TEMPLATE_TITLE }).click();
    const chatInput = page
      .locator('[data-testid="chat-input"]:visible')
      .first();
    await expect(chatInput).toHaveValue(TEMPLATE_TEXT);
  });
});
