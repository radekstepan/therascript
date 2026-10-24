// @vitest-environment jsdom
// packages/ui/src/utils/modelDisplay.test.ts
//
// Display-name overrides for stored LLM ids: DB values stay verbatim,
// the UI renders the short human name consistently.
import { describe, it, expect } from 'vitest';
import {
  formatModelDisplayName,
  mergeModelAccuracyStatsByDisplayName,
  MODEL_DISPLAY_OVERRIDES,
  UNKNOWN_MODEL_DISPLAY_NAME,
  type MergeableModelAccuracyStat,
} from './modelDisplay';

describe('formatModelDisplayName', () => {
  it('maps the pinned overrides', () => {
    expect(formatModelDisplayName('gemma3:12b-it-qat')).toBe('gemma3-12b');
    expect(formatModelDisplayName('qwen/qwen3.5-9b')).toBe('qwen3.5-9b');
  });

  it('passes through ids that are already human names', () => {
    expect(formatModelDisplayName('qwen3.5-9b')).toBe('qwen3.5-9b');
    expect(formatModelDisplayName('qwen3.8-27b')).toBe('qwen3.8-27b');
    expect(formatModelDisplayName('Unknown Model')).toBe('Unknown Model');
  });

  it('normalizes missing and legacy-cased unknown labels', () => {
    expect(formatModelDisplayName(null)).toBe(UNKNOWN_MODEL_DISPLAY_NAME);
    expect(formatModelDisplayName(undefined)).toBe(UNKNOWN_MODEL_DISPLAY_NAME);
    expect(formatModelDisplayName('')).toBe(UNKNOWN_MODEL_DISPLAY_NAME);
    expect(formatModelDisplayName('   ')).toBe(UNKNOWN_MODEL_DISPLAY_NAME);
    expect(formatModelDisplayName('Unknown model')).toBe(
      UNKNOWN_MODEL_DISPLAY_NAME
    );
    expect(formatModelDisplayName('unknown model')).toBe(
      UNKNOWN_MODEL_DISPLAY_NAME
    );
  });

  it('strips vendor prefixes for unpinned slash ids', () => {
    expect(formatModelDisplayName('qwen/qwen3.8-27b')).toBe('qwen3.8-27b');
    expect(formatModelDisplayName('vendor/custom-model')).toBe('custom-model');
  });

  it('trims surrounding whitespace before mapping', () => {
    expect(formatModelDisplayName('  gemma3:12b-it-qat  ')).toBe('gemma3-12b');
  });

  it('keeps the override table in sync with the task contract', () => {
    expect(MODEL_DISPLAY_OVERRIDES).toEqual({
      'gemma3:12b-it-qat': 'gemma3-12b',
      'qwen/qwen3.5-9b': 'qwen3.5-9b',
    });
  });
});

describe('mergeModelAccuracyStatsByDisplayName', () => {
  function makeRow(
    partial: Partial<MergeableModelAccuracyStat> & { model: string }
  ): MergeableModelAccuracyStat {
    return {
      messagesAudited: 1,
      totalClaims: 4,
      supportedClaims: 4,
      partialClaims: 0,
      contradictedClaims: 0,
      fabricatedClaims: 0,
      omissions: 0,
      accuracyPercent: 100,
      fabricationRate: 0,
      contradictionRate: 0,
      omissionsPerMessage: 0,
      averageAccuracyScore: 1.0,
      ...partial,
    };
  }

  it('folds aliased raw ids into one row per display name', () => {
    const merged = mergeModelAccuracyStatsByDisplayName([
      makeRow({
        model: 'qwen/qwen3.5-9b',
        messagesAudited: 3,
        totalClaims: 10,
        supportedClaims: 8,
        contradictedClaims: 1,
        fabricatedClaims: 1,
        omissions: 1,
        averageAccuracyScore: 0.8,
      }),
      makeRow({
        model: 'qwen3.5-9b',
        messagesAudited: 1,
        totalClaims: 4,
        supportedClaims: 4,
        averageAccuracyScore: 1.0,
      }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.model).toBe('qwen3.5-9b');
    expect(merged[0]!.messagesAudited).toBe(4);
    expect(merged[0]!.totalClaims).toBe(14);
    expect(merged[0]!.supportedClaims).toBe(12);
    expect(merged[0]!.contradictedClaims).toBe(1);
    expect(merged[0]!.fabricatedClaims).toBe(1);
    expect(merged[0]!.omissions).toBe(1);
    // Pooled backend formula: (12 + 0.5*0) / (14 + 1) * 100 = 80.
    expect(merged[0]!.accuracyPercent).toBeCloseTo(80, 10);
    expect(merged[0]!.fabricationRate).toBeCloseTo((1 / 14) * 100, 10);
    expect(merged[0]!.contradictionRate).toBeCloseTo((1 / 14) * 100, 10);
    expect(merged[0]!.omissionsPerMessage).toBeCloseTo(1 / 4, 10);
    // Messages-weighted mean of the per-group averages.
    expect(merged[0]!.averageAccuracyScore).toBeCloseTo(
      (0.8 * 3 + 1.0 * 1) / 4,
      10
    );
  });

  it('keeps distinct display names as separate rows, sorted by audited desc', () => {
    const merged = mergeModelAccuracyStatsByDisplayName([
      makeRow({ model: 'model-beta', messagesAudited: 1 }),
      makeRow({ model: 'model-alpha', messagesAudited: 5 }),
    ]);
    expect(merged.map((m) => m.model)).toEqual(['model-alpha', 'model-beta']);
  });

  it('normalizes a singleton row to its display name', () => {
    const merged = mergeModelAccuracyStatsByDisplayName([
      makeRow({ model: 'gemma3:12b-it-qat' }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.model).toBe('gemma3-12b');
  });

  it('returns an empty array for empty input', () => {
    expect(mergeModelAccuracyStatsByDisplayName([])).toEqual([]);
  });
});
