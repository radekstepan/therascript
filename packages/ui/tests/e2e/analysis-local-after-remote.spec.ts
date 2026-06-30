// packages/ui/tests/e2e/analysis-local-after-remote.spec.ts
//
// Regression guard for the "local model selection health-checks the stale
// remote URL" bug. Symptom: with a remote URL set as the active LLM
// endpoint (e.g. from a prior chat/analysis), opening the Analyze
// Multiple Sessions modal and switching to Local Machine then submitting
// would 500 with "Remote LLM at <url> failed health check." Root cause:
// the modal's handleSubmit only attached `baseUrl` to the request body
// in Remote mode, so the backend's listModels() fell back to the stale
// active URL.
//
// Coverage:
//   1. Local-after-Remote: save a remote URL via the Configure AI Model
//      dialog, then open the analysis modal (form pre-seeded with the
//      remote state), switch to Local Machine, pick a local model, and
//      submit. Assert the POST body carried the local default baseUrl
//      and the submit succeeded (no 500).
//   2. Remote-after-Local: from a clean state the analysis modal starts
//      in Local mode; switching to Remote Machine, picking a remote
//      model, and submitting must carry the typed remote baseUrl in
//      the POST body. This is the symmetric case — a refactor that
//      unifies the two branches and accidentally drops the Remote
//      field would be caught here.
//
// Mock contract under test: packages/ui/src/mocks/handlers/analysis.ts
// returns 500 with the same error envelope the real backend throws
// from ensureLlmReady when baseUrl is missing while the active URL is
// remote. The "baseUrl is the local default" assertion in Test 1
// pins the frontend fix; the conditional 500 in the mock pins the
// backend's ensureLlmReady contract.
//
// State isolation: `beforeEach` resets MSW + localStorage
// (mirrors remote-llm-url-persistence.spec.ts:31-37). The MSW reset
// hook (/api/__e2e/reset) clears mockActiveBaseUrl; localStorage
// cleanup drops the persisted remote URL from any prior spec.
import { test, expect, type Page, type Request } from '@playwright/test';

const REMOTE_URL_FIELD_PLACEHOLDER = 'http://192.168.1.100:1234';
const SELECTED_REMOTE_MODEL = 'gpt-4o';
const SELECTED_LOCAL_MODEL = 'qwen2.5-7b-instruct';
const REMOTE_BASE_URL = 'http://mock-remote:1234';
const LOCAL_DEFAULT_BASE_URL = 'http://localhost:1234';
const ANALYZED_PROMPT =
  'What are the recurring themes of anxiety across these sessions?';
const JOB_ROW_LABEL = 'Anxiety Trends Analysis';

async function resetMocksAndStorage(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    await fetch('/api/__e2e/reset', { method: 'POST' });
    localStorage.removeItem('llm-remote-base-url');
  });
}

async function openConfigureDialog(page: Page) {
  const configureButton = page.getByTitle('Configure AI Model').first();
  await expect(configureButton).toBeVisible();
  await configureButton.click();
  const dialog = page.getByRole('dialog').first();
  await expect(dialog.getByText('Configure AI Model')).toBeVisible();
  return dialog;
}

async function saveRemoteModelFromSessionView(page: Page, url: string) {
  // Goes to a session so the chat panel header is mounted and the
  // "Configure AI Model" button is reachable, then saves the remote
  // URL. Mirrors setRemoteUrlAndSave in
  // remote-llm-url-persistence.spec.ts:48-70.
  await page.goto('/sessions/1');
  const dialog = await openConfigureDialog(page);
  await dialog.getByText('Remote Machine').first().click();
  const remoteUrlField = dialog.getByPlaceholder(REMOTE_URL_FIELD_PLACEHOLDER);
  await remoteUrlField.fill(url);
  // LlmEndpointModelPicker debounces 500ms; let the model query settle
  // before picking.
  await page.waitForTimeout(700);
  const modelCombobox = dialog.getByRole('combobox');
  await modelCombobox.click();
  await page
    .getByRole('option', { name: new RegExp(SELECTED_REMOTE_MODEL) })
    .click();
  await dialog.getByRole('button', { name: /Save & Load Model/ }).click();
  await page.waitForTimeout(100);
}

async function openAnalysisDialogFromLanding(page: Page) {
  await page.goto('/');
  const main = page.locator('main');
  const analyzeButtonDisabled = main.getByRole('button', {
    name: /Analyze Selected/,
  });
  await expect(analyzeButtonDisabled).toBeDisabled();

  const selectAll = main.getByRole('checkbox', {
    name: 'Select all sessions',
  });
  await selectAll.click();

  const analyzeButtonEnabled = main.getByRole('button', {
    name: /Analyze Selected \(2\)/,
  });
  await expect(analyzeButtonEnabled).toBeEnabled();
  await analyzeButtonEnabled.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Analyze Multiple Sessions')).toBeVisible();
  return { dialog, main };
}

interface AnalysisPostBody {
  sessionIds?: number[];
  prompt?: string;
  modelName?: string;
  baseUrl?: string | null;
  useAdvancedStrategy?: boolean;
}

async function captureAnalysisPostBody(
  page: Page,
  trigger: () => Promise<void>
): Promise<AnalysisPostBody> {
  const postPromise = page.waitForRequest(
    (req: Request) =>
      req.url().endsWith('/api/analysis-jobs') && req.method() === 'POST'
  );
  await trigger();
  const req = await postPromise;
  const raw = req.postData();
  return raw ? (JSON.parse(raw) as AnalysisPostBody) : {};
}

test.describe.serial('Analysis modal endpoint switching', () => {
  test.beforeEach(async ({ page }) => {
    await resetMocksAndStorage(page);
  });

  test('Local-after-Remote: submit sends the local default baseUrl, not the stale remote one', async ({
    page,
  }) => {
    // 1. Establish a remote URL as the global active URL. The point
    //    of the test is to prove the analysis modal does NOT inherit
    //    this stale URL when the user picks a local model — so the
    //    /set-model side-effect is what matters; the analysis modal's
    //    own initial state is incidental.
    await saveRemoteModelFromSessionView(page, REMOTE_BASE_URL);

    // 2. Open the analysis modal from the Landing page.
    const { dialog, main } = await openAnalysisDialogFromLanding(page);

    // 3. Force the form to Local Machine. Depending on llmStatus poll
    //    timing the form may pre-seed in Remote (with the typed URL)
    //    or in Local (default); either way we want the user to be
    //    unambiguously in Local mode before picking the model. If
    //    we're already in Local, this click is a no-op via the
    //    picker's "same-segment click" guard.
    await dialog.getByText('Local Machine').first().click();
    // LlmEndpointModelPicker debounces 500ms; let the local fetch
    // settle before picking.
    await page.waitForTimeout(700);

    // 4. Pick a local model and type the analysis prompt.
    const modelCombobox = dialog.getByRole('combobox');
    await modelCombobox.click();
    await page
      .getByRole('option', { name: new RegExp(SELECTED_LOCAL_MODEL) })
      .click();

    const promptTextarea = dialog.locator('#analysisPrompt');
    await promptTextarea.fill(ANALYZED_PROMPT);

    // 5. Submit and capture the POST body. The body must carry the
    //    local default baseUrl, NOT the stale remote one — this is
    //    the precise regression pin.
    const submitButton = dialog.getByRole('button', {
      name: /Submit Analysis/,
    });
    const body = await captureAnalysisPostBody(page, () =>
      submitButton.click()
    );

    expect(body.baseUrl).toBe(LOCAL_DEFAULT_BASE_URL);
    expect(body.modelName).toBe(SELECTED_LOCAL_MODEL);
    expect(body.prompt).toBe(ANALYZED_PROMPT);

    // 6. Navigation to the jobs list proves the submit didn't 500.
    await page.waitForURL('**/analysis-jobs');
    await expect(main.getByText(JOB_ROW_LABEL).first()).toBeVisible();
  });

  test('Remote-after-Local: submit sends the typed remote baseUrl, not the local default', async ({
    page,
  }) => {
    // 1. From a clean state the analysis modal starts in Local mode.
    const { dialog } = await openAnalysisDialogFromLanding(page);
    await expect(dialog.getByText('Local Machine').first()).toBeVisible();

    // 2. Switch to Remote Machine and fill the URL.
    await dialog.getByText('Remote Machine').first().click();
    const remoteUrlField = dialog.getByPlaceholder(
      REMOTE_URL_FIELD_PLACEHOLDER
    );
    await remoteUrlField.fill(REMOTE_BASE_URL);
    // LlmEndpointModelPicker debounces 500ms; let the remote fetch
    // settle before picking.
    await page.waitForTimeout(700);

    // 3. Pick a remote model and type the prompt.
    const modelCombobox = dialog.getByRole('combobox');
    await modelCombobox.click();
    await page
      .getByRole('option', { name: new RegExp(SELECTED_REMOTE_MODEL) })
      .click();

    const promptTextarea = dialog.locator('#analysisPrompt');
    await promptTextarea.fill(ANALYZED_PROMPT);

    // 4. Submit and capture the POST body. The body must carry the
    //    typed remote baseUrl — the symmetric assertion to Test 1.
    const submitButton = dialog.getByRole('button', {
      name: /Submit Analysis/,
    });
    const body = await captureAnalysisPostBody(page, () =>
      submitButton.click()
    );

    expect(body.baseUrl).toBe(REMOTE_BASE_URL);
    expect(body.modelName).toBe(SELECTED_REMOTE_MODEL);
    expect(body.prompt).toBe(ANALYZED_PROMPT);

    // 5. Navigation to the jobs list proves the submit didn't 500.
    await page.waitForURL('**/analysis-jobs');
  });
});
