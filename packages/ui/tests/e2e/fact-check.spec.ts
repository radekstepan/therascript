// packages/ui/tests/e2e/fact-check.spec.ts
//
// E2E coverage for fact checking on both surfaces:
//
//   1. The Fact Check hub (`/verification`): the Issues feed lists the
//      flagged fabricated claim, the Transcripts coverage tab links to
//      the session, and opening an issue deep-links into the session
//      chat with the Fact Check panel open at that statement.
//   2. The individual session transcript page
//      (`/sessions/1/chats/10`): the transcript renders beside the
//      chat, the note's severity link opens the docked movable Fact
//      Check panel, Prev/Next step through statements, and Dismiss
//      confirms the finding.
//
// State isolation:
//   - The fixture (chat messages + verifications + flagged feed) is
//     injected per-test via POST /api/__e2e/set-fact-check and
//     reseeded to empty by gotoAndResetMocks (POST /api/__e2e/reset)
//     in `beforeEach`, so this spec runs in the global pool without
//     `test.describe.serial`. The Dismiss click mutates only the
//     injected mock rows.
//   - The viewport is desktop-wide (1280px), so SessionContent uses
//     the side-by-side chat + transcript layout and only the desktop
//     ChatMessages instance drives the panel.
//
// Reference: packages/ui/src/components/Verification/
// StatementVerdictModal.tsx (docked movable panel) and
// IssuesFeedTab.tsx (deep link), ChatMessageBubble.tsx (footer link).
import { test, expect } from '@playwright/test';
import { gotoAndResetMocks } from './helpers';

const AI_TEXT = 'The client takes sertraline daily and has weekly sessions.';

const SEED = {
  chatMessages: [
    {
      id: 200,
      chatId: 10,
      sender: 'user',
      text: 'Did the client mention any medication?',
      timestamp: Date.parse('2026-06-23T14:05:00.000Z'),
    },
    {
      id: 201,
      chatId: 10,
      sender: 'ai',
      text: AI_TEXT,
      timestamp: Date.parse('2026-06-23T14:05:01.000Z'),
      promptTokens: null,
      completionTokens: 24,
      thinkingTokens: 0,
      duration: 1200,
    },
  ],
  verifications: [
    {
      id: 5,
      message_id: 201,
      chat_id: 10,
      session_id: 1,
      verification_job_id: 3,
      authored_model: 'mock-model',
      judge_model: 'e2e-judge-model',
      status: 'completed',
      total_claims: 2,
      supported_claims: 1,
      partial_claims: 0,
      contradicted_claims: 0,
      fabricated_claims: 1,
      omissions_count: 0,
      accuracy_score: 0.5,
      summary_assessment: 'One fabricated claim about daily medication.',
      prompt_tokens: 100,
      completion_tokens: 50,
      duration_ms: 1200,
      verified_at: Date.parse('2026-06-23T14:06:00.000Z'),
      error_message: null,
      statements: [
        {
          id: 301,
          message_verification_id: 5,
          message_id: 201,
          session_id: 1,
          statement_index: 0,
          kind: 'claim',
          exact_quote: 'The client takes sertraline daily.',
          normalized_claim: 'The client takes sertraline daily.',
          start_char: 0,
          end_char: 34,
          verdict: 'fabricated',
          severity: 'high',
          confidence: 0.92,
          reasoning: 'No mention of sertraline anywhere in the transcript.',
          transcript_evidence_json: null,
          evidence: [],
          created_at: Date.parse('2026-06-23T14:06:00.000Z'),
          review_status: 'unreviewed',
          confirmed_at: null,
          review_id: null,
          review_token: 'v1.e2e-token-301',
        },
        {
          id: 302,
          message_verification_id: 5,
          message_id: 201,
          session_id: 1,
          statement_index: 1,
          kind: 'claim',
          exact_quote: 'has weekly sessions',
          normalized_claim: 'The client has weekly sessions.',
          start_char: 38,
          end_char: 57,
          verdict: 'supported',
          severity: 'none',
          confidence: 0.99,
          reasoning: 'The transcript confirms weekly sessions.',
          transcript_evidence_json: null,
          evidence: [
            {
              paragraphIndex: 2,
              timestampMs: 14000,
              speaker: 'Therapist',
              quote: 'That sounds difficult. Let us explore that together.',
            },
          ],
          created_at: Date.parse('2026-06-23T14:06:00.000Z'),
          review_status: 'unreviewed',
          confirmed_at: null,
          review_id: null,
          review_token: 'v1.e2e-token-302',
        },
      ],
    },
  ],
  statements: [
    {
      id: 301,
      message_verification_id: 5,
      message_id: 201,
      session_id: 1,
      statement_index: 0,
      kind: 'claim',
      exact_quote: 'The client takes sertraline daily.',
      normalized_claim: 'The client takes sertraline daily.',
      start_char: 0,
      end_char: 34,
      verdict: 'fabricated',
      severity: 'high',
      confidence: 0.92,
      reasoning: 'No mention of sertraline anywhere in the transcript.',
      transcript_evidence_json: null,
      evidence: [],
      created_at: Date.parse('2026-06-23T14:06:00.000Z'),
      review_status: 'unreviewed',
      confirmed_at: null,
      review_id: null,
      review_token: 'v1.e2e-token-301',
      sessionName: 'Intake Session',
      clientName: 'Jane Doe',
      chatId: 10,
      authoredModel: 'mock-model',
      judgeModel: 'e2e-judge-model',
      verifiedAt: Date.parse('2026-06-23T14:06:00.000Z'),
    },
  ],
};

test.describe('Fact check coverage', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAndResetMocks(page);
    await page.evaluate(async (seed) => {
      const res = await fetch('/api/__e2e/set-fact-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(seed),
      });
      if (!res.ok) {
        throw new Error(`set-fact-check failed: ${res.status}`);
      }
    }, SEED);
  });

  test('Fact Check hub lists the flagged issue and deep-links into the session chat', async ({
    page,
  }) => {
    await page.goto('/verification');

    await expect(
      page.getByRole('heading', { name: 'Fact Check' })
    ).toBeVisible();

    // The Issues feed (default tab) shows the injected fabricated claim.
    const issueCard = page.getByRole('link', {
      name: /View Fabricated issue in chat/,
    });
    await expect(issueCard).toBeVisible();
    await expect(
      issueCard.getByText('The client takes sertraline daily.')
    ).toBeVisible();

    // The Transcripts coverage tab still links to the session.
    await page.getByRole('tab', { name: 'Transcripts coverage' }).click();
    await expect(
      page.getByRole('link', { name: 'Open transcript for Intake Session' })
    ).toBeVisible();

    // The Job history tab renders (empty mock run list).
    await page.getByRole('tab', { name: 'Job history' }).click();
    await expect(page.getByRole('tab', { name: 'Job history' })).toBeVisible();

    // Opening the issue deep-links into the chat with the Fact Check
    // panel open at the fabricated statement.
    await page.getByRole('tab', { name: 'Issues feed' }).click();
    await issueCard.click();
    await page.waitForURL(/\/sessions\/1\/chats\/10\?highlightMsg=201/);

    const dialog = page.getByTestId('fact-check-modal');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('FABRICATED', { exact: true })).toBeVisible();
    await expect(
      dialog.getByText('No mention of sertraline anywhere in the transcript.')
    ).toBeVisible();
  });

  test('session transcript page opens the docked movable panel beside the transcript', async ({
    page,
  }) => {
    await page.goto('/sessions/1/chats/10');

    // The transcript panel renders beside the chat.
    await expect(
      page.getByText('I have been feeling anxious for the past few months')
    ).toBeVisible();

    // The note's severity link opens the Fact Check panel.
    const metricsRow = page
      .locator('[data-testid="note-metrics-row"]:visible')
      .first();
    await metricsRow.getByText('1 Hallucination / Contradiction').click();

    const dialog = page.getByTestId('fact-check-modal');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('FABRICATED', { exact: true })).toBeVisible();

    // The panel renders immediately at its persisted position (no
    // entrance animation): wait for its box to settle before measuring
    // or dragging, or coordinates go stale.
    await expect
      .poll(async () => {
        const first = await dialog.boundingBox();
        await page.waitForTimeout(150);
        const second = await dialog.boundingBox();
        if (!first || !second) return 'missing';
        return Math.abs(first.x - second.x) < 1 &&
          Math.abs(first.y - second.y) < 1
          ? 'settled'
          : 'moving';
      })
      .toBe('settled');

    // The panel docks left of center, so the transcript stays visible
    // beside it (1280px viewport: the transcript fills the right half).
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeLessThan(100);
    expect(box!.x + box!.width).toBeLessThan(640);
    await expect(
      page.getByText('I have been feeling anxious for the past few months')
    ).toBeVisible();

    // Dragging the header handle moves the panel. Press down at the
    // handle's own center (hover position): the panel has real theme
    // padding, so a hardcoded offset from the panel corner can land
    // in the padding instead of on the handle.
    const handle = page.getByTestId('fact-check-drag-handle');
    await handle.hover();
    await page.mouse.down();
    await page.mouse.move(box!.x + 300, box!.y + 60, { steps: 5 });
    await page.mouse.up();
    const after = await dialog.boundingBox();
    expect(after!.x).toBeGreaterThan(box!.x);

    // Prev/Next step through both statements of the response, and each
    // step flashes its inline highlight in the note so the reader knows
    // where they are.
    const activeMark = page.locator('mark.verified-statement-mark-active');
    await dialog.getByRole('button', { name: 'Next' }).click();
    await expect(dialog.getByText('SUPPORTED', { exact: true })).toBeVisible();
    await expect(
      dialog.getByText('The client has weekly sessions.', { exact: true })
    ).toBeVisible();
    await expect(activeMark).toHaveText('has weekly sessions');
    await dialog.getByRole('button', { name: 'Prev' }).click();
    await expect(dialog.getByText('FABRICATED', { exact: true })).toBeVisible();
    await expect(activeMark).toHaveText('The client takes sertraline daily');

    // The drop point persists: closing and reopening the panel restores
    // it instead of docking left again.
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();
    await metricsRow.getByText('1 Hallucination / Contradiction').click();
    const reopened = page.getByTestId('fact-check-modal');
    await expect(reopened).toBeVisible();
    const reopenedBox = await reopened.boundingBox();
    expect(reopenedBox).not.toBeNull();
    expect(Math.abs(reopenedBox!.x - after!.x)).toBeLessThan(4);
    expect(Math.abs(reopenedBox!.y - after!.y)).toBeLessThan(4);

    // Dismiss confirms the finding with the short label + trash icon.
    await reopened.getByRole('button', { name: 'Dismiss' }).click();
    await expect(reopened.getByText(/Confirmed by you/)).toBeVisible();
  });

  test('re-clicking the same paragraph link re-highlights the paragraph', async ({
    page,
  }) => {
    await page.goto('/sessions/1/chats/10');

    const metricsRow = page
      .locator('[data-testid="note-metrics-row"]:visible')
      .first();
    await metricsRow.getByText('1 Hallucination / Contradiction').click();

    const dialog = page.getByTestId('fact-check-modal');
    await expect(dialog).toBeVisible();
    // Statement 2 carries transcript evidence with a ¶2 jump link.
    await dialog.getByRole('button', { name: 'Next' }).click();
    const jumpLink = dialog.getByRole('link', {
      name: 'Jump to transcript paragraph 2',
    });
    await expect(jumpLink).toBeVisible();

    const highlighted = page.locator('.highlight-paragraph', {
      hasText: 'That sounds difficult',
    });
    await jumpLink.click();
    await expect(highlighted).toBeVisible();

    // The highlight clears after ~2s; wait for the clear so the
    // re-click below proves a fresh highlight (count polling, not a
    // vacuous not-visible on zero matches).
    await expect
      .poll(async () => page.locator('.highlight-paragraph').count(), {
        timeout: 10000,
      })
      .toBe(0);

    // Same URL hash as before — the router changes nothing, but the
    // paragraph must highlight again.
    await jumpLink.click();
    await expect(highlighted).toBeVisible();
  });
});
