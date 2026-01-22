import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import {
  queryWithValidation,
  queryWithValidationSafe,
  queryWithValidationSingle,
} from './queryWrapper.js';

const TestSchema = z.object({
  id: z.number(),
  name: z.string(),
});

type TestRow = z.infer<typeof TestSchema>;

describe('queryWithValidation', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('returns validated rows when all data is valid', () => {
    const query = () => [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ];

    const result = queryWithValidation(query, TestSchema);

    expect(result).toEqual([
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ]);
  });

  it('returns empty array when query returns empty results', () => {
    const query = () => [];

    const result = queryWithValidation(query, TestSchema);

    expect(result).toEqual([]);
  });

  it('throws error on first invalid row', () => {
    const query = () => [
      { id: 1, name: 'Alice' },
      { id: 'invalid', name: 'Bob' },
    ];

    expect(() => queryWithValidation(query, TestSchema)).toThrow(
      'Database row validation failed'
    );
    expect(console.error).toHaveBeenCalled();
  });

  it('throws error when required field is missing', () => {
    const query = () => [{ id: 1 }];

    expect(() => queryWithValidation(query, TestSchema)).toThrow(
      'Database row validation failed'
    );
  });
});

describe('queryWithValidationSafe', () => {
  it('returns all rows as success when all data is valid', () => {
    const query = () => [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ];

    const result = queryWithValidationSafe(query, TestSchema);

    expect(result.success).toEqual([
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ]);
    expect(result.failed).toEqual([]);
  });

  it('returns empty arrays when query returns empty results', () => {
    const query = () => [];

    const result = queryWithValidationSafe(query, TestSchema);

    expect(result.success).toEqual([]);
    expect(result.failed).toEqual([]);
  });

  it('separates valid and invalid rows', () => {
    const validRow = { id: 1, name: 'Alice' };
    const invalidRow = { id: 'invalid', name: 'Bob' };

    const query = () => [validRow, invalidRow];

    const result = queryWithValidationSafe(query, TestSchema);

    expect(result.success).toEqual([{ id: 1, name: 'Alice' }]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].row).toEqual(invalidRow);
    expect(result.failed[0].error).toBeDefined();
  });

  it('returns all rows as failed when none are valid', () => {
    const query = () => [
      { id: 'a', name: 123 },
      { id: 'b', name: 456 },
    ];

    const result = queryWithValidationSafe(query, TestSchema);

    expect(result.success).toEqual([]);
    expect(result.failed).toHaveLength(2);
  });

  it('includes error message in failed rows', () => {
    const query = () => [{ id: 'not-a-number', name: 'Test' }];

    const result = queryWithValidationSafe(query, TestSchema);

    expect(result.failed[0].error).toContain('Expected number');
  });
});

describe('queryWithValidationSingle', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('returns validated row when data is valid', () => {
    const query = () => ({ id: 1, name: 'Alice' });

    const result = queryWithValidationSingle(query, TestSchema);

    expect(result).toEqual({ id: 1, name: 'Alice' });
  });

  it('returns null when query returns null', () => {
    const query = () => null;

    const result = queryWithValidationSingle(query, TestSchema);

    expect(result).toBeNull();
  });

  it('throws error when row is invalid', () => {
    const query = () => ({ id: 'invalid', name: 'Alice' });

    expect(() => queryWithValidationSingle(query, TestSchema)).toThrow(
      'Database row validation failed'
    );
    expect(console.error).toHaveBeenCalled();
  });

  it('throws error when required field is missing', () => {
    const query = () => ({ id: 1 });

    expect(() => queryWithValidationSingle(query, TestSchema)).toThrow(
      'Database row validation failed'
    );
  });

  it('handles undefined differently from null', () => {
    const query = () => undefined;

    expect(() => queryWithValidationSingle(query, TestSchema)).toThrow(
      'Database row validation failed'
    );
  });
});
