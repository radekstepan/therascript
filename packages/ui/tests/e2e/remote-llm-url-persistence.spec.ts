// packages/ui/tests/e2e/remote-llm-url-persistence.spec.ts
//
// E2E coverage for the "last known good remote LM Studio URL"
// persistence contract. The shared model-discovery path persists the
// URL after a models request succeeds — saving a model is not
// required. Typing, clearing, toggling to Local, and modal Save/Cancel
// never write the preference; failed discoveries leave it untouched.
//
//   1. Type a remote URL and let discovery succeed → the URL is
//      persisted (before any Save), survives a reload, and pre-fills
//      the field on the next dialog open + Local→Remote toggle.
//   2. With a remembered URL, clear the field, toggle Local→Remote
//      *without* saving → the field stays empty in the same session
//      (the explicit Clear wins), while the atom keeps the good value.
//   3. Save in Local mode after a remote URL was remembered → the atom
//      still holds the good URL across reloads (Local saves preserve
//      the preference; only a newer successful discovery replaces it).
//   4. Clear the URL, cancel the dialog, reopen → the field pre-fills
//      with the remembered good URL again (Cancel is a no-op; the
//      cleared state was transient).
//
// State isolation: `localStorage['llm-remote-base-url']` is cleared
// in `beforeEach` via `page.evaluate`, since the MSW reset hook
// (`/api/__e2e/reset`) only touches server-side mock state.
import { test, expect, type Page } from '@playwright/test';
import { gotoAndResetMocks } from './helpers';

const STORAGE_KEY = 'llm-remote-base-url';
const REMOTE_URL_FIELD_PLACEHOLDER = 'http://192.168.1.100:1234';
const SELECTED_REMOTE_MODEL = 'gpt-4o';

async function resetMocksAndStorage(page: Page) {
  await gotoAndResetMocks(page);
  await page.evaluate(async () => {
    localStorage.removeItem('llm-remote-base-url');
  });
}

async function openConfigureDialog(page: Page) {
  const configureButton = page
    .getByRole('button', { name: 'Configure AI Model' })
    .first();
  await expect(configureButton).toBeVisible();
  await configureButton.click();
  const dialog = page.getByRole('dialog').first();
  await expect(dialog.getByText('Configure AI Model')).toBeVisible();
  return dialog;
}

async function setRemoteUrlAndSave(
  page: Page,
  dialog: Awaited<ReturnType<typeof openConfigureDialog>>,
  url: string
) {
  await dialog.getByText('Remote Machine').first().click();
  const remoteUrlField = dialog.getByPlaceholder(REMOTE_URL_FIELD_PLACEHOLDER);
  await remoteUrlField.fill(url);

  // Debounce in LlmEndpointModelPicker is 500ms; let the model query
  // settle before picking the model.
  await page.waitForTimeout(700);

  // Discovery has succeeded by now (the MSW handler answers any remote
  // URL with a catalog), so the URL is already remembered — before Save.
  const preSaveValue = await readPersistedUrl(page);
  expect(preSaveValue).not.toBeNull();
  expect(JSON.parse(preSaveValue!)).toBe(url);

  const modelCombobox = dialog.getByRole('combobox');
  await modelCombobox.click();
  await page
    .getByRole('option', { name: new RegExp(SELECTED_REMOTE_MODEL) })
    .click();

  await dialog.getByRole('button', { name: /Save & Load Model/ }).click();
  // The save mutation invalidates llmStatus and closes the dialog.
  await page.waitForTimeout(100);
}

async function readPersistedUrl(page: Page): Promise<string | null> {
  return page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
}

test.describe.serial('Remote LM Studio URL persistence', () => {
  test.beforeEach(async ({ page }) => {
    await resetMocksAndStorage(page);
  });

  test('discovers the URL, reloads, and the URL pre-fills on the next dialog open', async ({
    page,
  }) => {
    // ---- Discover a remote URL (persistence needs no Save) ----
    await page.goto('/sessions/1');
    const dialog = await openConfigureDialog(page);
    await setRemoteUrlAndSave(page, dialog, 'http://saved-host:1234');

    // Atom is the discovered URL (JSON-encoded by atomWithStorage).
    const savedValue = await readPersistedUrl(page);
    expect(savedValue).not.toBeNull();
    expect(JSON.parse(savedValue!)).toBe('http://saved-host:1234');

    // ---- Reload and reopen the dialog ----
    await page.reload();
    const dialog2 = await openConfigureDialog(page);

    // Toggle to Remote. The field is pre-filled from localStorage.
    await dialog2.getByText('Remote Machine').first().click();
    const remoteUrlField = dialog2.getByPlaceholder(
      REMOTE_URL_FIELD_PLACEHOLDER
    );
    await expect(remoteUrlField).toHaveValue('http://saved-host:1234');
  });

  test('cleared field stays empty when toggling Local→Remote without saving', async ({
    page,
  }) => {
    // Pre-seed a URL as if a prior discovery succeeded.
    await page.evaluate(
      ([key, value]) => localStorage.setItem(key, value),
      [STORAGE_KEY, JSON.stringify('http://saved-host:1234')]
    );

    await page.goto('/sessions/1');
    const dialog = await openConfigureDialog(page);

    // Toggle to Remote — the field is pre-filled from the atom.
    await dialog.getByText('Remote Machine').first().click();
    const remoteUrlField = dialog.getByPlaceholder(
      REMOTE_URL_FIELD_PLACEHOLDER
    );
    await expect(remoteUrlField).toHaveValue('http://saved-host:1234');

    // User clears the field but does NOT trigger a new discovery.
    await remoteUrlField.fill('');

    // Toggle Local → Remote. The explicit Clear wins over the
    // remembered value within the session, so the empty field stays
    // empty — while the atom itself keeps the last known good URL.
    await dialog.getByText('Local Machine').first().click();
    await dialog.getByText('Remote Machine').first().click();
    await expect(remoteUrlField).toHaveValue('');

    const remembered = await readPersistedUrl(page);
    expect(JSON.parse(remembered!)).toBe('http://saved-host:1234');
  });

  test('saving in Local mode preserves the remembered URL across reloads', async ({
    page,
  }) => {
    // Seed a previously-discovered URL.
    await page.evaluate(
      ([key, value]) => localStorage.setItem(key, value),
      [STORAGE_KEY, JSON.stringify('http://good-host:1234')]
    );

    await page.goto('/sessions/1');
    const dialog = await openConfigureDialog(page);

    // The form is pre-seeded with a model from llmStatus (default).
    // The user picks a model and saves in Local mode. Saving in
    // Local mode sends baseUrl=null to the backend but leaves the
    // last-known-good preference untouched.
    const modelCombobox = dialog.getByRole('combobox');
    await modelCombobox.click();
    // NOTE: the MSW local catalog only offers qwen2.5-7b-instruct and
    // mistral-7b-local (see LOCAL_MODELS in src/mocks/state.ts) — there
    // is no 14b model to pick. Any local model serves this test's
    // purpose (saving while in Local mode).
    await page
      .getByRole('option', { name: /qwen2\.5-7b-instruct/i })
      .first()
      .click();
    await dialog.getByRole('button', { name: /Save & Load Model/ }).click();
    await page.waitForTimeout(100);

    // The atom still holds the remembered URL.
    const savedValue = await readPersistedUrl(page);
    expect(JSON.parse(savedValue!)).toBe('http://good-host:1234');

    // Reload and verify the remembered URL survived — the next dialog
    // open + Local→Remote toggle pre-fills it.
    await page.reload();
    const dialog2 = await openConfigureDialog(page);
    await dialog2.getByText('Remote Machine').first().click();
    const remoteUrlField = dialog2.getByPlaceholder(
      REMOTE_URL_FIELD_PLACEHOLDER
    );
    await expect(remoteUrlField).toHaveValue('http://good-host:1234');
  });

  test('cancel after clearing does not lose the remembered URL', async ({
    page,
  }) => {
    // The user clears a pre-filled field, then closes the dialog with
    // Cancel. The cleared state was transient — the next dialog open
    // pre-fills the remembered good URL again.
    await page.evaluate(
      ([key, value]) => localStorage.setItem(key, value),
      [STORAGE_KEY, JSON.stringify('http://good-host:1234')]
    );

    await page.goto('/sessions/1');
    const dialog = await openConfigureDialog(page);
    await dialog.getByText('Remote Machine').first().click();

    // The field starts pre-filled from the remembered URL.
    const remoteUrlField = dialog.getByPlaceholder(
      REMOTE_URL_FIELD_PLACEHOLDER
    );
    await expect(remoteUrlField).toHaveValue('http://good-host:1234');

    // User clears the field and cancels. No discovery ran for the
    // cleared state, so the atom is untouched.
    await remoteUrlField.fill('');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await page.waitForTimeout(100);

    // The atom still holds the good URL — Cancel is a no-op.
    const savedValue = await readPersistedUrl(page);
    expect(JSON.parse(savedValue!)).toBe('http://good-host:1234');

    // Reopen the dialog and toggle to Remote. The field is pre-filled
    // with the remembered URL again.
    const dialog2 = await openConfigureDialog(page);
    await dialog2.getByText('Remote Machine').first().click();
    await expect(
      dialog2.getByPlaceholder(REMOTE_URL_FIELD_PLACEHOLDER)
    ).toHaveValue('http://good-host:1234');
  });
});
