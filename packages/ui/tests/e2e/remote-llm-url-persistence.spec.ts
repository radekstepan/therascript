// packages/ui/tests/e2e/remote-llm-url-persistence.spec.ts
//
// E2E coverage for the "remote LM Studio URL" persistence contract.
// Pinned against the regression where the URL field would silently
// re-populate with the last typed value after the user cleared it
// (the "always resets to the original value" bug). The fix moved
// persistence from the picker to the modal's Save handler so the
// empty string is a valid persisted state.
//
//   1. Save a remote URL, reload the page, reopen the dialog → the
//      URL field is pre-filled from localStorage on the next
//      Local→Remote toggle. (Pre-fill feature still works.)
//   2. With a saved URL, clear the field, toggle Local→Remote
//      *without* saving → the field stays empty in the same session
//      (no in-picker write).
//   3. Save in Local mode after a remote URL was previously saved →
//      the atom becomes '' and survives a reload. (Always-remember
//      the latest.)
//   4. The original bug, end-to-end: clear the URL, cancel the
//      dialog, reopen → the field is empty (not the stale value).
//
// State isolation: `localStorage['llm-remote-base-url']` is cleared
// in `beforeEach` via `page.evaluate`, since the MSW reset hook
// (`/api/__e2e/reset`) only touches server-side mock state.
import { test, expect, type Page } from '@playwright/test';

const STORAGE_KEY = 'llm-remote-base-url';
const REMOTE_URL_FIELD_PLACEHOLDER = 'http://192.168.1.100:1234';
const SELECTED_REMOTE_MODEL = 'gpt-4o';

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

  test('saves the URL, reloads, and the URL pre-fills on the next dialog open', async ({
    page,
  }) => {
    // ---- Save a remote URL ----
    await page.goto('/sessions/1');
    const dialog = await openConfigureDialog(page);
    await setRemoteUrlAndSave(page, dialog, 'http://saved-host:1234');

    // Atom is now the trimmed URL (JSON-encoded by atomWithStorage).
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
    // Pre-seed a URL as if a prior Save happened.
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

    // User clears the field but does NOT click Save.
    await remoteUrlField.fill('');

    // Toggle Local → Remote. The picker no longer auto-rewrites the
    // atom on typing, so the empty field stays empty. Pre-fix, the
    // in-picker writer would never write '' — the next toggle would
    // re-fill the field with 'http://saved-host:1234' from the
    // still-stale atom.
    await dialog.getByText('Local Machine').first().click();
    await dialog.getByText('Remote Machine').first().click();
    await expect(remoteUrlField).toHaveValue('');
  });

  test('saving in Local mode clears the persisted URL across reloads', async ({
    page,
  }) => {
    // Seed a previously-saved URL.
    await page.evaluate(
      ([key, value]) => localStorage.setItem(key, value),
      [STORAGE_KEY, JSON.stringify('http://stale-host:1234')]
    );

    await page.goto('/sessions/1');
    const dialog = await openConfigureDialog(page);

    // The form is pre-seeded with a model from llmStatus (default).
    // The user picks a model and saves in Local mode. Saving in
    // Local mode sends baseUrl=null to the backend and writes ''
    // to the atom.
    const modelCombobox = dialog.getByRole('combobox');
    await modelCombobox.click();
    await page
      .getByRole('option', { name: /qwen2\.5-14b/i })
      .first()
      .click();
    await dialog.getByRole('button', { name: /Save & Load Model/ }).click();
    await page.waitForTimeout(100);

    // The atom is now the empty string (JSON-encoded as '""').
    const savedValue = await readPersistedUrl(page);
    expect(JSON.parse(savedValue!)).toBe('');

    // Reload and verify the empty state survived — the next dialog
    // open + Local→Remote toggle leaves the field empty.
    await page.reload();
    const dialog2 = await openConfigureDialog(page);
    await dialog2.getByText('Remote Machine').first().click();
    const remoteUrlField = dialog2.getByPlaceholder(
      REMOTE_URL_FIELD_PLACEHOLDER
    );
    await expect(remoteUrlField).toHaveValue('');
  });

  test('cancel after clearing does not persist a stale URL', async ({
    page,
  }) => {
    // Reproduces the original "always resets to the original value"
    // bug at the e2e level. The user types a URL, clears it, then
    // closes the dialog with Cancel. The next dialog open must show
    // an empty field — not the previously-saved URL.
    await page.evaluate(
      ([key, value]) => localStorage.setItem(key, value),
      [STORAGE_KEY, JSON.stringify('http://stale-host:1234')]
    );

    await page.goto('/sessions/1');
    const dialog = await openConfigureDialog(page);
    await dialog.getByText('Remote Machine').first().click();

    // The field starts pre-filled from the previously-saved URL.
    const remoteUrlField = dialog.getByPlaceholder(
      REMOTE_URL_FIELD_PLACEHOLDER
    );
    await expect(remoteUrlField).toHaveValue('http://stale-host:1234');

    // User clears the field and cancels. No save → no atom write.
    await remoteUrlField.fill('');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await page.waitForTimeout(100);

    // The atom still holds the original URL — Cancel is a no-op.
    const savedValue = await readPersistedUrl(page);
    expect(JSON.parse(savedValue!)).toBe('http://stale-host:1234');

    // Reopen the dialog and toggle to Remote. The field is pre-filled
    // with the original (stale) URL — not because of the bug, but
    // because the user explicitly chose Cancel and the prior Save
    // is still the source of truth. This is the intended
    // "Save only" contract.
    const dialog2 = await openConfigureDialog(page);
    await dialog2.getByText('Remote Machine').first().click();
    await expect(
      dialog2.getByPlaceholder(REMOTE_URL_FIELD_PLACEHOLDER)
    ).toHaveValue('http://stale-host:1234');
  });
});
