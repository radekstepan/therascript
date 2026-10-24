// @vitest-environment jsdom
// packages/ui/src/utils/modelDisplay.test.ts
//
// Display-name overrides for stored LLM ids: DB values stay verbatim,
// the UI renders the short human name consistently.
import { describe, it, expect } from 'vitest';
import {
  formatModelDisplayName,
  MODEL_DISPLAY_OVERRIDES,
  UNKNOWN_MODEL_DISPLAY_NAME,
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
