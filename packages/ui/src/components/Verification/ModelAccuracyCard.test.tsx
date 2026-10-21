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
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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
    contradictionRate: 0.125,
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
