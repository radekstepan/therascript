// packages/ui/tests/e2e/search.spec.ts
//
// E2E for the global search input in TopToolbar.tsx. Covers the full
// flow: type → submit → URL updates with ?q= → SearchResultList
// renders the mocked results → click a transcript hit → URL has the
// #paragraph-N hash → click a chat hit → URL navigates to the chat.
//
// State isolation:
//   - The search endpoint is read-only: the handler returns canned
//     results for any query containing "anxious" or "anxiety" and an
//     empty set for anything else. No state is mutated, so this spec
//     runs in the global pool without `test.describe.serial`.
//
// Reference: packages/ui/src/mocks/handlers.ts for the /api/search
// response shape, packages/ui/src/components/Search/SearchResultList.tsx
// for the navigation logic, and packages/ui/src/components/Layout/TopToolbar.tsx
// for the search submit flow.
import { test, expect } from '@playwright/test';

const SEARCH_QUERY = 'anxiety';
const TRANSCRIPT_HIT_TEXT = 'I have been feeling anxious';
const CHAT_HIT_TEXT = 'coping strategies have you tried for anxiety';

test.describe('Global search', () => {
  test('submits a query, renders results, and navigates to a transcript hit', async ({
    page,
  }) => {
    await page.goto('/');

    // TopToolbar.tsx renders a single search input in the top app bar.
    // We locate it by accessible name (placeholder) to avoid pinning to
    // a Radix internal id.
    const searchInput = page.getByPlaceholder(
      'Search all messages and transcripts...'
    );
    await expect(searchInput).toBeVisible();
    await searchInput.fill(SEARCH_QUERY);
    await searchInput.press('Enter');

    // TopToolbar.handleSearchSubmit navigates to /?q=<encoded> when we
    // are not on the dashboard, but we *are* on the dashboard, so the
    // params are just set in place. Either way, wait for ?q=anxiety.
    await page.waitForURL(/[?&]q=anxiety/);

    // The mocked /api/search handler returns one transcript hit + one
    // chat hit for "anxiety" queries. The SearchResultList renders
    // each as a button-like Box; the snippet HTML for the transcript
    // hit includes the highlighted "anxious" stem.
    const main = page.locator('main');
    await expect(main.getByText(TRANSCRIPT_HIT_TEXT)).toBeVisible();
    await expect(main.getByText(CHAT_HIT_TEXT)).toBeVisible();

    // The "Showing 2 of 2 results" header is rendered by
    // SearchResultList.tsx:106-110 and confirms the count is wired
    // through from the API response.
    await expect(main.getByText(/Showing 2 of 2 results/)).toBeVisible();

    // Click the transcript hit. The handler returns id "1_1" so the
    // navigation logic in SearchResultList.tsx:50-69 extracts the
    // paragraph index and routes to /sessions/1#paragraph-1.
    await main.getByText(TRANSCRIPT_HIT_TEXT).click();
    await page.waitForURL(/\/sessions\/1#paragraph-1/);
  });

  test('navigates to a chat result for session-scoped searches', async ({
    page,
  }) => {
    await page.goto('/');

    const searchInput = page.getByPlaceholder(
      'Search all messages and transcripts...'
    );
    await searchInput.fill(SEARCH_QUERY);
    await searchInput.press('Enter');
    await page.waitForURL(/[?&]q=anxiety/);

    const main = page.locator('main');
    const chatHit = main.getByText(CHAT_HIT_TEXT);
    await expect(chatHit).toBeVisible();
    await chatHit.click();

    // The chat result links to /sessions/1/chats/10 (item.sessionId +
    // item.chatId), as the handler types it. We do not need to wait
    // for any chat to mount — the URL change is the contract.
    await page.waitForURL(/\/sessions\/1\/chats\/10/);
  });

  test('renders the empty-state card when no results match', async ({
    page,
  }) => {
    await page.goto('/');

    const searchInput = page.getByPlaceholder(
      'Search all messages and transcripts...'
    );
    // Use a query the mock returns 0 results for.
    await searchInput.fill('zzz-no-match-zzz');
    await searchInput.press('Enter');

    const main = page.locator('main');
    await expect(
      main.getByText(/No results found for "zzz-no-match-zzz"/)
    ).toBeVisible();
  });

  test('clears the search via the X button', async ({ page }) => {
    await page.goto('/');
    const searchInput = page.getByPlaceholder(
      'Search all messages and transcripts...'
    );
    await searchInput.fill('anxiety');
    await searchInput.press('Enter');
    await page.waitForURL(/[?&]q=anxiety/);

    // The X clear button is rendered as a Radix IconButton with
    // aria-label="Clear search" (TopToolbar.tsx:187-194). It always
    // appears once a value is entered.
    await page.getByRole('button', { name: 'Clear search' }).click();

    // handleClearSearch drops the q param via setSearchParams. The
    // landing page should render the Session History card again,
    // proving the URL no longer has ?q=anxiety.
    await expect(
      page.getByRole('heading', { name: /Session History/i })
    ).toBeVisible();
    await expect(page).not.toHaveURL(/[?&]q=anxiety/);
  });
});
