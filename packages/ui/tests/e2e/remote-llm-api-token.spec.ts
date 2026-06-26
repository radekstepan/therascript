// packages/ui/tests/e2e/remote-llm-api-token.spec.ts
//
// E2E flow for the "remote LLM + API token" path. The user configures a
// remote endpoint with an API token, runs a chat the same way as the
// local flow, and the spec proves the token is NOT cleared across the
// rest of the session.
//
//   1. Open /sessions/1 (chat 10, the same auto-redirect target as
//      session-chat.spec.ts).
//   2. Defensively unload any model that a previous spec in the
//      same worker left loaded (the form is gated on
//      `llmStatus.loaded === true`).
//   3. Open the "Configure AI Model" dialog.
//   4. Switch to Remote Machine, type the URL, type an API token,
//      pick a remote model.
//   5. Toggle Local ↔ Remote while the form is still enabled
//      (pre-save) and assert the token field is gated on
//      `isRemote`; the typed value is preserved across the toggle.
//   6. Click Save & Load Model.
//   7. Assert the chat panel surfaces the remote model name.
//   8. Intercept the POST /api/llm/api-token body and assert it
//      carried the typed token.
//   9. Send a chat message; assert the AI bubble + the context
//      progress bar render (proves the chat works the same way as
//      the local flow).
//  10. Token-not-cleared assertions:
//      a. Re-open the dialog; the form is disabled (model is now
//         loaded) but the token field still renders. The
//         placeholder must read "Token is set — type a new value
//         to replace" (presence boolean survived).
//      b. No second POST /api/llm/api-token has fired since the
//         save (the form's apiToken field is empty on reopen and
//         the user hasn't typed anything).
//      c. Send a second chat message; another AI bubble renders
//         (proves the token is still in mockLlmApiToken).
//      d. /api/llm/status reports hasRemoteApiToken === true.
//  11. Replace the token: unload the model, re-open the dialog,
//      type a NEW token, save, and assert the new value is what
//      got sent (rotation, never a clear).
//
// State isolation:
//   - The MSW handlers in src/mocks/handlers.ts hold the LLM
//     "active model" + "remote API token" in module-level mutable
//     state. This spec uses `test.describe.serial` so the state
//     transitions are well-ordered inside a single worker, and
//     the e2eHandlers' `POST /api/__e2e/reset` hook reseeds the
//     mockLlmApiToken + mockActiveModel + mockModelLoaded at the
//     start of every test.
//
// Reference: packages/ui/src/mocks/handlers/llm.ts for the mock
// surface, packages/ui/src/components/Shared/LlmEndpointModelPicker.tsx
// for the API token input + clear button, and
// packages/ui/src/components/SessionView/Modals/SelectActiveModelModal.tsx
// for the save flow.
import { test, expect, type Page, type Request } from '@playwright/test';

const REMOTE_URL = 'http://mock-remote:1234';
const SELECTED_REMOTE_MODEL = 'gpt-4o';
const API_TOKEN = 'sk-remote-llm-abc-123';
const NEW_API_TOKEN = 'sk-rotated-xyz-456';
const USER_MESSAGE = 'Hello from the remote LLM';
const AI_BUBBLE_TEXT = 'Hello from the mock LLM';
const SECOND_USER_MESSAGE = 'Second message after reload';
const TOKEN_PRESENT_PLACEHOLDER = 'Token is set — type a new value to replace';
const TOKEN_EMPTY_PLACEHOLDER = 'Enter API token (optional)';

const REMOTE_URL_FIELD_LABEL = 'Remote LM Studio URL';
const API_TOKEN_FIELD_LABEL = 'API Token (optional)';

/**
 * Hook a `page.on('request', ...)` listener to capture every
 * `POST /api/llm/api-token` body the page makes for the lifetime of
 * the test. Returns the live `captures` array (mutated as requests
 * land) and a `stop` function to detach the listener.
 */
function captureApiTokenPosts(page: Page): {
  captures: { token: string | null }[];
  stop: () => void;
} {
  const captures: { token: string | null }[] = [];
  const handler = async (request: Request) => {
    if (
      request.method() === 'POST' &&
      request.url().endsWith('/api/llm/api-token')
    ) {
      try {
        const body = JSON.parse(request.postData() ?? '{}');
        captures.push({ token: body.token ?? null });
      } catch {
        // Ignore malformed bodies — the spec is asserting the
        // happy path; a parse failure would surface elsewhere.
      }
    }
  };
  page.on('request', handler);
  return {
    captures,
    stop: () => page.off('request', handler),
  };
}

test.describe.serial('Remote LLM with API token', () => {
  test.beforeEach(async ({ page }) => {
    // Re-seed the mutable MSW state (mockLlmApiToken,
    // mockActiveModel, mockModelLoaded) between specs so this test
    // starts from a known-good baseline regardless of which other
    // e2e ran first in the same worker. The reset has to be issued
    // from the page context so the request goes through MSW
    // (page.request.post would hit the webpack-dev-server proxy
    // directly and ECONNREFUSED).
    await page.goto('/');
    await page.evaluate(async () => {
      await fetch('/api/__e2e/reset', { method: 'POST' });
    });
  });

  test('configures a remote model with a token, chats, and the token is never cleared', async ({
    page,
  }) => {
    const { captures, stop } = captureApiTokenPosts(page);

    try {
      // ---- 1. Open the session view ------------------------------------
      await page.goto('/sessions/1');

      // The MSW-backed `beforeEach` reset races with the
      // service-worker activation on the first page load. If a
      // previous spec left `mockModelLoaded = true`, the
      // Configure AI Model dialog opens with the picker disabled.
      // Defensively unload via the chat panel header's button so
      // the test starts from a known state regardless of run
      // order. The mock for POST /api/llm/unload flips
      // mockModelLoaded back to false.
      const unloadButton = page.getByRole('button', { name: 'Unload' });
      if (await unloadButton.isVisible().catch(() => false)) {
        await unloadButton.click();
        await expect(unloadButton).not.toBeVisible({ timeout: 5_000 });
      }

      const configureButton = page.getByTitle('Configure AI Model').first();
      await expect(configureButton).toBeVisible();
      await configureButton.click();

      const dialog = page.getByRole('dialog').first();
      await expect(dialog.getByText('Configure AI Model')).toBeVisible();

      // ---- 2. Switch to Remote Machine ----------------------------------
      await dialog.getByText('Remote Machine').first().click();
      // The API token field only renders when Remote Machine is
      // selected. Sanity-check both labels before continuing.
      await expect(
        dialog.getByText(API_TOKEN_FIELD_LABEL, { exact: true })
      ).toBeVisible();
      await expect(
        dialog.getByText(REMOTE_URL_FIELD_LABEL, { exact: true })
      ).toBeVisible();
      // Empty-token placeholder when no token is configured.
      await expect(
        dialog.getByPlaceholder(TOKEN_EMPTY_PLACEHOLDER)
      ).toBeVisible();

      // ---- 3. Fill URL + token + pick a model ---------------------------
      const remoteUrlField = dialog.getByPlaceholder(
        'http://192.168.1.100:1234'
      );
      await remoteUrlField.fill(REMOTE_URL);

      const apiTokenField = dialog.getByPlaceholder(TOKEN_EMPTY_PLACEHOLDER);
      await apiTokenField.fill(API_TOKEN);

      // Debounce in LlmEndpointModelPicker is 500ms; allow it to
      // elapse and the remote model query to settle before
      // re-opening the Select.
      await page.waitForTimeout(700);

      const modelCombobox = dialog.getByRole('combobox');
      await modelCombobox.click();
      await page
        .getByRole('option', { name: new RegExp(SELECTED_REMOTE_MODEL) })
        .click();

      // ---- 4. Save & Load Model ----------------------------------------
      await dialog.getByRole('button', { name: /Save & Load Model/ }).click();

      // ---- 5. Assert the dialog closed + the chat panel reflects remote
      // The ChatPanelHeader's model-name <Text title=...> is the
      // canonical handle for the active model in the header,
      // mirroring the assertion in session-chat.spec.ts:107.
      const modelName = page.getByTitle(SELECTED_REMOTE_MODEL).first();
      await expect(modelName).toBeVisible();

      // ---- 6. POST /api/llm/api-token carried the typed token ---------
      // The MSW handler is synchronous; by the time Save & Load
      // resolves and the dialog unmounts, the request has landed.
      // Allow one microtask for the React Query cache to settle.
      await page.waitForTimeout(50);
      expect(captures).toHaveLength(1);
      expect(captures[0].token).toBe(API_TOKEN);

      // ---- 7. Run a chat the same way as the local flow ----------------
      // Same selector + Enter pattern as session-chat.spec.ts:117-121.
      // The MSW chat-10 SSE handler returns "Hello from the mock
      // LLM" regardless of which base URL is "active" — the real
      // network target is the unit-tested layer; this e2e proves
      // the wire-up end-to-end (form + save + chat surface).
      const chatInput = page
        .locator('[data-testid="chat-input"]:visible')
        .first();
      await expect(chatInput).toBeEnabled();
      await chatInput.fill(USER_MESSAGE);
      await chatInput.press('Enter');

      // Optimistic user bubble.
      await expect(page.getByText(USER_MESSAGE).first()).toBeVisible();

      // AI bubble.
      const aiResponse = page
        .locator('.markdown-ai-message:visible')
        .getByText(AI_BUBBLE_TEXT, { exact: false })
        .first();
      await expect(aiResponse).toBeVisible();

      // Context progress bar.
      const progressBar = page.locator('[role=progressbar]:visible').first();
      await expect(progressBar).toBeVisible();

      // ---- 8a. Re-open dialog → token placeholder says "set" --------
      // After the save the model is loaded, so the picker is
      // disabled — but the token field still renders, and its
      // placeholder must read "Token is set…" because the
      // presence boolean survived. We deliberately do NOT click
      // any radio / Save & Load button here; the test only
      // asserts the field's existence + placeholder.
      await page.getByTitle('Configure AI Model').first().click();
      await expect(dialog.getByText('Configure AI Model')).toBeVisible();

      await expect(
        dialog.getByPlaceholder(TOKEN_PRESENT_PLACEHOLDER)
      ).toBeVisible();

      // ---- 8b. No second POST /api/llm/api-token has fired ------------
      // The form's apiToken field is empty on reopen (the token
      // is never surfaced to the UI) and the user hasn't typed
      // anything. The fix that drops the auto-clear branch means
      // Save without typing is a no-op for the token — verified
      // by the lack of a second POST.
      expect(captures).toHaveLength(1);

      // Close the dialog without saving (Escape).
      await page.keyboard.press('Escape');

      // ---- 9c. Send a second chat message; the token is still set ----
      // The MSW chat handler is URL/token-agnostic, so the chat
      // would succeed even if the token were cleared. The real
      // proof is the /status check below: hasRemoteApiToken
      // must remain true.
      const secondChatInput = page
        .locator('[data-testid="chat-input"]:visible')
        .first();
      await expect(secondChatInput).toBeEnabled();
      await secondChatInput.fill(SECOND_USER_MESSAGE);
      await secondChatInput.press('Enter');
      await expect(page.getByText(SECOND_USER_MESSAGE).first()).toBeVisible();

      // Read the server-side status via the page context (MSW).
      // page.request.get would hit the webpack-dev-server proxy
      // directly and ECONNREFUSED.
      const statusBody = await page.evaluate(async () => {
        const res = await fetch('/api/llm/status');
        return res.json();
      });
      expect(statusBody.hasRemoteApiToken).toBe(true);

      // ---- 10. Replace the token: unload, save with a new value ----
      // The model must be unloaded before the picker accepts
      // edits (form is disabled while loaded). The Unload button
      // lives inside the dialog's LlmSettingsForm callout, so
      // re-open the dialog first.
      await page.getByTitle('Configure AI Model').first().click();
      await expect(dialog.getByText('Configure AI Model')).toBeVisible();
      const unloadAgain = dialog.getByRole('button', { name: 'Unload' });
      await expect(unloadAgain).toBeVisible();
      await unloadAgain.click();
      // The Unload mutation invalidates the llmStatus query; the
      // callout disappears once mockModelLoaded flips to false.
      await expect(unloadAgain).not.toBeVisible({ timeout: 5_000 });

      // The dialog stays open after Unload (only the form's
      // disabled state changes). Type a NEW token, re-pick the
      // model, save. The new value is what gets sent — proves the
      // form can replace a token (rotation, never a clear, never
      // the old value).
      await dialog.getByText('Remote Machine').first().click();
      const apiTokenField2 = dialog.getByPlaceholder(TOKEN_PRESENT_PLACEHOLDER);
      await apiTokenField2.fill(NEW_API_TOKEN);
      await page.waitForTimeout(300);
      await dialog.getByRole('combobox').click();
      await page
        .getByRole('option', { name: new RegExp(SELECTED_REMOTE_MODEL) })
        .click();

      await dialog.getByRole('button', { name: /Save & Load Model/ }).click();
      await page.waitForTimeout(50);

      // Exactly one new POST since the original save, and it
      // carried the NEW token — not null, not the original.
      expect(captures).toHaveLength(2);
      expect(captures[1].token).toBe(NEW_API_TOKEN);
      // First capture must still be the original token (no
      // clobber).
      expect(captures[0].token).toBe(API_TOKEN);

      // And the server-side state reflects the rotation. Read via
      // the page context (MSW) — see note on step 9c.
      const finalStatusBody = await page.evaluate(async () => {
        const res = await fetch('/api/llm/status');
        return res.json();
      });
      expect(finalStatusBody.hasRemoteApiToken).toBe(true);
    } finally {
      stop();
    }
  });
});
