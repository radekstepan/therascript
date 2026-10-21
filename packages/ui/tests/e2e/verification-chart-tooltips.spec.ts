// packages/ui/tests/e2e/verification-chart-tooltips.spec.ts
//
// E2E for the Accuracy & Hallucinations chart per-data-point hover
// tooltips: every trend point owns an AppTooltip (Radix) readout
// with that point's date, messages audited, accuracy, and claims
// breakdown — replacing the native SVG <title> elements.
//
// The test loads /verification (the analytics section renders above
// the tabs), hovers individual point triggers
// (`g[data-date]` — the dot plus its invisible full-height hover
// rect), and asserts the Radix tooltip shows that point's own data.
// A keyboard-focus case covers the same readout without a pointer.
//
// State isolation:
//   - Read-only: the verification handlers return canned fixtures
//     (see ../src/mocks/handlers/verification.ts), so this spec
//     runs in the global pool without `test.describe.serial`.
//
// Reference: packages/ui/src/components/Verification/
// AccuracyTimelineCard.tsx (TrendChart), and the jsdom regression
// coverage in AccuracyTimelineCard.test.tsx.
import { test, expect } from '@playwright/test';
import { gotoAndResetMocks } from './helpers';

test.describe('Verification accuracy chart tooltips', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAndResetMocks(page);
    await page.goto('/verification');
    // The mock stats fixture seeds five trend points.
    await expect(
      page.getByRole('img', { name: 'Accuracy trend across 5 days' })
    ).toBeVisible();
  });

  test('hovering a point shows that point’s own readout', async ({ page }) => {
    const chart = page.getByRole('img', {
      name: 'Accuracy trend across 5 days',
    });
    // No native SVG titles remain — the Radix tooltip owns the readout.
    await expect(chart.locator('title')).toHaveCount(0);

    await chart.locator('g[data-date="2026-06-20"]').hover();
    const tooltip = page.getByRole('tooltip');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText([
      '2026-06-20',
      '83.3% accuracy',
      '3 messages audited',
      '0 fabricated',
      '1 contradicted',
      '0 omitted',
    ]);
    await expect(tooltip).not.toContainText('2026-06-19');
  });

  test('a different point shows different content', async ({ page }) => {
    const chart = page.getByRole('img', {
      name: 'Accuracy trend across 5 days',
    });
    await chart.locator('g[data-date="2026-06-22"]').hover();
    const tooltip = page.getByRole('tooltip');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText([
      '2026-06-22',
      '90.0% accuracy',
      '5 messages audited',
      '1 fabricated',
      '1 contradicted',
      '0 omitted',
    ]);
    await expect(tooltip).not.toContainText('2026-06-20');
  });

  test('keyboard focus opens the point readout', async ({ page }) => {
    const chart = page.getByRole('img', {
      name: 'Accuracy trend across 5 days',
    });
    await chart.locator('g[data-date="2026-06-21"]').focus();
    const tooltip = page.getByRole('tooltip');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText([
      '2026-06-21',
      '100.0% accuracy',
      '1 messages audited',
    ]);
  });
});
