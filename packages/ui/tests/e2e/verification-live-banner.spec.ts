// packages/ui/tests/e2e/verification-live-banner.spec.ts
//
// E2E for the "Audit #N in progress" banner: it must not render the
// Live / Connecting connectivity pill. The banner previously showed
// a green Wifi "Live" badge next to the heading once the SSE stream
// connected (or a gray WifiOff "Connecting…" badge before that);
// connection state is internal detail and the pill added noise to
// the progress card.
//
// The test injects a processing job via POST
// /api/__e2e/set-verification-jobs (the default jobs fixture is an
// empty list, so no banner renders without it), loads /verification
// in the real browser with real Radix CSS/JS, and asserts within
// the banner card: the heading and progress content render, the
// Cancel Job action is present, and neither "Live" nor "Connecting"
// text appears — covering both branches of the removed conditional
// regardless of whether the (unmocked) SSE stream connects.
//
// State isolation:
//   - The injected job list is mock-worker state, reseeded to [] by
//     gotoAndResetMocks (POST /api/__e2e/reset) in `beforeEach`, so
//     this spec runs in the global pool without
//     `test.describe.serial`. The spec never clicks Cancel, so no
//     mutation leaks either.
//
// Reference: packages/ui/src/components/Verification/
// VerificationAuditPage.tsx (LiveJobBanner), and the jsdom
// regression coverage in VerificationAuditPage.test.tsx.
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

test.describe('Verification live banner', () => {
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

  test('in-progress banner has no Live connectivity pill', async ({ page }) => {
    await page.goto('/verification');

    const banner = page.locator('.rt-Card', {
      has: page.getByRole('heading', { name: 'Audit #7 in progress' }),
    });
    await expect(banner).toBeVisible();

    // Both branches of the removed isConnected conditional are gone.
    await expect(banner.getByText('Live', { exact: true })).toHaveCount(0);
    await expect(banner.getByText(/Connecting/)).toHaveCount(0);

    // The banner itself stays intact: progress copy + cancel action.
    await expect(banner.getByText(/Processed 4 \/ 10 messages/)).toBeVisible();
    await expect(
      banner.getByRole('button', { name: 'Cancel Job' })
    ).toBeVisible();
  });
});
