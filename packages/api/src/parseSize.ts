/**
 * Parse a size string with optional unit suffix into a byte count.
 *
 * Supported suffixes (case-insensitive): k/kb, m/mb, g/gb, or bare bytes.
 *
 * Node's built-in `--env-file` loader does not strip inline `#` comments, so
 * a value like `"1g # Example: 1 Gigabyte"` arrives intact. This helper
 * strips everything from the first `#` onward before parsing, so a stray
 * comment never silently degrades the cap to 1 byte.
 */
export const parseSize = (sizeStr: string | undefined | null): number => {
  if (!sizeStr) return 0;
  const cleaned = sizeStr
    .replace(/\s*#.*$/, '')
    .trim()
    .toLowerCase();
  if (!cleaned) return 0;
  const v = parseFloat(cleaned);
  if (isNaN(v) || v < 0) return 0;
  if (cleaned.endsWith('gb')) return v * 1024 * 1024 * 1024;
  if (cleaned.endsWith('g')) return v * 1024 * 1024 * 1024;
  if (cleaned.endsWith('mb')) return v * 1024 * 1024;
  if (cleaned.endsWith('m')) return v * 1024 * 1024;
  if (cleaned.endsWith('kb')) return v * 1024;
  if (cleaned.endsWith('k')) return v * 1024;
  return v;
};
