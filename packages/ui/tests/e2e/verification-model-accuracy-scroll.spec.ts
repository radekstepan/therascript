// packages/ui/tests/e2e/verification-model-accuracy-scroll.spec.ts
//
// E2E for the Accuracy by Authoring LLM double horizontal scrollbar:
// the table used to sit in an outer <div style="overflow-x: auto">
// while Radix's <Table.Root> rendered its own inner <ScrollArea>
// (which always mounts a horizontal scrollbar), stacking two
// horizontal scrollbars at the card bottom on narrow cards — the
// card sits in a 2-column grid at xl inside a 1200px-max page, so
// its 720px min-width table always overflows half-width cards.
//
// The fix keeps a single scroll owner — the outer overflow-x div —
// and renders a plain <table> carrying the 720px min-width itself.
//
// The test loads /verification (the analytics section renders above
// the tabs) and asserts structurally, inside the real browser with
// real Radix CSS/JS: no nested Radix scroll area or horizontal
// scrollbar in the card, exactly one overflow-x scroller between
// the card and the table, and the min-width kept on the table — so
// styling tweaks that keep a single scroller stay green.
//
// State isolation:
//   - Read-only: the verification handlers return canned fixtures
//     (see ../src/mocks/handlers/verification.ts), so this spec
//     runs in the global pool without `test.describe.serial`.
//
// Reference: packages/ui/src/components/Verification/
// ModelAccuracyCard.tsx, and the jsdom regression coverage in
// ModelAccuracyCard.test.tsx.
import { test, expect } from '@playwright/test';
import { gotoAndResetMocks } from './helpers';

interface CardScrollStructure {
  tableCount: number;
  hasModelFixture: boolean;
  scrollAreaCount: number;
  horizontalScrollbarCount: number;
  tableMinWidth: string;
  scrollerCount: number;
  scrollerIsTableParent: boolean;
}

test.describe('Verification model accuracy single scroller', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAndResetMocks(page);
  });

  test('accuracy card has one horizontal scroll owner, no nested scrollbar', async ({
    page,
  }) => {
    await page.goto('/verification');

    const card = page.locator('.rt-Card', {
      has: page.getByRole('heading', { name: 'Accuracy by Authoring LLM' }),
    });
    await expect(card).toBeVisible();
    await expect(card.getByRole('table')).toBeVisible();

    const structure: CardScrollStructure = await card.evaluate((el) => {
      const table = el.querySelector('table');
      const scrollers: Element[] = [];
      let scrollerIsTableParent = false;
      if (table) {
        let node: HTMLElement | null = table.parentElement;
        while (node !== null && el.contains(node)) {
          const overflowX = getComputedStyle(node).overflowX;
          if (overflowX === 'auto' || overflowX === 'scroll') {
            scrollers.push(node);
            if (node === table.parentElement) {
              scrollerIsTableParent = true;
            }
          }
          node = node.parentElement;
        }
      }
      return {
        tableCount: el.querySelectorAll('table').length,
        hasModelFixture: (el.textContent ?? '').includes('e2e-judge-model'),
        scrollAreaCount: el.querySelectorAll('.rt-ScrollAreaRoot').length,
        horizontalScrollbarCount: el.querySelectorAll(
          '.rt-ScrollAreaScrollbar[data-orientation="horizontal"]'
        ).length,
        tableMinWidth: table ? getComputedStyle(table).minWidth : '',
        scrollerCount: scrollers.length,
        scrollerIsTableParent,
      };
    });

    // Sanity: one table rendered with the mocked per-model stats.
    expect(structure.tableCount).toBe(1);
    expect(structure.hasModelFixture).toBe(true);

    // No nested Radix scroll area — the second scrollbar is gone.
    expect(structure.scrollAreaCount).toBe(0);
    expect(structure.horizontalScrollbarCount).toBe(0);

    // The table keeps its min-width and the outer overflow-x div is
    // the single scroll owner.
    expect(structure.tableMinWidth).toBe('720px');
    expect(structure.scrollerCount).toBe(1);
    expect(structure.scrollerIsTableParent).toBe(true);
  });
});
