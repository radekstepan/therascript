// packages/ui/tests/e2e/session-chat.spec.ts
//
// E2E flow for chatting with a session transcript. Covers the full
// model-selection → send-message happy path:
//
//   1. Open the "Configure AI Model" dialog from the chat panel header.
//   2. Confirm the local and remote model lists are disjoint (the user
//      asked to verify this explicitly).
//   3. Pick a local model and save & load it.
//   4. Assert the active model name appears in the top right of the
//      chat panel header (the ChatPanelHeader model-name Text).
//   5. Send a message; assert:
//        - the optimistic user bubble appears in the chat list
//        - the streamed AI response text appears
//        - the bubble's tokens/s metric renders
//        - the chat panel's context progress bar is visible
//
// State isolation:
//   - The MSW handlers in src/mocks/handlers.ts hold the LLM "active
//     model" in module-level mutable state (mockActiveModel /
//     mockModelLoaded). This spec uses `test.describe.serial` so the
//     state transitions are well-ordered inside a single worker.
//
// Reference: packages/ui/src/mocks/handlers.ts for the mock surface,
// packages/ui/src/components/SessionView/Chat/ChatPanelHeader.tsx for
// the "top right" model name + context progress, and
// packages/ui/src/components/SessionView/Chat/ChatMessageBubble.tsx
// for the bubble + tokens/s metric.
import { test, expect } from '@playwright/test';

const SELECTED_LOCAL_MODEL = 'qwen2.5-7b-instruct';
const REMOTE_URL = 'http://mock-remote:1234';

test.describe.serial('Session chat with model selection', () => {
  test('selects a local model after verifying local/remote lists differ and sends a chat message', async ({
    page,
  }) => {
    // ---- 1. Open the session view --------------------------------------
    await page.goto('/sessions/1');

    // Wait for the chat panel to mount. SessionView redirects to
    // /sessions/1/chats/10 once the session meta loads, and the
    // ChatPanelHeader (which contains the "Configure AI Model" button)
    // only renders once a chat is active. `.first()` disambiguates
    // from the second SelectActiveModelModal instance rendered inside
    // ChatInput (its trigger is a hidden title-bearing element used
    // for accessibility labelling).
    const configureButton = page.getByTitle('Configure AI Model').first();
    await expect(configureButton).toBeVisible();
    await configureButton.click();

    // ---- 2. Inspect the local model list -------------------------------
    // The dialog heading distinguishes it from other Radix Dialogs.
    // Both SessionView and ChatInput render their own
    // SelectActiveModelModal instance, so the page has two dialogs in
    // the DOM. The one we want is the first (SessionView's), which is
    // the one the user just opened by clicking the panel header button.
    const dialog = page.getByRole('dialog').first();
    await expect(dialog.getByText('Configure AI Model')).toBeVisible();

    // The "Local Machine" segment is the default. Open the model Select
    // (the only combobox inside this dialog) and read its options.
    const modelCombobox = dialog.getByRole('combobox');
    await modelCombobox.click();
    const localOptions = await page.getByRole('option').allTextContents();
    expect(localOptions.length).toBeGreaterThan(0);
    // Escape closes the Radix Select without selecting anything.
    await page.keyboard.press('Escape');

    // ---- 3. Switch to remote and verify the lists differ ----------------
    await dialog.getByText('Remote Machine').first().click();
    const remoteUrlField = dialog.getByPlaceholder('http://192.168.1.100:1234');
    await remoteUrlField.fill(REMOTE_URL);
    // Debounce in LlmEndpointModelPicker is 500ms; allow it to elapse
    // and the query to settle before re-opening the Select.
    await page.waitForTimeout(700);

    await modelCombobox.click();
    const remoteOptions = await page.getByRole('option').allTextContents();
    expect(remoteOptions.length).toBeGreaterThan(0);
    await page.keyboard.press('Escape');

    // The "list of models available locally and remote is different" check.
    expect(new Set(localOptions)).not.toEqual(new Set(remoteOptions));

    // ---- 4. Switch back to local and pick a model ---------------------
    await dialog.getByText('Local Machine').first().click();
    // Allow the picker to re-fetch the local list.
    await page.waitForTimeout(300);

    await modelCombobox.click();
    await page
      .getByRole('option', { name: new RegExp(SELECTED_LOCAL_MODEL) })
      .click();
    // Clicking an option auto-closes the Radix Select.

    // The footer button is "Save & Load Model" (only shown when the
    // model is not currently loaded).
    await dialog.getByRole('button', { name: /Save & Load Model/ }).click();

    // ---- 5. Assert the model name is in the top right ------------------
    // The ChatPanelHeader surfaces the active model name via a
    // <Text title={activeModel}> on the right side of the panel. This
    // is the "model name in the top right" the spec is asking for.
    // `.first()` disambiguates from any duplicate title-bearing
    // elements (e.g. the ChatInput's own modal trigger).
    const modelName = page.getByTitle(SELECTED_LOCAL_MODEL).first();
    await expect(modelName).toBeVisible();

    // ---- 6. Send a message and assert the streamed response ------------
    // `[data-testid="chat-input"]` is set on the input inside both the
    // side-by-side and the tabbed-layout ChatInterface instances. We
    // pick the visible one explicitly with `:visible` (Playwright
    // matches the hidden tabbed-layout copy otherwise) so a future
    // DOM-order change cannot silently target the wrong input.
    const chatInput = page
      .locator('[data-testid="chat-input"]:visible')
      .first();
    await expect(chatInput).toBeEnabled();
    await chatInput.fill('Hi there');
    await chatInput.press('Enter');

    // Optimistic user message is appended to the chat query cache in
    // ChatInterface.onMutate. We assert on the bubble text directly —
    // the user bubble uses the un-marked Text variant, so getByText
    // with the exact message string is unambiguous.
    await expect(page.getByText('Hi there').first()).toBeVisible();

    // The MSW stream emits two chunks followed by a done event; the
    // concatenated AI bubble text is "Hello from the mock LLM".
    // `:visible` again disambiguates from the hidden tabbed-layout
    // copy, and the messages mock accumulates into mockChatMessages
    // so the post-stream invalidateQueries refetch does not clobber
    // the optimistic insert + streamed response.
    const aiResponse = page
      .locator('.markdown-ai-message:visible')
      .getByText('Hello from the mock LLM', { exact: false })
      .first();
    await expect(aiResponse).toBeVisible();

    // The bubble's metrics row renders completion + tokens/s once the
    // stream reports completionTokens + duration. With our mock
    // (24 completion tokens over 1200ms) the row reads
    // "24 tokens (20.0 tokens/s)".
    await expect(
      page.getByText(/24 tokens \(20\.0 tokens\/s\)/).first()
    ).toBeVisible();

    // The ChatPanelHeader's context progress bar (role=progressbar)
    // renders when the active model is loaded and the context usage
    // query returns a percentage.
    const progressBar = page.locator('[role=progressbar]:visible').first();
    await expect(progressBar).toBeVisible();
  });
});
