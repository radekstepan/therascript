// packages/ui/tests/e2e/session-chat-manage.spec.ts
//
// E2E for session-chat rename + delete from the SessionSidebar. The
// existing crud.spec.ts only covers standalone-chat rename/delete
// from the Landing page; the session-bound equivalents
// (PATCH .../chats/:chatId/name, DELETE .../chats/:chatId) had no
// coverage.
//
// Flow (chat 11 "Second chat" is the non-active target so deletion
// does not trigger the active-chat navigation branch):
//   1. Open /sessions/1 (redirects to /sessions/1/chats/10), rename
//      chat 11 via its row menu → "Rename Chat" dialog → Save.
//      Assert the toast and the new sidebar label.
//   2. Delete chat 11 via its row menu → "Delete Chat" confirm.
//      Assert the toast and that the row is gone while chat 10 stays.
//
// Reference: packages/ui/src/components/SessionView/Sidebar/
// SessionSidebar.tsx and packages/ui/src/mocks/handlers/sessionChats.ts.
import { test, expect, type Page } from '@playwright/test';
import { gotoAndResetMocks } from './helpers';

const RENAMED_CHAT = 'Renamed second chat';

test.describe.serial('Session chat rename and delete', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAndResetMocks(page);
  });

  // Target the row by its title text rather than by index: the
  // row container itself has role="button" with an accessible name
  // ending in "Chat item options" (title + trigger label), so a
  // substring name match or nth() index would also hit row divs and
  // hidden layout copies. Scoping to the row + exact trigger name is
  // unambiguous.
  async function openRowMenu(page: Page, chatTitle: string) {
    const row = page
      .locator('nav div[role="button"]', { hasText: chatTitle })
      .first();
    await expect(row).toBeVisible();
    await row
      .getByRole('button', { name: 'Chat item options', exact: true })
      .click();
  }

  test('renames a session chat from the sidebar menu', async ({ page }) => {
    await page.goto('/sessions/1/chats/10');
    await expect(page.getByText('Second chat')).toBeVisible();

    await openRowMenu(page, 'Second chat');
    await page.getByRole('menuitem', { name: 'Rename' }).click();

    const dialog = page.getByRole('alertdialog');
    await expect(dialog.getByText('Rename Chat')).toBeVisible();
    await dialog
      .getByPlaceholder('Enter new name (optional)')
      .fill(RENAMED_CHAT);
    await dialog.getByRole('button', { name: 'Save' }).click();

    await expect(
      page.getByText('Chat renamed successfully.').first()
    ).toBeVisible();
    await expect(page.getByText(RENAMED_CHAT)).toBeVisible();
  });

  test('deletes a session chat from the sidebar menu', async ({ page }) => {
    await page.goto('/sessions/1/chats/10');
    await expect(page.getByText('Second chat')).toBeVisible();

    await openRowMenu(page, 'Second chat');
    await page.getByRole('menuitem', { name: 'Delete Chat' }).click();

    const dialog = page.getByRole('alertdialog');
    await expect(dialog.getByText('Delete Chat')).toBeVisible();
    await dialog.getByRole('button', { name: 'Delete' }).click();

    await expect(
      page.getByText('Chat deleted successfully.').first()
    ).toBeVisible();
    await expect(page.getByText('Second chat')).toHaveCount(0);
    // The active chat (10) is untouched.
    await expect(page).toHaveURL(/\/sessions\/1\/chats\/10/);
  });
});
