// packages/ui/tests/e2e/verification-coverage.spec.ts
//
// E2E for the jump-to-transcript navigation from the verification
// dashboard's "Transcripts coverage" tab. Covers the flow:
// /verification → Transcripts coverage tab → click the session-name
// link → SessionView auto-redirects /sessions/1 to the latest chat
// (/sessions/1/chats/10) with the transcript panel visible.
//
// State isolation:
//   - All endpoints hit are read-only: the verification handlers
//     return canned fixtures (see ../src/mocks/handlers/
//     verification.ts) and the session-1 meta/transcript seeds are
//     untouched, so this spec runs in the global pool without
//     `test.describe.serial`.
//
// Reference: packages/ui/src/components/Verification/CoverageTab.tsx
// for the link, packages/ui/src/components/SessionView/SessionView.tsx
// for the latest-chat auto-redirect.
import { test, expect } from '@playwright/test';
import { gotoAndResetMocks } from './helpers';

test.describe('Verification transcripts coverage', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAndResetMocks(page);
  });

  test('session name links to the session transcript view', async ({
    page,
  }) => {
    await page.goto('/verification');

    // The coverage table lives behind the "Transcripts coverage" tab
    // (VerificationAuditPage.tsx Tabs). The mocked stats fixture seeds
    // one row for session 1 ("Intake Session").
    await page.getByRole('tab', { name: 'Transcripts coverage' }).click();
    const coverageLink = page.getByRole('link', {
      name: 'Open transcript for Intake Session',
    });
    await expect(coverageLink).toBeVisible();
    await expect(coverageLink).toHaveAttribute('href', '/sessions/1');

    // Clicking navigates to the bare session route; SessionView then
    // auto-redirects to the latest chat (chat 10 per the mock seeds).
    await coverageLink.click();
    await page.waitForURL('/sessions/1/chats/10');

    // The session view mounted with a live chat panel: the
    // ChatPanelHeader "Configure AI Model" button only renders once
    // a chat is active (see session-chat.spec.ts for the precedent).
    await expect(
      page.getByRole('button', { name: 'Configure AI Model' }).first()
    ).toBeVisible();

    // And the transcript panel rendered the seeded paragraphs
    // side-by-side (desktop layout in SessionContent.tsx).
    await expect(
      page.getByText('I have been feeling anxious for the past few months')
    ).toBeVisible();
  });
});
