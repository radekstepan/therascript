// packages/ui/tests/e2e/chat-navigation.spec.ts
//
// E2E for the chat-list navigation flows that session-chat.spec.ts
// and standalone-chat.spec.ts do not cover:
//
//   1. /sessions/1 has two chats. The SessionSidebar lists both,
//      and clicking the non-default chat (id 11) navigates to
//      /sessions/1/chats/11.
//   2. "Start New Chat" on the SessionSidebar hits the
//      /api/sessions/:id/chats/ POST, prepends a new chat to the
//      sidebar, and routes the URL to the new chat.
//   3. The standalone chat sidebar lists chats and selecting one
//      navigates to /chats/:id.
//
// State isolation:
//   - The e2eSessionChats map in handlers.ts seeds session 1 with
//     two chats. We use direct URL navigation for the sidebar
//     click-through so the test doesn't depend on row click event
//     propagation. The "Start New Chat" test relies on the POST
//     handler appending a new chat id; we reset via
//     /api/__e2e/reset in beforeEach so the spec runs in a single
//     worker with a known chat list.
//
// Reference: packages/ui/src/mocks/handlers.ts for the mock
// surface, packages/ui/src/components/SessionView/Sidebar/
// SessionSidebar.tsx for the sidebar + Start New Chat button,
// packages/ui/src/components/StandaloneChatView/
// StandaloneChatSidebarList.tsx for the standalone sidebar.
import { test, expect } from '@playwright/test';

test.describe.serial('Chat list navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(async () => {
      await fetch('/api/__e2e/reset', { method: 'POST' });
    });
  });

  test('switches between the two chats of session 1', async ({ page }) => {
    await page.goto('/sessions/1/chats/10');

    // The SessionSidebar (lg:flex) lists both seeded chats. We
    // locate the sidebar nav (role="navigation") and the chat
    // list item for chat 11. The chat items have role="button"
    // (ChatSidebarListItem.tsx:88) and a title attribute matching
    // the chat name or the "Chat (timestamp)" fallback.
    const sidebar = page
      .locator('nav')
      .filter({ has: page.getByRole('button', { name: 'Chat item options' }) });
    await expect(sidebar).toBeVisible();

    const secondChatButton = sidebar.getByRole('button', {
      name: 'Second chat',
    });
    await expect(secondChatButton).toBeVisible();

    await secondChatButton.click();
    await page.waitForURL(/\/sessions\/1\/chats\/11/);

    // Active state is announced via aria-current="page" on the
    // clicked item (ChatSidebarListItem.tsx:89). The other chat
    // should no longer be the active one.
    await expect(
      sidebar.getByRole('button', { name: 'Second chat' })
    ).toHaveAttribute('aria-current', 'page');
  });

  test('starts a new chat from the SessionSidebar', async ({ page }) => {
    // Session 2 has no chats in the seed, so the "Start New Chat"
    // button takes the place of a list. We use it to assert the
    // POST flow without having to interact with the list of 2.
    await page.goto('/sessions/2');

    // The "Start New Chat" button is rendered as an IconButton with
    // title="Start New Chat" (SessionSidebar.tsx:377). It sits
    // outside the <nav>, in the sidebar's header. The tabbed-layout
    // copy is also rendered but hidden on lg; `.first()` pins to
    // the visible one.
    const startNewChat = page.getByTitle('Start New Chat').first();
    await expect(startNewChat).toBeVisible();

    await startNewChat.click();

    // The mock POSTs to /api/sessions/2/chats/ and returns a new
    // chat. The seed for session 2 is empty, so the mock falls
    // back to id 10 (handlers.ts:1517-1520). The URL routes to
    // the new chat.
    await page.waitForURL(/\/sessions\/2\/chats\/\d+/);

    // The new chat is now in the sidebar (single entry).
    const sidebar = page
      .locator('nav')
      .filter({ has: page.getByRole('button', { name: 'Chat item options' }) });
    await expect(sidebar.getByText('Chat (')).toBeVisible();
  });

  test('navigates from the standalone chat sidebar to a chat', async ({
    page,
  }) => {
    await page.goto('/chats/42');

    // The "RECENT CHATS" section in the PersistentSidebar (line 303)
    // lists the two seeded standalone chats (42 + 43) as Link
    // elements. We click chat 43 and assert the URL.
    const recentChatsHeading = page.getByRole('button', {
      name: 'RECENT CHATS',
    });
    await expect(recentChatsHeading).toBeVisible();

    // The "Chat 43" link in the sidebar takes us to /chats/43.
    await page
      .getByRole('link', { name: /Chat 43/ })
      .first()
      .click();
    await page.waitForURL(/\/chats\/43/);
  });
});
