// packages/ui/tests/e2e/jobs-queue-verification.spec.ts
//
// E2E for the Active Jobs Queue modal: it must list in-progress
// verification (fact-check) jobs. The sidebar "Active Jobs" badge is
// fed by GET /api/jobs/active-count, which is verification-aware —
// but the modal only queried analysis jobs, transcribing sessions,
// and client-side LLM jobs, so during a fact check the badge showed
// 1 while the modal showed "No active jobs in the queue."
//
// The test injects a processing job via POST
// /api/__e2e/set-verification-jobs (the default jobs fixture is an
// empty list), opens the modal from the sidebar, and asserts the
// Verification Jobs section renders the Audit #7 card with a
// processing badge. Clicking the card navigates to /verification.
//
// State isolation:
//   - The injected job list is mock-worker state, reseeded to [] by
//     gotoAndResetMocks (POST /api/__e2e/reset) in `beforeEach`, so
//     this spec runs in the global pool without
//     `test.describe.serial`. The spec performs no mutations.
//   - The seeded analysis fixture (id 100, mapping) also renders in
//     the modal; the jsdom suite covers the exact all-others-empty
//     scenario, so this spec only asserts the Verification section
//     is present and navigates — which is what failed pre-fix.
//
// Reference: packages/ui/src/components/Jobs/JobsQueueModal.tsx,
// and the jsdom regression coverage in JobsQueueModal.test.tsx.
import { test, expect } from '@playwright/test';
import { gotoAndResetMocks } from './helpers';

const PROCESSING_JOB = {
  id: 7,
  status: 'processing',
  scope: 'all_unverified',
  session_ids_json: null,
  chat_id: null,
  skip_verified: true,
  total_messages: 10,
  processed_messages: 4,
  total_statements: 20,
  flagged_statements: 1,
  omissions_count: 0,
  created_at: Date.now() - 60_000,
  completed_at: null,
  error_message: null,
  model_name: 'e2e-judge-model',
  context_size: 32768,
  thinking_budget: null,
  temperature: 0.2,
  top_p: 0.9,
  repeat_penalty: 1.1,
  num_gpu_layers: null,
  llm_base_url: null,
};

test.describe('Jobs queue modal verification jobs', () => {
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
    }, PROCESSING_JOB);
  });

  test('modal lists an in-progress fact-check job', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: /Active Jobs/ }).click();

    const dialog = page.getByRole('dialog', { name: /Active Jobs Queue/ });
    await expect(dialog).toBeVisible();

    await expect(
      dialog.getByRole('heading', { name: 'Verification Jobs (1)' })
    ).toBeVisible();
    const card = dialog.locator('.rt-Card', {
      has: dialog.getByText('Audit #7: all unverified'),
    });
    await expect(card).toBeVisible();
    await expect(card.getByText('processing', { exact: true })).toBeVisible();
    await expect(card.getByText(/Processed: 4 \/ 10 messages/)).toBeVisible();

    await card.click();
    await expect(page).toHaveURL(/\/verification$/);
  });
});
