// packages/ui/tests/e2e/verification-chart-padding.spec.ts
//
// E2E for the Accuracy & Hallucinations chart side padding: the
// x-scale used to pin the first/last points exactly on the plot
// edges, so the edge bars — centered on those points — extended
// half a bar over the y-axis tick labels ("0%".."100%") on the
// left and past the SVG edge on the right. The edge x-axis labels
// hung half outside the plot frame for the same reason.
//
// The test loads /verification (the analytics section renders above
// the tabs), reads the trend chart's SVG geometry, and asserts
// every issue bar sits fully inside the y-axis gridline frame,
// right of where the tick text ends, and that the edge x labels
// anchor inward (start/end).
//
// Geometry is read structurally (bars vs. gridline x1/x2, anchors)
// rather than as hardcoded pixels, so padding tweaks that keep the
// bars inside the frame stay green.
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

interface ChartGeometry {
  frameL: number;
  frameR: number;
  viewBoxWidth: number;
  tickEnd: number;
  bars: Array<{ x: number; width: number }>;
  xLabelAnchors: string[];
}

test.describe('Verification accuracy chart padding', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAndResetMocks(page);
  });

  test('issue bars clear the axes text and stay inside the frame', async ({
    page,
  }) => {
    await page.goto('/verification');

    // The mock stats fixture seeds five trend points, each with at
    // least one flagged issue so every date renders stacked bars.
    const chart = page.getByRole('img', {
      name: 'Accuracy trend across 5 days',
    });
    await expect(chart).toBeVisible();

    const geometry: ChartGeometry = await chart.evaluate((svg) => {
      const gridline = svg.querySelector('line');
      const viewBoxWidth = Number(
        svg.getAttribute('viewBox')?.split(' ')[2] ?? NaN
      );
      const tickEnd = Math.max(
        ...Array.from(svg.querySelectorAll('text'))
          .filter(
            (t) =>
              t.getAttribute('text-anchor') === 'end' &&
              t.textContent?.endsWith('%')
          )
          .map((t) => Number(t.getAttribute('x')))
      );
      const bars = Array.from(svg.querySelectorAll('rect'))
        .filter((rect) =>
          ['var(--red-9)', 'var(--orange-9)', 'var(--amber-9)'].includes(
            rect.getAttribute('fill') ?? ''
          )
        )
        .map((rect) => ({
          x: Number(rect.getAttribute('x')),
          width: Number(rect.getAttribute('width')),
        }));
      const xLabelAnchors = Array.from(svg.querySelectorAll('text'))
        .filter((t) => !t.textContent?.endsWith('%'))
        .map((t) => t.getAttribute('text-anchor') ?? '');
      return {
        frameL: Number(gridline?.getAttribute('x1')),
        frameR: Number(gridline?.getAttribute('x2')),
        viewBoxWidth,
        tickEnd,
        bars,
        xLabelAnchors,
      };
    });

    // Sanity: the frame, tick zone, and bars were all found.
    expect(Number.isFinite(geometry.frameL)).toBe(true);
    expect(Number.isFinite(geometry.frameR)).toBe(true);
    expect(Number.isFinite(geometry.viewBoxWidth)).toBe(true);
    expect(Number.isFinite(geometry.tickEnd)).toBe(true);
    expect(geometry.bars.length).toBeGreaterThan(0);

    // Every bar sits fully inside the gridline frame — the left
    // edge bars no longer cover the y-axis tick labels and the
    // right edge bars no longer clip past the SVG edge.
    for (const bar of geometry.bars) {
      expect(bar.x).toBeGreaterThanOrEqual(geometry.frameL);
      expect(bar.x + bar.width).toBeLessThanOrEqual(geometry.frameR);
      expect(bar.x + bar.width).toBeLessThanOrEqual(geometry.viewBoxWidth);
    }

    // Every bar starts right of where the y-axis tick glyphs end.
    for (const bar of geometry.bars) {
      expect(bar.x).toBeGreaterThan(geometry.tickEnd);
    }

    // The edge x labels anchor inward so they clear the frame.
    expect(geometry.xLabelAnchors.length).toBe(5);
    expect(geometry.xLabelAnchors[0]).toBe('start');
    expect(geometry.xLabelAnchors[geometry.xLabelAnchors.length - 1]).toBe(
      'end'
    );
  });
});
