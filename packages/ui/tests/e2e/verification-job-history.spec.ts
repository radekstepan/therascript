// packages/ui/tests/e2e/verification-job-history.spec.ts
//
// E2E for failure-aware verification job history: a mixed-outcome run
// (completed + failed_messages > 0) renders "Completed with errors"
// with its outcome split, and "View" opens the failure dialog
// with the persisted job summary. The per-message failures endpoint
// returns an empty list in the mock worker (no failures were seeded),
// so the dialog shows the re-audit note alongside the summary.
//
// State isolation:
//   - The injected job list is mock-worker state, reseeded to [] by
//     gotoAndResetMocks (POST /api/__e2e/reset) in `beforeEach`, so
//     this spec runs in the global pool without
//     `test.describe.serial`. The spec only opens a read-only dialog.
//
// Reference: packages/ui/src/components/Verification/JobHistoryTab.tsx
// and JobFailuresDialog.tsx, with jsdom coverage in
// JobHistoryTab.details.test.tsx.
import { test, expect } from '@playwright/test';
import { gotoAndResetMocks } from './helpers';

const MIXED_JOB = {
  id: 8,
  status: 'completed',
  scope: 'all_unverified',
  session_ids_json: null,
  chat_id: null,
  skip_verified: true,
  total_messages: 3,
  processed_messages: 3,
  succeeded_messages: 2,
  failed_messages: 1,
  skipped_messages: 0,
  current_phase: null,
  current_message_id: null,
  current_attempt: null,
  phase_updated_at: null,
  total_statements: 20,
  flagged_statements: 1,
  omissions_count: 0,
  created_at: Date.now() - 60_000,
  completed_at: Date.now(),
  error_message:
    'Completed with errors: 2 of 3 checked, 1 failed (job 8, judge "e2e-judge-model").',
  model_name: 'e2e-judge-model',
  context_size: 32768,
  thinking_budget: null,
  temperature: 0.2,
  top_p: 0.9,
  repeat_penalty: 1.1,
  num_gpu_layers: null,
  llm_base_url: null,
};

test.describe('Verification job history failures', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAndResetMocks(page);
    await page.evaluate(async (job) => {
      const res = await fetch('/api/__e2e/set-verification-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobs: [job] }),
      });
      if (!res.ok) {
        throw new Error(`set-verification-jobs failed: ${res.status}`);
      }
    }, MIXED_JOB);
  });

  test('mixed run shows Completed with errors and a View dialog', async ({
    page,
  }) => {
    await page.goto('/verification');

    await page.getByRole('tab', { name: 'Job history' }).click();

    // Mixed outcome: never unqualified success.
    await expect(page.getByText('Completed with errors')).toBeVisible();
    await expect(page.getByText('2 checked · 1 failed')).toBeVisible();

    // The banner's "View details" button also contains "View" — match
    // the Job History action exactly.
    await page.getByRole('button', { name: 'View', exact: true }).click();
    const dialog = page.getByRole('dialog', {
      name: 'Audit #8 — failure details',
    });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText(/Completed with errors: 2 of 3 checked, 1 failed/)
    ).toBeVisible();
  });
});
