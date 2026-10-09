// packages/ui/tests/e2e/chat-stop.spec.ts
//
// E2E for the chat STOP / cancel-stream flow — the client-side abort +
// delayed `POST /api/llm/unload` workaround for the Elysia 1.2.25 SSE
// disconnect bug (see ChatInterface.handleCancelStream). Nothing
// exercised this path before: the happy-path specs complete in
// milliseconds, so the Cancel button never renders.
//
// The mocks hold streams containing the `__slow__` sentinel open for
// 8s (sessionChats.ts / standaloneChats.ts), giving the test time to
// observe the Cancel button, click it, and assert:
//   - the user message stays,
//   - the cancel button clears and the input is usable again,
//   - the delayed unload request fires.
//
// Reference: packages/ui/src/components/SessionView/Chat/
// ChatInterface.tsx:143-161.
import { test, expect, type Page } from '@playwright/test';

const SELECTED_LOCAL_MODEL = 'qwen2.5-7b-instruct';

async function loadLocalModel(page: Page): Promise<void> {
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
}

async function sendAndCancel(page: Page, message: string): Promise<void> {
  const chatInput = page.locator('[data-testid="chat-input"]:visible').first();
  await expect(chatInput).toBeEnabled();
  // Start listening for the delayed unload BEFORE clicking cancel —
  // the UI fires it 500ms after the abort.
  const unloadRequest = page.waitForRequest(/\/api\/llm\/unload/);
  await chatInput.fill(message);
  await chatInput.press('Enter');

  // The stream is held open by the mock, so the Cancel button renders.
  const cancelButton = page.getByRole('button', {
    name: 'Cancel AI response',
  });
  await expect(cancelButton).toBeVisible();
  await cancelButton.click();

  // The Elysia workaround: the client triggers the model unload.
  await unloadRequest;

  // Stream settled: cancel affordance gone, input usable again, and
  // the user's message was kept.
  await expect(cancelButton).toHaveCount(0);
  await expect(chatInput).toBeEnabled();
  await expect(page.getByText(message).first()).toBeVisible();
}

test.describe.serial('Chat STOP / cancel streaming', () => {
  test('cancels an in-flight session chat response and unloads', async ({
    page,
  }) => {
    await page.goto('/sessions/1');
    await loadLocalModel(page);
    await sendAndCancel(page, 'a slow session message __slow__');
  });

  test('cancels an in-flight standalone chat response and unloads', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /New Chat/ }).click();
    await page.waitForURL('**/chats/*');
    await loadLocalModel(page);
    await sendAndCancel(page, 'a slow standalone message __slow__');
  });
});
