// @vitest-environment jsdom
// packages/ui/src/components/Verification/AccuracyTimelineCard.test.tsx
//
// Regression test for the Accuracy & Hallucinations chart side
// padding: the x-scale used to pin the first/last points exactly on
// the plot edges (padL / padL+innerW), so the edge bars — centered
// on those points — extended barW/2 over the y-axis tick labels on
// the left and past the SVG edge on the right. The edge x-axis
// labels had the same problem (centered exactly on the plot edge).
//
// The fix insets the x-range by half a bar width so every bar sits
// fully inside the plot frame, and anchors the first/last x labels
// inward (start/end).
//
// Assertions are structural (bars vs. gridline frame, label anchors)
// rather than hardcoded pixel values, so padding tweaks that keep
// the bars inside the frame stay green.
import React, { act } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Theme } from '@radix-ui/themes';
import type { VerificationTimepointStat } from '../../api/verification';
import { AccuracyTimelineCard } from './AccuracyTimelineCard';

function makePoint(
  partial: Partial<VerificationTimepointStat> & { date: string }
): VerificationTimepointStat {
  return {
    messagesAudited: 4,
    totalClaims: 8,
    accuracyPercent: 87.5,
    fabrications: 0,
    contradictions: 1,
    omissions: 0,
    ...partial,
  };
}

const FIVE_POINTS: VerificationTimepointStat[] = [
  '2026-06-19',
  '2026-06-20',
  '2026-06-21',
  '2026-06-22',
  '2026-06-23',
].map((date, i) =>
  makePoint({
    date,
    accuracyPercent: 80 + i,
    fabrications: i % 2,
    contradictions: 1,
    omissions: i % 3 === 0 ? 1 : 0,
  })
);

function renderCard(points: VerificationTimepointStat[] = FIVE_POINTS) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Theme>
        <AccuracyTimelineCard defaultPoints={points} models={[]} />
      </Theme>
    </QueryClientProvider>
  );
}

/** Stacked issue bars: the red/orange/amber rects (not gridlines). */
function barRects(svg: SVGSVGElement): SVGRectElement[] {
  return Array.from(svg.querySelectorAll('rect')).filter((rect) =>
    ['var(--red-9)', 'var(--orange-9)', 'var(--amber-9)'].includes(
      rect.getAttribute('fill') ?? ''
    )
  );
}

describe('AccuracyTimelineCard chart padding', () => {
  it('keeps every issue bar inside the y-axis gridline frame', () => {
    renderCard();
    const svg = screen.getByRole('img', {
      name: 'Accuracy trend across 5 days',
    }) as unknown as SVGSVGElement;

    // The plot frame: y gridlines span x1..x2.
    const gridline = svg.querySelector('line');
    const frameL = Number(gridline?.getAttribute('x1'));
    const frameR = Number(gridline?.getAttribute('x2'));
    expect(Number.isFinite(frameL)).toBe(true);
    expect(Number.isFinite(frameR)).toBe(true);

    const bars = barRects(svg);
    expect(bars.length).toBeGreaterThan(0);
    for (const bar of bars) {
      const x = Number(bar.getAttribute('x'));
      const w = Number(bar.getAttribute('width'));
      expect(x).toBeGreaterThanOrEqual(frameL);
      expect(x + w).toBeLessThanOrEqual(frameR);
    }
  });

  it('starts bars right of where the y-axis tick text ends', () => {
    renderCard();
    const svg = screen.getByRole('img', {
      name: 'Accuracy trend across 5 days',
    }) as unknown as SVGSVGElement;

    // Y ticks are the end-anchored percent texts ("0%".."100%",
    // not the end-anchored last x label): their anchor x is where
    // the glyphs end.
    const tickEnds = Array.from(svg.querySelectorAll('text'))
      .filter(
        (t) =>
          t.getAttribute('text-anchor') === 'end' &&
          t.textContent?.endsWith('%')
      )
      .map((t) => Number(t.getAttribute('x')));
    expect(tickEnds.length).toBe(5);
    const tickEnd = Math.max(...tickEnds);

    for (const bar of barRects(svg)) {
      expect(Number(bar.getAttribute('x'))).toBeGreaterThan(tickEnd);
    }
  });

  it('anchors the edge x-axis labels inward so they clear the frame', () => {
    renderCard();
    const svg = screen.getByRole('img', {
      name: 'Accuracy trend across 5 days',
    }) as unknown as SVGSVGElement;

    // X labels are the date texts ("MM-DD"); y ticks end with "%".
    const xLabels = Array.from(svg.querySelectorAll('text')).filter(
      (t) => !t.textContent?.endsWith('%')
    );
    expect(xLabels.length).toBe(5);
    expect(xLabels[0].getAttribute('text-anchor')).toBe('start');
    expect(xLabels[xLabels.length - 1].getAttribute('text-anchor')).toBe('end');
    for (const label of xLabels.slice(1, -1)) {
      expect(label.getAttribute('text-anchor')).toBe('middle');
    }
  });

  it('keeps the single-point bar centered inside the frame', () => {
    renderCard([makePoint({ date: '2026-06-23' })]);
    const svg = screen.getByRole('img', {
      name: 'Accuracy trend across 1 days',
    }) as unknown as SVGSVGElement;

    const gridline = svg.querySelector('line');
    const frameL = Number(gridline?.getAttribute('x1'));
    const frameR = Number(gridline?.getAttribute('x2'));
    const bars = barRects(svg);
    expect(bars.length).toBeGreaterThan(0);
    for (const bar of bars) {
      const x = Number(bar.getAttribute('x'));
      const w = Number(bar.getAttribute('width'));
      expect(x).toBeGreaterThanOrEqual(frameL);
      expect(x + w).toBeLessThanOrEqual(frameR);
    }
  });
});

// Per-data-point hover tooltips: every trend point renders its own
// AppTooltip (Radix) readout — date, messages audited, accuracy,
// and the claims breakdown — instead of the native SVG <title>.
// The focusable point group (dot + invisible full-height hover
// rect) drives the controlled open state, but the tooltip trigger
// is just the dot circle so the readout anchors at the data point
// instead of the middle of the chart.
describe('AccuracyTimelineCard point tooltips', () => {
  const TOOLTIP_POINTS: VerificationTimepointStat[] = [
    makePoint({
      date: '2026-06-19',
      messagesAudited: 2,
      totalClaims: 4,
      accuracyPercent: 75,
      fabrications: 1,
      contradictions: 0,
      omissions: 1,
    }),
    makePoint({
      date: '2026-06-20',
      messagesAudited: 3,
      totalClaims: 6,
      accuracyPercent: 83.3,
      fabrications: 0,
      contradictions: 1,
      omissions: 0,
    }),
    makePoint({
      date: '2026-06-21',
      messagesAudited: 1,
      totalClaims: 2,
      accuracyPercent: 100,
      fabrications: 0,
      contradictions: 0,
      omissions: 0,
    }),
  ];

  /** Per-point trigger groups, in date order. */
  function pointTriggers(svg: SVGSVGElement): SVGGElement[] {
    return Array.from(svg.querySelectorAll('g[data-date]'));
  }

  function expectedLines(p: VerificationTimepointStat): string[] {
    return [
      p.date,
      `${p.accuracyPercent.toFixed(1)}% accuracy`,
      `${p.messagesAudited} messages audited`,
      `${p.fabrications} fabricated`,
      `${p.contradictions} contradicted`,
      `${p.omissions} omitted`,
    ];
  }

  // Fresh render per point: cycling hover/unhover across triggers in
  // one jsdom render leaves the first Radix tooltip open (Radix close
  // timing relies on real pointer tracking), so each case hovers
  // exactly one trigger.
  it.each([0, 1, 2])(
    'shows point %s its own tooltip content on hover',
    async (i) => {
      const user = userEvent.setup();
      renderCard(TOOLTIP_POINTS);
      const svg = screen.getByRole('img', {
        name: 'Accuracy trend across 3 days',
      }) as unknown as SVGSVGElement;

      const triggers = pointTriggers(svg);
      expect(triggers).toHaveLength(3);

      await user.hover(triggers[i]);
      const lines = expectedLines(TOOLTIP_POINTS[i]);
      await waitFor(
        () => {
          const tooltip = screen.getByRole('tooltip');
          for (const line of lines) {
            expect(tooltip.textContent).toContain(line);
          }
          // And no other point's date leaks in.
          for (const other of TOOLTIP_POINTS.filter(
            (p) => p.date !== TOOLTIP_POINTS[i].date
          )) {
            expect(tooltip.textContent).not.toContain(other.date);
          }
        },
        { timeout: 3000 }
      );
    }
  );

  it('opens the point tooltip on keyboard focus', async () => {
    renderCard(TOOLTIP_POINTS);
    const svg = screen.getByRole('img', {
      name: 'Accuracy trend across 3 days',
    }) as unknown as SVGSVGElement;

    const triggers = pointTriggers(svg);
    expect(triggers[0].getAttribute('tabindex')).toBe('0');
    act(() => {
      triggers[1].focus();
    });
    await waitFor(
      () => {
        const tooltip = screen.getByRole('tooltip');
        for (const line of expectedLines(TOOLTIP_POINTS[1])) {
          expect(tooltip.textContent).toContain(line);
        }
      },
      { timeout: 3000 }
    );
  });

  it('uses Radix tooltips instead of native SVG titles', () => {
    renderCard(TOOLTIP_POINTS);
    const svg = screen.getByRole('img', {
      name: 'Accuracy trend across 3 days',
    }) as unknown as SVGSVGElement;
    expect(svg.querySelectorAll('title')).toHaveLength(0);
  });

  it('anchors each tooltip trigger to the dot circle, not the hover group', () => {
    renderCard(TOOLTIP_POINTS);
    const svg = screen.getByRole('img', {
      name: 'Accuracy trend across 3 days',
    }) as unknown as SVGSVGElement;

    // Radix Trigger (asChild) marks its child with data-state. The
    // trigger must be the dot circle: when the full-height hover
    // group was the trigger, the tooltip anchored to the middle of
    // the chart instead of the data point.
    const triggers = pointTriggers(svg);
    expect(triggers).toHaveLength(3);
    for (const group of triggers) {
      expect(group.hasAttribute('data-state')).toBe(false);
      const dot = group.querySelector('circle');
      expect(dot?.getAttribute('data-state')).toMatch(/^(open|closed)$/);
    }
  });
});
