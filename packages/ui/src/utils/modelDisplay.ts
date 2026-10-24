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

/**
 * Structural subset of `ModelAccuracyStat` needed to merge aliased rows.
 * (Declared structurally so this util stays decoupled from the API types;
 * `ModelAccuracyStat` in `api/verification.ts` satisfies it.)
 */
export interface MergeableModelAccuracyStat {
  model: string;
  messagesAudited: number;
  totalClaims: number;
  supportedClaims: number;
  partialClaims: number;
  contradictedClaims: number;
  fabricatedClaims: number;
  omissions: number;
  accuracyPercent: number;
  fabricationRate: number;
  contradictionRate: number;
  omissionsPerMessage: number;
  averageAccuracyScore: number;
}

/**
 * Merge per-model accuracy rows that share a display name.
 *
 * The backend groups `byModel` by raw stored id, so aliased ids
 * (`qwen/qwen3.5-9b` vs `qwen3.5-9b`) arrive as separate rows that would
 * render as duplicate lines in Accuracy by Authoring LLM. This folds them
 * into one row per display name: counts are summed and derived rates are
 * recomputed with the same pooled formulas the backend uses
 * (`pooledAccuracyPercent` / `safePercent` in `verificationRepository`).
 * `averageAccuracyScore` merges as a messages-weighted mean (the pooled
 * equivalent of the backend's per-group `AVG(accuracy_score)`).
 *
 * Single-row groups pass through with `model` normalized to the display
 * name. Output is sorted like the backend: `messagesAudited` desc, then
 * display name asc. The returned `model` is always the display name.
 */
export function mergeModelAccuracyStatsByDisplayName<
  T extends MergeableModelAccuracyStat,
>(stats: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const stat of stats) {
    const display = formatModelDisplayName(stat.model);
    const list = groups.get(display) ?? [];
    list.push(stat);
    groups.set(display, list);
  }
  const merged: T[] = [];
  for (const [display, group] of groups) {
    const first = group[0]!;
    if (group.length === 1) {
      merged.push(
        first.model === display ? first : { ...first, model: display }
      );
      continue;
    }
    let messagesAudited = 0;
    let totalClaims = 0;
    let supportedClaims = 0;
    let partialClaims = 0;
    let contradictedClaims = 0;
    let fabricatedClaims = 0;
    let omissions = 0;
    let weightedAccuracy = 0;
    for (const s of group) {
      messagesAudited += s.messagesAudited;
      totalClaims += s.totalClaims;
      supportedClaims += s.supportedClaims;
      partialClaims += s.partialClaims;
      contradictedClaims += s.contradictedClaims;
      fabricatedClaims += s.fabricatedClaims;
      omissions += s.omissions;
      weightedAccuracy += s.averageAccuracyScore * s.messagesAudited;
    }
    merged.push({
      ...first,
      model: display,
      messagesAudited,
      totalClaims,
      supportedClaims,
      partialClaims,
      contradictedClaims,
      fabricatedClaims,
      omissions,
      accuracyPercent:
        totalClaims + omissions === 0
          ? 100
          : ((supportedClaims + 0.5 * partialClaims) /
              (totalClaims + omissions)) *
            100,
      fabricationRate:
        totalClaims > 0 ? (fabricatedClaims / totalClaims) * 100 : 0,
      contradictionRate:
        totalClaims > 0 ? (contradictedClaims / totalClaims) * 100 : 0,
      omissionsPerMessage:
        messagesAudited > 0 ? omissions / messagesAudited : 0,
      averageAccuracyScore:
        messagesAudited > 0 ? weightedAccuracy / messagesAudited : 0,
    });
  }
  merged.sort(
    (a, b) =>
      b.messagesAudited - a.messagesAudited || a.model.localeCompare(b.model)
  );
  return merged;
}
