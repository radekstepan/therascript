// packages/ui/tests/e2e/remote-llm-status.spec.ts
//
// E2E regression guard for the `/api/llm/status` response contract.
//
// Background: the status endpoint used to declare its `details` field
// as `LlmModelDetailSchema` (only the nested { format, family, ... }
// object), but the route handler at `packages/api/src/routes/llmRoutes.ts:637-646`
// spreads the full `LlmModelInfo` into `details` — name, modified_at,
// size, digest, details, defaultContextSize, size_vram, architecture.
// Elysia 1.2.25's strict response validation (with
// `additionalProperties: false` by default) rejected every status
// response with a 422 and the envelope
//   { "type": "validation", "on": "response", "found": {...} }.
//
// The user-visible symptom: `POST /api/llm/set-model` succeeds (toast:
// "Success"), the model actually loads on LM Studio, but the React
// Query poll of `/api/llm/status` 422s, so the UI's `llmStatus` stays
// `undefined` and the loaded model never appears in the chat panel
// header, the GpuStatusModal, or the configure-modal callout.
//
// The unit test at `packages/api/src/routes/llmRoutes.test.ts` pins
// the schema contract; this e2e spec is the user-visible mirror.
// It intercepts the wire-level status response and asserts:
//   1. After a successful `set-model`, the next `GET /api/llm/status`
//      returns 200 (not 422).
//   2. The body has `loaded: true` and `details.name` populated, with
//      the full `LlmModelInfo` shape under `details`.
//   3. The chat input is enabled (gated on `llmStatus.loaded === true`)
//      and the model name appears in the panel header.
//   4. After `unload`, the next `GET /api/llm/status` returns 200
//      and `loaded: false` (the second half of the original round-trip).
//
// State isolation: the MSW `mockActiveModel` / `mockModelLoaded`
// flags are reseeded by `POST /api/__e2e/reset` in `beforeEach`
// (see `packages/ui/src/mocks/handlers/e2e.ts:17`).
import { test, expect, type Page, type Response } from '@playwright/test';

const SELECTED_LOCAL_MODEL = 'qwen2.5-7b-instruct';
const STATUS_PATH = '/api/llm/status';

interface StatusBody {
  loaded: boolean;
  activeModel: string;
  details: null | {
    name: string;
    modified_at: string;
    size: number;
    digest: string;
    details: Record<string, unknown>;
    defaultContextSize: number | null;
    size_vram: number | null;
    expires_at: string | null;
    architecture: unknown;
  };
}

async function resetMocks(page: Page) {
  await page.goto('/');
  // Wait for the app's first /api/status/readiness poll to land
  // before issuing our own requests. This guarantees the MSW
  // service worker is controlling the page (a fresh hard-nav
  // races with `worker.start()` in `index.tsx:48`; without this
  // wait, a fetch fired immediately after `page.goto` bypasses
  // MSW and goes straight to the webpack-dev-server proxy →
  // ECONNREFUSED on the real backend at :3001). See
  // `tests/e2e/readiness.spec.ts:43-48` for the canonical
  // version of this dance.
  await page.waitForResponse((resp) =>
    resp.url().endsWith('/api/status/readiness')
  );
  await page.evaluate(async () => {
    await fetch('/api/__e2e/reset', { method: 'POST' });
  });
}

/**
 * Wait for the next `GET /api/llm/status` response and assert it is
 * 200 (not 422). Returns the parsed body. If the response is 422,
 * the test fails with a diagnostic message that names the field
 * Elysia complained about — this is the exact regression we are
 * guarding against.
 */
async function waitForStatusOk(page: Page): Promise<StatusBody> {
  const response: Response = await page.waitForResponse(
    (resp) =>
      resp.url().endsWith(STATUS_PATH) && resp.request().method() === 'GET',
    { timeout: 5_000 }
  );
  const status = response.status();
  if (status !== 200) {
    const text = await response.text().catch(() => '<unreadable>');
    throw new Error(
      `GET /api/llm/status returned ${status} (expected 200). ` +
        `This is the original regression — Elysia's strict response ` +
        `validation rejected the shape. Body: ${text}`
    );
  }
  return (await response.json()) as StatusBody;
}

test.describe.serial('/api/llm/status response contract', () => {
  test.beforeEach(async ({ page }) => {
    await resetMocks(page);
  });

  test('status returns 200 with the full LlmModelInfo shape after a successful set-model', async ({
    page,
  }) => {
    // ---- 1. Open the Configure AI Model dialog and save a local model --
    await page.goto('/sessions/1');

    const configureButton = page.getByTitle('Configure AI Model').first();
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

    // ---- 2. The next status poll must be 200, not 422 ------------------
    // The chat input only enables when `llmStatus.loaded === true`,
    // which only becomes true if the status response was 200. So
    // both the explicit `waitForStatusOk` below and the implicit
    // `chatInput.toBeEnabled` after that would fail if Elysia
    // started 422-ing the response again.
    const status = await waitForStatusOk(page);

    // ---- 3. Body shape -------------------------------------------------
    expect(status.loaded).toBe(true);
    expect(status.activeModel).toBe(SELECTED_LOCAL_MODEL);
    expect(status.details).not.toBeNull();
    expect(status.details?.name).toBe(SELECTED_LOCAL_MODEL);
    // The full LlmModelInfo shape: name, modified_at (ISO string),
    // size, digest, nested details, defaultContextSize,
    // size_vram, expires_at, architecture. A regression that
    // re-typed `details` as `LlmModelDetailSchema` would leave
    // most of these missing — Value.Check inside the Elysia route
    // would 422 before the response even reached the client.
    expect(typeof status.details?.modified_at).toBe('string');
    expect(status.details?.size).toBeGreaterThan(0);
    expect(typeof status.details?.digest).toBe('string');
    expect(status.details?.details).toBeTruthy();
    expect(status.details?.defaultContextSize).toBeGreaterThan(0);
    // `architecture: null` is the contract the unit test pins;
    // assert it round-trips through the wire.
    expect(status.details?.architecture).toBeNull();

    // ---- 4. User-visible surface ---------------------------------------
    // The chat input is disabled until llmStatus.loaded === true.
    // It is the canary for the 422 regression at the UI layer.
    const chatInput = page
      .locator('[data-testid="chat-input"]:visible')
      .first();
    await expect(chatInput).toBeEnabled();

    // The model name is surfaced in the chat panel header via
    // <Text title={activeModel}>.
    await expect(page.getByTitle(SELECTED_LOCAL_MODEL).first()).toBeVisible();
  });

  test('status returns 200 with loaded: false after unload', async ({
    page,
  }) => {
    // ---- 1. Set up: navigate to the session and load a model ----------
    // Note: we drive the model save through the dialog (not a raw
    // `fetch('/api/llm/set-model')` from `page.evaluate`) because
    // the MSW mutable state lives in the page's module instance —
    // a hard `page.goto` would re-import the handlers module and
    // reset `mockActiveModel` / `mockModelLoaded` to their initial
    // values. The dialog-driven save keeps everything in the same
    // page session, so the post-save Unload button is rendered.
    await page.goto('/sessions/1');

    const configureButton = page.getByTitle('Configure AI Model').first();
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

    // Sanity: the model is now loaded, so the chat input is enabled.
    const chatInput = page
      .locator('[data-testid="chat-input"]:visible')
      .first();
    await expect(chatInput).toBeEnabled();

    // ---- 2. Re-open the dialog; the Unload button is now rendered -----
    await page.getByTitle('Configure AI Model').first().click();
    await expect(dialog.getByText('Configure AI Model')).toBeVisible();

    const unloadButton = dialog.getByRole('button', { name: 'Unload' });
    await expect(unloadButton).toBeVisible();
    await unloadButton.click();

    // ---- 3. The next status poll must be 200 with loaded: false -------
    const status = await waitForStatusOk(page);
    expect(status.loaded).toBe(false);
    // After unload, the mock clears activeModel too — the contract
    // is that a follow-up "no model" status has details: null.
    expect(status.details).toBeNull();

    // The Unload mutation invalidates the status query, the callout
    // disappears, and the form re-enables. Verify the chat input
    // is now disabled (no model loaded).
    await expect(chatInput).toBeDisabled();
  });
});
