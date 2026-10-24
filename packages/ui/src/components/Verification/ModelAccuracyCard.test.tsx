// @vitest-environment jsdom
// packages/ui/src/components/Verification/ModelAccuracyCard.test.tsx
//
// Regression test for the Accuracy by Authoring LLM double
// horizontal scrollbar: the table used to be wrapped in an outer
// <div style="overflow-x: auto"> while Radix's <Table.Root> rendered
// its own inner <ScrollArea> (which always mounts a horizontal
// scrollbar), stacking two horizontal scrollbars at the card bottom.
//
// The fix keeps a single scroll owner — the outer overflow-x div —
// and renders a plain <table> (the repo's rt-sticky-table pattern,
// matching AnalysisJobsPage and the session list tables) carrying
// the 720px min-width itself, so narrow cards scroll once.
//
// Assertions are structural (no nested Radix scroll area, one
// overflow-x owner on the table's ancestor chain, min-width kept on
// the table) rather than pixel measurements, so styling tweaks that
// keep a single scroller stay green.
import React, { act } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Theme } from '@radix-ui/themes';
import type { ModelAccuracyStat } from '../../api/verification';
import { ModelAccuracyCard } from './ModelAccuracyCard';

function makeStat(partial: Partial<ModelAccuracyStat>): ModelAccuracyStat {
  return {
    model: 'e2e-judge-model',
    messagesAudited: 4,
    totalClaims: 8,
    supportedClaims: 7,
    partialClaims: 0,
    contradictedClaims: 1,
    fabricatedClaims: 0,
    omissions: 0,
    accuracyPercent: 87.5,
    fabricationRate: 0,
    contradictionRate: 12.5,
    omissionsPerMessage: 0,
    averageAccuracyScore: 87.5,
    ...partial,
  };
}

const STATS: ModelAccuracyStat[] = [
  makeStat({ model: 'model-alpha' }),
  makeStat({ model: 'model-beta', accuracyPercent: 75 }),
];

function renderCard(stats: ModelAccuracyStat[] = STATS) {
  return render(
    <Theme>
      <ModelAccuracyCard stats={stats} />
    </Theme>
  );
}

/** The card element: the table's closest Radix Card ancestor. */
function cardOf(table: HTMLElement): HTMLElement {
  const card = table.closest('.rt-Card');
  expect(card).not.toBeNull();
  return card as HTMLElement;
}

describe('ModelAccuracyCard single horizontal scroller', () => {
  it('renders one table with every audited model', () => {
    renderCard();
    const tables = screen.getAllByRole('table');
    expect(tables).toHaveLength(1);
    const card = within(cardOf(tables[0] as HTMLElement));
    expect(
      card.getByRole('heading', { name: 'Accuracy by Authoring LLM' })
    ).toBeDefined();
    expect(card.getByText('model-alpha')).toBeDefined();
    expect(card.getByText('model-beta')).toBeDefined();
  });

  it('renders no nested Radix scroll area inside the card', () => {
    const { container } = renderCard();
    const table = screen.getByRole('table');
    const card = cardOf(table as HTMLElement);

    // Pre-fix this finds Table.Root's inner ScrollArea (which mounts
    // the second horizontal scrollbar); post-fix there is none.
    expect(card.querySelector('.rt-ScrollAreaRoot')).toBeNull();
    expect(
      card.querySelector(
        '.rt-ScrollAreaScrollbar[data-orientation="horizontal"]'
      )
    ).toBeNull();
    expect(container).toBeDefined();
  });

  it('keeps the outer overflow-x div as the single scroll owner', () => {
    renderCard();
    const table = screen.getByRole('table') as unknown as HTMLTableElement;

    // The table carries the min-width itself so the single owner has
    // something to scroll on narrow cards.
    expect(table.tagName).toBe('TABLE');
    expect(table.classList.contains('rt-TableRootTable')).toBe(true);
    expect(table.style.minWidth).toBe('720px');

    // Exactly one overflow-x scroller between the card and the
    // table: the table's direct parent. Pre-fix the parent is the
    // ScrollArea viewport (no inline overflow-x) with the real
    // scroller a level further out — i.e. two nested scrollers.
    const card = cardOf(table as unknown as HTMLElement);
    const scrollers: HTMLElement[] = [];
    let node: HTMLElement | null = table.parentElement;
    while (node !== null && card.contains(node)) {
      if (
        node.style.overflowX === 'auto' ||
        node.style.overflowX === 'scroll'
      ) {
        scrollers.push(node);
      }
      node = node.parentElement;
    }
    expect(scrollers).toHaveLength(1);
    expect(scrollers[0]).toBe(table.parentElement);
  });
});

describe('ModelAccuracyCard rate scales', () => {
  // Backend contract (verificationRepository.getGlobalVerificationAnalytics):
  // fabricationRate/contradictionRate arrive pooled and percent-scaled
  // (fabricated/total*100), like accuracyPercent — e.g. 1 fabricated
  // claim of 28 audited claims is 3.571, not 0.03571. The card must
  // render them as-is; multiplying by 100 again shows 357.1%.
  const POOLED_RATE = (1 / 28) * 100; // 3.571...

  it('renders pooled percent-scale rates without re-scaling', () => {
    renderCard([
      makeStat({
        model: 'pool-model',
        messagesAudited: 7,
        totalClaims: 28,
        supportedClaims: 26,
        contradictedClaims: 1,
        fabricatedClaims: 1,
        accuracyPercent: 92.9,
        fabricationRate: POOLED_RATE,
        contradictionRate: POOLED_RATE,
      }),
    ]);
    // Both the Fabricated and Contradicted columns show 3.6%.
    expect(screen.getAllByText('3.6%')).toHaveLength(2);
    // Pre-fix double-scaling symptom: 3.571 * 100 = 357.1%.
    expect(screen.queryByText('357.1%')).toBeNull();
  });

  it('never renders a fabricated/contradicted rate above 100%', () => {
    renderCard([
      makeStat({
        model: 'pool-model',
        messagesAudited: 7,
        totalClaims: 28,
        supportedClaims: 26,
        contradictedClaims: 1,
        fabricatedClaims: 1,
        accuracyPercent: 92.9,
        fabricationRate: POOLED_RATE,
        contradictionRate: POOLED_RATE,
      }),
    ]);
    const table = screen.getByRole('table');
    const percents = within(table as HTMLElement)
      .getAllByText(/^[0-9.]+%$/)
      .map((el) => parseFloat(el.textContent ?? ''));
    expect(percents.length).toBeGreaterThan(0);
    for (const pct of percents) {
      expect(pct).toBeGreaterThanOrEqual(0);
      expect(pct).toBeLessThanOrEqual(100);
    }
  });
});

describe('ModelAccuracyCard display-name merging', () => {
  // The backend groups by raw stored id, so `qwen/qwen3.5-9b` and
  // `qwen3.5-9b` arrive as separate rows sharing one display name. The
  // card must fold them into a single `qwen3.5-9b` row (counts summed)
  // instead of rendering the same human name twice.
  it('merges aliased raw ids into one row per display name', () => {
    renderCard([
      makeStat({
        model: 'qwen/qwen3.5-9b',
        messagesAudited: 3,
        totalClaims: 10,
        supportedClaims: 8,
        contradictedClaims: 1,
        fabricatedClaims: 1,
        omissions: 1,
        accuracyPercent: 0, // stale per-row value: merge recomputes it
        fabricationRate: 0,
        contradictionRate: 0,
      }),
      makeStat({
        model: 'qwen3.5-9b',
        messagesAudited: 1,
        totalClaims: 4,
        supportedClaims: 4,
        accuracyPercent: 0,
      }),
    ]);
    const table = screen.getByRole('table');
    // One data row (header row + exactly one body row).
    expect(within(table as HTMLElement).getAllByRole('row')).toHaveLength(2);
    expect(
      within(table as HTMLElement).getByRole('rowheader', {
        name: 'qwen3.5-9b',
      })
    ).toBeDefined();
    // Merged counts: 3 + 1 audited, 10 + 4 claims.
    const cells = within(table as HTMLElement).getAllByRole('cell');
    expect(cells[1]?.textContent).toBe('4');
    expect(cells[2]?.textContent).toBe('14');
  });
});

describe('ModelAccuracyCard claim mix tooltip', () => {
  // The Claim mix bar owns an AppTooltip (Radix, portaled) readout with
  // that model's own claim counts — hovering the bar must show its
  // breakdown, and a different model's bar must show different content.
  // Radix renders the tooltip in a portal, so the readout escapes the
  // table's overflow-x scroller instead of being clipped by it.
  const TOOLTIP_STATS: ModelAccuracyStat[] = [
    makeStat({
      model: 'model-alpha',
      messagesAudited: 4,
      totalClaims: 8,
      supportedClaims: 7,
      partialClaims: 0,
      contradictedClaims: 1,
      fabricatedClaims: 0,
    }),
    makeStat({
      model: 'model-beta',
      messagesAudited: 2,
      totalClaims: 5,
      supportedClaims: 1,
      partialClaims: 2,
      contradictedClaims: 1,
      fabricatedClaims: 1,
    }),
  ];

  it('shows the hovered model its own claim breakdown', async () => {
    const user = userEvent.setup();
    renderCard(TOOLTIP_STATS);

    const bar = screen.getByRole('img', {
      name: 'model-alpha: 88% supported, 0% partial, 13% contradicted or fabricated',
    });
    await user.hover(bar);
    await waitFor(
      () => {
        const tooltip = screen.getByRole('tooltip');
        expect(tooltip.textContent).toContain('model-alpha');
        expect(tooltip.textContent).toContain('7 supported');
        expect(tooltip.textContent).toContain('8 claims across 4 audited');
        expect(tooltip.textContent).not.toContain('model-beta');
      },
      { timeout: 3000 }
    );
  });

  it('shows a different model different content', async () => {
    const user = userEvent.setup();
    renderCard(TOOLTIP_STATS);

    const bar = screen.getByRole('img', {
      name: 'model-beta: 20% supported, 40% partial, 40% contradicted or fabricated',
    });
    await user.hover(bar);
    await waitFor(
      () => {
        const tooltip = screen.getByRole('tooltip');
        expect(tooltip.textContent).toContain('model-beta');
        expect(tooltip.textContent).toContain('1 supported');
        expect(tooltip.textContent).toContain('2 partial');
        expect(tooltip.textContent).not.toContain('model-alpha');
      },
      { timeout: 3000 }
    );
  });

  it('opens the bar tooltip on keyboard focus', async () => {
    renderCard(TOOLTIP_STATS);

    const bar = screen.getByRole('img', {
      name: /model-alpha:/,
    });
    act(() => {
      (bar as HTMLElement).focus();
    });
    await waitFor(
      () => {
        const tooltip = screen.getByRole('tooltip');
        expect(tooltip.textContent).toContain('model-alpha');
      },
      { timeout: 3000 }
    );
  });
});
