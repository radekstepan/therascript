import { test, expect } from '@playwright/test';

test.describe.serial('Standalone chat end-to-end', () => {
  test('creates a standalone chat, changes model, and sends a message', async ({
    page,
  }) => {
    await page.goto('/');

    // Click "New Chat" in the top toolbar
    await page.getByRole('button', { name: /New Chat/ }).click();

    // Wait to navigate to the new chat
    await page.waitForURL('**/chats/*');

    // Let's set a model first so it can respond.
    const configureButton = page.getByTitle('Configure AI Model').first();
    await expect(configureButton).toBeVisible();
    await configureButton.click();

    const dialog = page.getByRole('dialog').first();
    await expect(dialog.getByText('Configure AI Model')).toBeVisible();

    const modelCombobox = dialog.getByRole('combobox');
    await modelCombobox.click();
    await page.getByRole('option', { name: /qwen2\.5-7b-instruct/ }).click();

    await dialog.getByRole('button', { name: /Save & Load Model/ }).click();

    // Select the chat input
    const chatInput = page
      .locator('[data-testid="chat-input"]:visible')
      .first();
    await expect(chatInput).toBeEnabled();

    // Type a message
    await chatInput.fill('Hello standalone');
    await chatInput.press('Enter');

    // Expected response
    await expect(page.getByText('Hello standalone').first()).toBeVisible();

    const aiResponse = page
      .locator('.markdown-ai-message:visible')
      .getByText('Hello from standalone mock LLM', { exact: false })
      .first();
    await expect(aiResponse).toBeVisible();
  });
});
