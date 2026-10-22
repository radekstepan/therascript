/**
 * Human-review (statement dismissal) identity, fingerprinting, and
 * effective-scoring helpers.
 *
 * These helpers are the shared contract between the verification worker
 * (which computes keys/revisions at audit time), the data repository
 * (which matches durable reviews to current statements inside SQLite
 * transactions), and the API (which mints/validates opaque review tokens).
 * They live in `@therascript/domain` so no data/API layer needs to import
 * the worker, and they are pure TypeScript with no Node-only imports so the
 * package stays runtime-agnostic.
 *
 * Identity rules (see tasks.md "Storage and identity contract"):
 *  1. Same owning message, finding kind, and material revision. A changed
 *     answer, therapist question, or transcript invalidates automatic reuse.
 *  2. Resolved claims match on canonical normalized claim + canonical quote
 *     + resolved offsets (distinguishes repeated text).
 *  3. A span alone is insufficient: distinct normalized claims stay separate.
 *  4. Unresolved claims require exact canonical quote + claim; ambiguous
 *     duplicates confirm only the selected row and never auto-reuse.
 *  5. Omissions match on canonical omission text + canonical transcript
 *     evidence (no paragraph-id dependence).
 *  6. Paraphrases/splits/merges are NOT matched; only
 *     typography/whitespace variants are.
 */

/** Identity-format version stored on every review row. */
export const VERIFICATION_REVIEW_IDENTITY_VERSION = 1;

/** Human-review state attached to a statement at read time. */
export type StatementReviewStatus = 'unreviewed' | 'confirmed';

/** Review metadata exposed on every statement read. */
export interface StatementReviewMetadata {
  review_status: StatementReviewStatus;
  confirmed_at: number | null;
  review_id: number | null;
  /**
   * Opaque token covering the immutable statement snapshot + material
   * revision. Mutable review status is excluded so repeats are idempotent.
   */
  review_token: string | null;
}

/** Transcript paragraph shape needed for material fingerprinting. */
export interface MaterialTranscriptParagraph {
  paragraphIndex: number;
  timestampMs: number;
  speaker: string | null;
  text: string;
}

export interface MaterialRevisionInput {
  /** Visible AI answer (thinking already removed, same convention as worker/UI). */
  visibleAnswer: string;
  /** Preceding therapist question, or '' when unknown. */
  userQuestion: string | null;
  /** Full relevant transcript content in any order (sorted internally). */
  transcript: MaterialTranscriptParagraph[];
}

export interface ClaimKeyInput {
  kind: 'claim';
  exactQuote: string;
  normalizedClaim: string;
  startChar: number | null;
  endChar: number | null;
}

export interface OmissionKeyInput {
  kind: 'omission';
  normalizedClaim: string;
  evidence: Array<{
    timestampMs: number | null;
    speaker: string | null;
    quote: string;
  }>;
}

export type FindingKeyInput = ClaimKeyInput | OmissionKeyInput;

export interface ReviewTokenInput {
  statementId: number;
  messageId: number;
  kind: 'claim' | 'omission';
  /** Material revision of the assessment ('' for legacy rows without one). */
  materialRevision: string;
  exactQuote: string;
  normalizedClaim: string;
  startChar: number | null;
  endChar: number | null;
  verdict: string;
  severity: string;
  confidence: number;
  reasoning: string;
  /** Raw transcript_evidence_json (or '' when none). */
  evidenceJson: string | null;
}

export interface EffectiveStatementInput {
  kind: 'claim' | 'omission';
  verdict:
    | 'supported'
    | 'partially_supported'
    | 'contradicted'
    | 'fabricated'
    | 'omission';
  reviewStatus: StatementReviewStatus;
}

export interface EffectiveVerificationCounts {
  totalClaims: number;
  supportedClaims: number;
  partialClaims: number;
  contradictedClaims: number;
  fabricatedClaims: number;
  omissionsCount: number;
  /** 0–1 units; 1.0 when the denominator is zero. Never pre-rounded. */
  accuracyScore: number;
}

// --- minimal pure-TS SHA-256 (no Node-only imports) ---------------------------

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLen = bytes.length * 8;
  const paddedLen = (((bytes.length + 8) >> 6) + 1) << 6;
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 4, bitLen >>> 0);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 2 ** 32));

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let off = 0; off < paddedLen; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 =
        ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^
        ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^
        (w[i - 15] >>> 3);
      const s1 =
        ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^
        ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^
        (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let i = 0; i < 64; i++) {
      const s1 =
        ((e >>> 6) | (e << 26)) ^
        ((e >>> 11) | (e << 21)) ^
        ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + s1 + ch + SHA256_K[i]! + w[i]!) >>> 0;
      const s0 =
        ((a >>> 2) | (a << 30)) ^
        ((a >>> 13) | (a << 19)) ^
        ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((v) => v.toString(16).padStart(8, '0'))
    .join('');
}

// --- canonicalization (mirrors worker/UI span conventions) --------------------

const MARKDOWN_STRIP_CHARS = new Set(['*', '_', '`', '~']);
const QUOTE_NORMALIZE_CHARS = new Set(['"', "'", '“', '”', '‘', '’']);
const DASH_NORMALIZE_CHARS = new Set(['–', '—']);
const OUTER_QUOTE_PAIRS: Record<string, string> = {
  '"': '"',
  "'": "'",
  '“': '”',
  '‘': '’',
};
const LEADING_ELLIPSIS_RE = /^(?:\.{2,}|…+)\s*/;
const TRAILING_ELLIPSIS_RE = /\s*(?:\.{2,}|…+)$/;

/**
 * Strip matching outer quotation marks and leading/trailing ellipses the
 * Judge tends to add. Mirrors `cleanExactQuote` (worker) /
 * `cleanQuoteForMatch` (UI).
 */
export function stripOuterQuoteOrnaments(quote: string): string {
  let cleaned = quote.trim();
  for (let pass = 0; pass < 2; pass++) {
    cleaned = cleaned
      .replace(LEADING_ELLIPSIS_RE, '')
      .replace(TRAILING_ELLIPSIS_RE, '')
      .trim();
    if (cleaned.length >= 2) {
      const first = cleaned[0]!;
      const last = cleaned[cleaned.length - 1]!;
      if (OUTER_QUOTE_PAIRS[first] === last) {
        cleaned = cleaned.slice(1, -1).trim();
      }
    }
  }
  return cleaned;
}

/**
 * Canonical finding text: quote-ornament stripped, inline Markdown tokens
 * dropped, whitespace collapsed, quote/dash variants unified, lowercased.
 * Numbers, negation, names (case-folded), and meaningful punctuation survive;
 * only typography/whitespace variants collapse. Judge ordering, severity,
 * confidence, and reasoning never participate in identity.
 */
export function canonicalizeFindingText(value: string): string {
  const stripped = stripOuterQuoteOrnaments(value);
  let out = '';
  let pendingSpace = true; // trim leading whitespace
  for (const ch of stripped) {
    if (MARKDOWN_STRIP_CHARS.has(ch)) continue;
    if (/\s/.test(ch)) {
      pendingSpace = true;
      continue;
    }
    if (pendingSpace && out.length > 0) out += ' ';
    pendingSpace = false;
    let c = ch;
    if (QUOTE_NORMALIZE_CHARS.has(ch)) c = "'";
    else if (DASH_NORMALIZE_CHARS.has(ch)) c = '-';
    out += c.toLowerCase();
  }
  return out;
}

/** Canonical speaker label for identity purposes (UNKNOWN/blank → ''). */
export function canonicalizeSpeakerLabel(speaker: string | null): string {
  const trimmed = (speaker ?? '').trim();
  if (trimmed.length === 0) return '';
  if (trimmed.toUpperCase() === 'UNKNOWN') return '';
  return trimmed;
}

// --- material revision ---------------------------------------------------------

/**
 * Fingerprint of the material actually evaluated: visible answer, therapist
 * question, and full transcript content in deterministic
 * paragraphIndex order with meaningful speaker labels.
 *
 * Deliberately excludes audit date, Judge model, run id, statement ordering,
 * and the truncated transcript window sent to the LLM, so changing the Judge
 * or context size alone never erases a human decision. Uses paragraphIndex
 * (content identity, stable across backup remaps) — never DB row ids.
 */
export function computeMaterialRevision(input: MaterialRevisionInput): string {
  const answer = (input.visibleAnswer ?? '').trim();
  const question = (input.userQuestion ?? '').trim();
  const paragraphs = [...input.transcript]
    .sort(
      (a, b) =>
        a.paragraphIndex - b.paragraphIndex || a.timestampMs - b.timestampMs
    )
    .map((p) => ({
      i: p.paragraphIndex,
      t: p.timestampMs,
      s: canonicalizeSpeakerLabel(p.speaker),
      x: p.text,
    }));
  const canonical = JSON.stringify({
    v: VERIFICATION_REVIEW_IDENTITY_VERSION,
    a: answer,
    q: question,
    p: paragraphs,
  });
  return `v${VERIFICATION_REVIEW_IDENTITY_VERSION}.${sha256Hex(canonical)}`;
}

// --- finding keys --------------------------------------------------------------

/**
 * Deterministic finding key for one Judge finding within a material revision.
 *
 * - Resolved claim: canonical normalized claim + canonical quote + resolved
 *   offsets (offsets distinguish repeated text; rule 2). Two atomic claims
 *   sharing one span stay separate via the normalized claim (rule 3).
 * - Unresolved claim: canonical quote + canonical claim only (rule 4);
 *   callers detect ambiguity via {@link isUnresolvedClaimAmbiguous} and store
 *   ambiguous confirmations as non-reusable row associations.
 * - Omission: canonical omission text + canonical evidence content/location
 *   (sorted; no paragraph-id dependence) (rule 5).
 *
 * Paraphrases, splits, and merges intentionally do NOT match (rule 6): only
 * typography/whitespace variants collapse.
 */
export function computeFindingKey(input: FindingKeyInput): string {
  const v = `v${VERIFICATION_REVIEW_IDENTITY_VERSION}`;
  if (input.kind === 'omission') {
    const claim = canonicalizeFindingText(input.normalizedClaim);
    const evidence = [...input.evidence]
      .map(
        (e) =>
          `${e.timestampMs ?? ''}|${canonicalizeFindingText(e.speaker ?? '')}|${canonicalizeFindingText(e.quote)}`
      )
      .sort()
      .join('\n');
    return `${v}/omission/${sha256Hex(`${claim}\n${evidence}`)}`;
  }
  const claim = canonicalizeFindingText(input.normalizedClaim);
  const quote = canonicalizeFindingText(input.exactQuote);
  const core = sha256Hex(`${claim}\n${quote}`);
  if (
    typeof input.startChar === 'number' &&
    Number.isInteger(input.startChar) &&
    typeof input.endChar === 'number' &&
    Number.isInteger(input.endChar) &&
    input.endChar > input.startChar &&
    input.startChar >= 0
  ) {
    return `${v}/claim/s${input.startChar}-e${input.endChar}/${core}`;
  }
  return `${v}/claim/unresolved/${core}`;
}

/**
 * Count occurrences of the canonical quote inside the canonical visible
 * answer. Used for rule 4: an unresolved claim whose quote appears zero or
 * 2+ times is ambiguous and must confirm only the selected row.
 */
export function countCanonicalQuoteOccurrences(
  visibleAnswer: string,
  exactQuote: string
): number {
  const haystack = canonicalizeFindingText(visibleAnswer);
  const needle = canonicalizeFindingText(exactQuote);
  if (!needle || !haystack) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    count++;
    from = idx + 1;
  }
  return count;
}

/**
 * Rule 4 ambiguity check for an unresolved claim: ambiguous when the quote
 * does not resolve to exactly one occurrence in the visible answer, or when
 * a sibling current-row statement shares the same canonical quote + claim.
 */
export function isUnresolvedClaimAmbiguous(
  visibleAnswer: string,
  exactQuote: string,
  normalizedClaim: string,
  siblingStatements: Array<{ exactQuote: string; normalizedClaim: string }>
): boolean {
  if (countCanonicalQuoteOccurrences(visibleAnswer, exactQuote) !== 1) {
    return true;
  }
  const quote = canonicalizeFindingText(exactQuote);
  const claim = canonicalizeFindingText(normalizedClaim);
  return siblingStatements.some(
    (s) =>
      canonicalizeFindingText(s.exactQuote) === quote &&
      canonicalizeFindingText(s.normalizedClaim) === claim
  );
}

/**
 * Storage key for an ambiguous (non-reusable) confirmation: the base key
 * suffixed with the confirmed statement row id, so the UNIQUE
 * (message_id, context_revision, finding_key) constraint can hold while the
 * row can never auto-match a future rerun's rows (which compute the base
 * key without the suffix).
 */
export function computeAmbiguousReviewKey(
  baseFindingKey: string,
  statementId: number
): string {
  return `${baseFindingKey}/amb/${statementId}`;
}

// --- review tokens ---------------------------------------------------------------

/**
 * Opaque token covering the immutable statement snapshot + material
 * revision. Mutable review status is excluded so a repeated submission with
 * the same live statement/token stays idempotent. Backfilled identity
 * columns (finding_key/context_revision) are excluded so legacy-row
 * backfill does not invalidate outstanding modal tokens.
 */
export function computeReviewToken(input: ReviewTokenInput): string {
  const canonical = JSON.stringify({
    v: VERIFICATION_REVIEW_IDENTITY_VERSION,
    sid: input.statementId,
    mid: input.messageId,
    k: input.kind,
    r: input.materialRevision,
    q: input.exactQuote,
    c: input.normalizedClaim,
    s: input.startChar,
    e: input.endChar,
    vd: input.verdict,
    sv: input.severity,
    cf: input.confidence,
    rs: input.reasoning,
    ev: input.evidenceJson ?? '',
  });
  return `v${VERIFICATION_REVIEW_IDENTITY_VERSION}.${sha256Hex(canonical)}`;
}

// --- eligibility + effective scoring ----------------------------------------------

/**
 * Findings eligible for human confirmation: partially_supported,
 * contradicted, fabricated, and omission. Supported claims need no action.
 */
export function isReviewEligibleFinding(
  kind: 'claim' | 'omission',
  verdict: string
): boolean {
  if (kind === 'omission') return verdict === 'omission';
  return (
    verdict === 'partially_supported' ||
    verdict === 'contradicted' ||
    verdict === 'fabricated'
  );
}

/**
 * Per-message accuracy: supported counts 1.0, partial 0.5,
 * contradicted/fabricated 0, every active omission penalizes the
 * denominator. Zero denominator scores 1.0 (stored 0–1; UI shows 0–100).
 */
export function computeVerificationAccuracyScore(
  supportedClaims: number,
  partialClaims: number,
  totalClaims: number,
  omissionsCount: number
): number {
  const denominator = totalClaims + omissionsCount;
  if (denominator <= 0) return 1.0;
  return (supportedClaims + 0.5 * partialClaims) / denominator;
}

/** Raw (pre-review) Judge counts. */
export interface RawVerificationCounts {
  totalClaims: number;
  supportedClaims: number;
  partialClaims: number;
  contradictedClaims: number;
  fabricatedClaims: number;
  omissionsCount: number;
}

/**
 * Derive raw counts from a statement list (no review awareness). Used when
 * the caller did not supply authoritative counts.
 */
export function deriveRawVerificationCounts(
  statements: Array<{ kind: 'claim' | 'omission'; verdict: string }>
): RawVerificationCounts {
  let supported = 0;
  let partial = 0;
  let contradicted = 0;
  let fabricated = 0;
  let omissions = 0;
  let totalClaims = 0;
  for (const s of statements) {
    if (s.kind === 'omission') {
      omissions++;
      continue;
    }
    totalClaims++;
    if (s.verdict === 'supported') supported++;
    else if (s.verdict === 'partially_supported') partial++;
    else if (s.verdict === 'contradicted') contradicted++;
    else fabricated++;
  }
  return {
    totalClaims,
    supportedClaims: supported,
    partialClaims: partial,
    contradictedClaims: contradicted,
    fabricatedClaims: fabricated,
    omissionsCount: omissions,
  };
}

/**
 * The single review-adjustment core shared by dismissal and worker saves.
 * Raw Judge counts stay untouched; only the effective aggregates change:
 * - confirmed partial/contradicted/fabricated claim → one supported claim
 *   (its old problematic bucket decrements, total claim count unchanged);
 * - confirmed omission → removed from active omissions (no new claim);
 * - unreviewed findings keep existing verdict/weighting.
 * Decrements clamp at zero so inconsistent raw inputs can never produce
 * negative buckets. Accuracy is always recomputed from effective counts.
 */
export function applyConfirmedReviewsToCounts(
  raw: RawVerificationCounts,
  confirmed: Array<{ kind: 'claim' | 'omission'; verdict: string }>
): EffectiveVerificationCounts {
  let supported = raw.supportedClaims;
  let partial = raw.partialClaims;
  let contradicted = raw.contradictedClaims;
  let fabricated = raw.fabricatedClaims;
  let omissions = raw.omissionsCount;
  for (const c of confirmed) {
    if (c.kind === 'omission') {
      omissions = Math.max(0, omissions - 1);
      continue;
    }
    if (c.verdict === 'partially_supported' && partial > 0) {
      partial--;
      supported++;
    } else if (c.verdict === 'contradicted' && contradicted > 0) {
      contradicted--;
      supported++;
    } else if (c.verdict === 'fabricated' && fabricated > 0) {
      fabricated--;
      supported++;
    } else if (
      c.verdict === 'partially_supported' ||
      c.verdict === 'contradicted' ||
      c.verdict === 'fabricated'
    ) {
      // Raw buckets inconsistent with the statement list (legacy callers):
      // still credit the confirmation as supported.
      supported++;
    }
    // Confirmed `supported` claims (should not happen — ineligible) change nothing.
  }
  return {
    totalClaims: raw.totalClaims,
    supportedClaims: supported,
    partialClaims: partial,
    contradictedClaims: contradicted,
    fabricatedClaims: fabricated,
    omissionsCount: omissions,
    accuracyScore: computeVerificationAccuracyScore(
      supported,
      partial,
      raw.totalClaims,
      omissions
    ),
  };
}

/**
 * One review-aware reduction of current statements, shared by dismissal and
 * worker saves: derive raw counts from the statements, then apply the shared
 * adjustment core for confirmed findings. Raw Judge fields are preserved on
 * the rows; only the effective aggregates change.
 */
export function reduceEffectiveVerificationCounts(
  statements: EffectiveStatementInput[]
): EffectiveVerificationCounts {
  return applyConfirmedReviewsToCounts(
    deriveRawVerificationCounts(statements),
    statements
      .filter((s) => s.reviewStatus === 'confirmed')
      .map((s) => ({ kind: s.kind, verdict: s.verdict }))
  );
}
