// packages/ui/tests/e2e/standalone-chat-failure.spec.ts
//
// E2E for the standalone-chat backend-failure path. This mirrors
// session-chat-failure.spec.ts: the session variant had SSE `{ error }`
// coverage while the standalone stream had none, even though both go
// through the same ChatInterface `Chat Error:` toast path with
// different mock handlers.
//
// Flow:
//   1. Create a standalone chat via "New Chat", load a local model.
//   2. Send a message containing the `__trigger_error__` sentinel.
//   3. Assert the "Chat Error: Mock LLM failure" toast appears and no
//      AI bubble with response text is left behind.
//
// Reference: packages/ui/src/mocks/handlers/standaloneChats.ts
// (sentinel branch).
import { test, expect } from '@playwright/test';

const SELECTED_LOCAL_MODEL = 'qwen2.5-7b-instruct';

test.describe.serial('Standalone chat backend failure', () => {
  test('shows a Chat Error toast when the stream emits an error event', async ({
    page,
  }) => {
    await page.goto('/');

    // Create a fresh standalone chat.
    await page.getByRole('button', { name: /New Chat/ }).click();
    await page.waitForURL('**/chats/*');

    // Load a local model (same minimal ceremony as the session
    // failure spec).
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

    // Send the failure-triggering message.
    const chatInput = page
      .locator('[data-testid="chat-input"]:visible')
      .first();
    await expect(chatInput).toBeEnabled();
    await chatInput.fill('please __trigger_error__ now');
    await chatInput.press('Enter');

    await expect(
      page.getByText(/Chat Error: Mock LLM failure/).first()
    ).toBeVisible();

    // The failed turn leaves no AI response bubble behind.
    await expect(
      page
        .locator('.markdown-ai-message:visible')
        .getByText('Hello from standalone mock LLM', { exact: false })
    ).toHaveCount(0);
  });
});
