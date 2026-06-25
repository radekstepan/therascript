import { describe, it, expect } from 'vitest';
import { parseSize } from './parseSize.js';

describe('parseSize', () => {
  describe('standard suffixes', () => {
    it('parses bare bytes', () => {
      expect(parseSize('1024')).toBe(1024);
      expect(parseSize('0')).toBe(0);
    });

    it('parses kilobytes (k and kb)', () => {
      expect(parseSize('1k')).toBe(1024);
      expect(parseSize('100kb')).toBe(100 * 1024);
      expect(parseSize('2K')).toBe(2 * 1024);
    });

    it('parses megabytes (m and mb)', () => {
      expect(parseSize('100m')).toBe(100 * 1024 * 1024);
      expect(parseSize('500MB')).toBe(500 * 1024 * 1024);
      expect(parseSize('99M')).toBe(99 * 1024 * 1024);
    });

    it('parses gigabytes (g and gb)', () => {
      expect(parseSize('1g')).toBe(1024 * 1024 * 1024);
      expect(parseSize('1G')).toBe(1024 * 1024 * 1024);
      expect(parseSize('2gb')).toBe(2 * 1024 * 1024 * 1024);
    });

    it('handles decimal values', () => {
      expect(parseSize('1.5g')).toBe(Math.floor(1.5 * 1024 * 1024 * 1024));
      expect(parseSize('0.5m')).toBe(Math.floor(0.5 * 1024 * 1024));
    });

    it('trims surrounding whitespace', () => {
      expect(parseSize('  100m  ')).toBe(100 * 1024 * 1024);
      expect(parseSize('\t1g\n')).toBe(1024 * 1024 * 1024);
    });
  });

  describe('inline `#` comments (Node --env-file bug)', () => {
    it('strips a trailing `# comment` from a gigabyte value', () => {
      expect(parseSize('1g # Example: 1 Gigabyte')).toBe(1024 * 1024 * 1024);
    });

    it('strips a trailing comment with extra whitespace', () => {
      expect(parseSize('100m   #   100 Megabytes limit')).toBe(
        100 * 1024 * 1024
      );
    });

    it('strips a comment when there is no space before #', () => {
      expect(parseSize('1g#comment')).toBe(1024 * 1024 * 1024);
    });
  });

  describe('garbage / edge cases', () => {
    it('returns 0 for empty string', () => {
      expect(parseSize('')).toBe(0);
    });

    it('returns 0 for whitespace-only string', () => {
      expect(parseSize('   ')).toBe(0);
    });

    it('returns 0 for a string that is only a comment', () => {
      expect(parseSize('# just a comment')).toBe(0);
    });

    it('returns 0 for unparseable input', () => {
      expect(parseSize('abc')).toBe(0);
      expect(parseSize('xyz123')).toBe(0);
    });

    it('returns 0 for negative values', () => {
      expect(parseSize('-1g')).toBe(0);
      expect(parseSize('-100')).toBe(0);
    });

    it('returns 0 for null or undefined', () => {
      expect(parseSize(null)).toBe(0);
      expect(parseSize(undefined)).toBe(0);
    });
  });

  describe('regression: the production bug', () => {
    it('99MB file under a 1GB limit parses the limit to 1 GiB, not 1 byte', () => {
      const rawEnvValue = '1g # Example: 1 Gigabyte';
      const maxBytes = parseSize(rawEnvValue);
      const fileSize = 99 * 1024 * 1024;
      expect(maxBytes).toBe(1024 * 1024 * 1024);
      expect(fileSize).toBeLessThan(maxBytes);
    });
  });
});
