// packages/ui/tests/e2e/crud.spec.ts
//
// E2E for the four destructive / mutation flows that happen
// straight from the Landing page:
//
//   1. Edit a session's name + client via the row's "Edit Details"
//      dropdown menu and EditSessionModal.
//   2. Delete a session via the row's "Delete Session" menu and
//      AlertDialog confirm.
//   3. Edit a standalone chat's name via the row's "Edit" menu
//      and EditStandaloneChatModal.
//   4. Delete a standalone chat via the row's "Delete Chat" menu
//      and AlertDialog confirm.
//
// State isolation:
//   - The Landing page reads /api/sessions/ and /api/chats from the
//     e2e-aware handlers, which mutate `e2eSessions` and
//     `e2eStandaloneChats`. Each test uses `test.describe.serial` so
//     the spec runs in one worker and state is well-ordered across
//     the four cases. beforeEach posts /api/__e2e/reset to reseed
//     the mock state.
//
// Reference: packages/ui/src/mocks/handlers.ts for the mock surface,
// packages/ui/src/components/Shared/EditSessionModal.tsx and
// EditStandaloneChatModal.tsx for the modal shapes.
import { test, expect } from '@playwright/test';

const UPDATED_SESSION_NAME = 'Intake Session (renamed)';
const UPDATED_CLIENT_NAME = 'Jane Smith';
const RENAMED_CHAT = 'Strategy brainstorm';

test.describe.serial('Session and standalone chat CRUD', () => {
  test.beforeEach(async ({ page }) => {
    // Reseed the e2e mock state so each test starts from the
    // known-good baseline. We use page.evaluate to run the fetch in
    // the page context — page.request hits the test runner's HTTP
    // client and bypasses MSW.
    await page.goto('/');
    await page.evaluate(async () => {
      await fetch('/api/__e2e/reset', { method: 'POST' });
    });
  });

  test('edits a session from the row dropdown', async ({ page }) => {
    // beforeEach already navigated to /. Re-navigate after the reset
    // so the table picks up the freshly seeded state.
    await page.goto('/');

    // Locate the row by its stable session-id-based "Select session 1"
    // checkbox (SessionListTable.tsx:91-93). The row's aria-label
    // changes once the name updates, so we can't use that as a handle.
    const sessionCheckbox = page.getByRole('checkbox', {
      name: 'Select session 1',
    });
    await expect(sessionCheckbox).toBeVisible();
    const sessionRow = page.locator('tr', {
      has: sessionCheckbox,
    });

    // Open the row's dropdown menu (SessionListTable.tsx:203-216).
    await sessionRow.getByRole('button', { name: 'Session options' }).click();
    await page.getByRole('menuitem', { name: /Edit Details/ }).click();

    // EditSessionModal renders the same <EditEntityModal> shell with
    // "Edit Session Details" as the title. The first input is the
    // session name; we set it to a recognizable value and then
    // change the client name too.
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Edit Session Details')).toBeVisible();

    const nameInput = dialog.getByPlaceholder('e.g. Initial Intake');
    await nameInput.fill(UPDATED_SESSION_NAME);

    const clientInput = dialog.getByPlaceholder('Client Initials');
    await clientInput.fill(UPDATED_CLIENT_NAME);

    await dialog.getByRole('button', { name: /Save Changes/ }).click();

    // Toast on success. The row re-renders with the new name in its
    // aria-label, so we re-resolve the row to find it. `.first()`
    // pins the toast assertion to the visible toast (the same
    // text is also mirrored in the aria-live region).
    await expect(
      page.getByText(/Session details updated successfully/).first()
    ).toBeVisible();
    const updatedRow = page.locator('tr', {
      has: page.getByRole('checkbox', { name: 'Select session 1' }),
    });
    await expect(updatedRow.getByText(UPDATED_SESSION_NAME)).toBeVisible();
    await expect(updatedRow.getByText(UPDATED_CLIENT_NAME)).toBeVisible();
  });

  test('deletes a session via the row dropdown', async ({ page }) => {
    await page.goto('/');

    const followupCheckbox = page.getByRole('checkbox', {
      name: 'Select session 2',
    });
    await expect(followupCheckbox).toBeVisible();
    const followupRow = page.locator('tr', { has: followupCheckbox });

    await followupRow.getByRole('button', { name: 'Session options' }).click();
    await page.getByRole('menuitem', { name: /Delete Session/ }).click();

    // LandingPage.tsx:586-628 renders an AlertDialog with title
    // "Delete Session" + a "Delete Session" confirm button.
    const dialog = page.getByRole('alertdialog');
    await expect(dialog.getByText('Delete Session').first()).toBeVisible();
    await dialog.getByRole('button', { name: /Delete Session/ }).click();

    // The mock returns "Session 2 deleted." and the LandingPage
    // surfaces it as a toast. `.first()` pins the assertion to the
    // visible toast (the same text is also mirrored in the
    // aria-live region for screen readers).
    await expect(page.getByText(/Session 2 deleted/).first()).toBeVisible();
    await expect(
      page.getByRole('checkbox', { name: 'Select session 2' })
    ).toHaveCount(0);
  });

  test('edits a standalone chat from the row dropdown', async ({ page }) => {
    await page.goto('/');

    // The Standalone Chats table renders one row per chat. The
    // StandaloneChatListTable row has an "Standalone chat options"
    // IconButton (StandaloneChatListTable.tsx:110) and the first
    // cell renders the "Chat (timestamp)" fallback when the name is
    // null.
    const chatRow = page
      .locator('tr')
      .filter({ hasText: /^Chat \(/ })
      .first();
    await expect(chatRow).toBeVisible();

    await chatRow
      .getByRole('button', { name: 'Standalone chat options' })
      .click();
    await page.getByRole('menuitem', { name: /Edit Details/ }).click();

    // EditStandaloneChatModal renders a "Chat name" TextField. We
    // set a recognizable name and save.
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Edit Chat')).toBeVisible();
    const nameInput = dialog.getByPlaceholder('Enter chat name');
    await nameInput.fill(RENAMED_CHAT);
    await dialog.getByRole('button', { name: /Save Changes/ }).click();

    // The chat list re-renders with the new name. We don't pin to
    // the original row locator because its filter (which uses the
    // old "Chat (" text) no longer matches.
    await expect(page.getByText(RENAMED_CHAT).first()).toBeVisible();
  });

  test('deletes a standalone chat via the row dropdown', async ({ page }) => {
    await page.goto('/');

    const chatRow = page
      .locator('tr')
      .filter({ hasText: /^Chat \(/ })
      .first();
    await expect(chatRow).toBeVisible();

    await chatRow
      .getByRole('button', { name: 'Standalone chat options' })
      .click();
    await page.getByRole('menuitem', { name: /Delete Chat/ }).click();

    const dialog = page.getByRole('alertdialog');
    await expect(dialog.getByText('Delete Chat').first()).toBeVisible();
    await dialog.getByRole('button', { name: /Delete Chat/ }).click();

    // The mock returns "Chat <id> deleted." and the LandingPage
    // shows it as a toast. The first row of the Standalone Chats
    // table was the deleted one, so we should now see only one
    // remaining chat.
    await expect(page.getByText(/deleted\./)).toBeVisible();
    const remainingChats = page.locator('tr').filter({ hasText: /^Chat \(/ });
    await expect(remainingChats).toHaveCount(1);
  });
});
