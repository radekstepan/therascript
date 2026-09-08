// packages/ui/tests/e2e/session-chat-failure.spec.ts
//
// E2E for the session-chat backend-failure path. The existing
// session-chat.spec.ts only covers the happy path (chunks + done).
// Here the mock streams an SSE `{ error }` event (triggered by a
// sentinel message), exercising the client's `Chat Error:` toast path
// in ChatInterface.
//
// Flow:
//   1. Open /sessions/1, load a local model via Configure AI Model.
//   2. Send a message containing the `__trigger_error__` sentinel.
//   3. Assert the "Chat Error: Mock LLM failure" toast appears and no
//      AI bubble with response text is left behind.
//
// Reference: packages/ui/src/mocks/handlers/sessionChats.ts (sentinel),
// packages/ui/src/components/SessionView/Chat/ChatInterface.tsx
// (`data.error` → `Chat Error:` toast + empty-bubble cleanup).
import { test, expect } from '@playwright/test';

const SELECTED_LOCAL_MODEL = 'qwen2.5-7b-instruct';

test.describe.serial('Session chat backend failure', () => {
  test('shows a Chat Error toast when the stream emits an error event', async ({
    page,
  }) => {
    await page.goto('/sessions/1');

    // ---- Load a local model (minimal ceremony) ----------------------
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

    // ---- Send the failure-triggering message -------------------------
    const chatInput = page
      .locator('[data-testid="chat-input"]:visible')
      .first();
    await expect(chatInput).toBeEnabled();
    await chatInput.fill('please __trigger_error__ now');
    await chatInput.press('Enter');

    // Backend `{ error }` SSE event → "Chat Error:" toast. `.first()`
    // pins the assertion to the visible toast (mirrored in aria-live).
    await expect(
      page.getByText(/Chat Error: Mock LLM failure/).first()
    ).toBeVisible();

    // The failed turn leaves no AI response bubble behind.
    await expect(
      page
        .locator('.markdown-ai-message:visible')
        .getByText('Hello from the mock LLM', { exact: false })
    ).toHaveCount(0);
  });
});
