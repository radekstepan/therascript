// packages/ui/src/utils/modelDisplay.ts
//
// Central human-readable display names for LLM identifiers.
//
// Raw model ids are stored verbatim in the DB (`messages.model`,
// `message_verifications.authored_model` / `judge_model`,
// `verification_jobs.model_name`, `usage_logs.model`). Display layers must
// never rename those values — they only map them for rendering so filters
// and API params keep using the raw id while the user sees the short name:
//
//   gemma3:12b-it-qat -> gemma3-12b
//   qwen/qwen3.5-9b   -> qwen3.5-9b
//
// `qwen3.5-9b`, `qwen3.8-27b`, and `Unknown Model` already read as human
// names and pass through unchanged.

export const UNKNOWN_MODEL_DISPLAY_NAME = 'Unknown Model';

/**
 * Explicit raw-id -> display-name overrides. The generic slash-strip
 * fallback below already covers most `vendor/model` ids, but these are
 * pinned so the human name stays stable even if the fallback changes.
 */
export const MODEL_DISPLAY_OVERRIDES: Record<string, string> = {
  'gemma3:12b-it-qat': 'gemma3-12b',
  'qwen/qwen3.5-9b': 'qwen3.5-9b',
};

/**
 * Map a stored model id to its human-readable display name.
 *
 * - null/undefined/empty/whitespace -> `Unknown Model`
 * - case-insensitive `unknown model` (any casing) -> `Unknown Model`
 * - exact override match -> override value
 * - `vendor/model` ids -> substring after the last `/`
 * - everything else passes through trimmed
 *
 * Never throws; always returns a non-empty display string.
 */
export function formatModelDisplayName(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return UNKNOWN_MODEL_DISPLAY_NAME;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return UNKNOWN_MODEL_DISPLAY_NAME;
  if (trimmed.toLowerCase() === 'unknown model')
    return UNKNOWN_MODEL_DISPLAY_NAME;
  const override = MODEL_DISPLAY_OVERRIDES[trimmed];
  if (override) return override;
  const slashIndex = trimmed.lastIndexOf('/');
  if (slashIndex >= 0 && slashIndex < trimmed.length - 1) {
    const stripped = trimmed.slice(slashIndex + 1).trim();
    if (stripped.length > 0) {
      const strippedOverride = MODEL_DISPLAY_OVERRIDES[stripped];
      if (strippedOverride) return strippedOverride;
      // Preserve the canonical unknown label even when vendor-prefixed.
      if (stripped.toLowerCase() === 'unknown model')
        return UNKNOWN_MODEL_DISPLAY_NAME;
      return stripped;
    }
  }
  return trimmed;
}
