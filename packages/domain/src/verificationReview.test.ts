import { describe, it, expect } from 'vitest';
import {
  VERIFICATION_REVIEW_IDENTITY_VERSION,
  canonicalizeFindingText,
  computeAmbiguousReviewKey,
  computeFindingKey,
  computeMaterialRevision,
  computeReviewToken,
  computeVerificationAccuracyScore,
  countCanonicalQuoteOccurrences,
  isReviewEligibleFinding,
  isUnresolvedClaimAmbiguous,
  reduceEffectiveVerificationCounts,
  type EffectiveStatementInput,
  type MaterialRevisionInput,
} from './verificationReview.js';

const baseMaterial = (): MaterialRevisionInput => ({
  visibleAnswer: 'The client takes Sertraline every morning.',
  userQuestion: 'Summarize the medication discussion.',
  transcript: [
    {
      paragraphIndex: 0,
      timestampMs: 0,
      speaker: 'SPEAKER_01',
      text: 'I take Sertraline every morning.',
    },
    {
      paragraphIndex: 1,
      timestampMs: 5000,
      speaker: 'SPEAKER_02',
      text: 'How long have you taken it?',
    },
  ],
});

describe('verificationReview identity', () => {
  it('exposes identity version 1', () => {
    expect(VERIFICATION_REVIEW_IDENTITY_VERSION).toBe(1);
  });

  it('computes a stable material revision regardless of paragraph order', () => {
    const a = computeMaterialRevision(baseMaterial());
    const shuffled = baseMaterial();
    shuffled.transcript = [...shuffled.transcript].reverse();
    expect(computeMaterialRevision(shuffled)).toBe(a);
    expect(a.startsWith('v1.')).toBe(true);
  });

  it('invalidates the revision when answer, question, or transcript changes', () => {
    const base = computeMaterialRevision(baseMaterial());
    const changedAnswer = baseMaterial();
    changedAnswer.visibleAnswer += ' Extra sentence.';
    expect(computeMaterialRevision(changedAnswer)).not.toBe(base);
    const changedQuestion = baseMaterial();
    changedQuestion.userQuestion = 'Something else?';
    expect(computeMaterialRevision(changedQuestion)).not.toBe(base);
    const changedTranscript = baseMaterial();
    changedTranscript.transcript[0] = {
      ...changedTranscript.transcript[0]!,
      text: 'I take Fluoxetine every morning.',
    };
    expect(computeMaterialRevision(changedTranscript)).not.toBe(base);
    const renamedSpeaker = baseMaterial();
    renamedSpeaker.transcript[0] = {
      ...renamedSpeaker.transcript[0]!,
      speaker: 'Therapist',
    };
    expect(computeMaterialRevision(renamedSpeaker)).not.toBe(base);
  });

  it('ignores UNKNOWN/blank speaker labels (not meaningful speaker info)', () => {
    const a = baseMaterial();
    a.transcript[0] = { ...a.transcript[0]!, speaker: 'UNKNOWN' };
    const b = baseMaterial();
    b.transcript[0] = { ...b.transcript[0]!, speaker: null };
    expect(computeMaterialRevision(a)).toBe(computeMaterialRevision(b));
  });

  it('canonicalizes typography/whitespace variants identically', () => {
    expect(canonicalizeFindingText('  “Sertraline” — daily  dose ')).toBe(
      canonicalizeFindingText(`'sertraline' - daily dose`)
    );
    expect(canonicalizeFindingText('...“Quoted claim”...')).toBe(
      'quoted claim'
    );
    // Markdown emphasis collapses (formatting, not content).
    expect(canonicalizeFindingText('**Sertraline** *daily*')).toBe(
      'sertraline daily'
    );
  });

  it('preserves numbers, negation, names, and meaningful punctuation', () => {
    expect(canonicalizeFindingText('Takes 50mg, not 100mg!')).toBe(
      'takes 50mg, not 100mg!'
    );
    expect(canonicalizeFindingText('Dr. Smith disagrees?')).toBe(
      'dr. smith disagrees?'
    );
    expect(canonicalizeFindingText('Takes Sertraline')).not.toBe(
      canonicalizeFindingText('Does not take Sertraline')
    );
  });

  it('matches resolved claims on claim + quote occurrence + offsets', () => {
    const a = computeFindingKey({
      kind: 'claim',
      exactQuote: '“Sertraline daily”',
      normalizedClaim: 'Client takes Sertraline daily.',
      startChar: 10,
      endChar: 27,
    });
    // Typography variant of the same occurrence still matches.
    const b = computeFindingKey({
      kind: 'claim',
      exactQuote: `...  'SERTRALINE   daily'  ...`,
      normalizedClaim: '  CLIENT takes Sertraline daily. ',
      startChar: 10,
      endChar: 27,
    });
    expect(b).toBe(a);
    // Same span with a distinct atomic claim stays separate (rule 3).
    const distinct = computeFindingKey({
      kind: 'claim',
      exactQuote: '“Sertraline daily”',
      normalizedClaim: 'Client takes Sertraline twice daily.',
      startChar: 10,
      endChar: 27,
    });
    expect(distinct).not.toBe(a);
    // Repeated text at another offset is a different finding (rule 2).
    const otherOffset = computeFindingKey({
      kind: 'claim',
      exactQuote: '“Sertraline daily”',
      normalizedClaim: 'Client takes Sertraline daily.',
      startChar: 100,
      endChar: 117,
    });
    expect(otherOffset).not.toBe(a);
  });

  it('requires quote + claim for unresolved spans and detects ambiguity', () => {
    const answer = 'Sertraline helps. Sertraline helps a lot.';
    // Duplicate quote occurrences in the answer → ambiguous.
    expect(
      isUnresolvedClaimAmbiguous(
        answer,
        'Sertraline helps',
        'Sertraline helps.',
        []
      )
    ).toBe(true);
    // Unique quote occurrence, no sibling duplicates → unambiguous.
    expect(
      isUnresolvedClaimAmbiguous(
        answer,
        'Sertraline helps a lot',
        'Sertraline helps a lot.',
        []
      )
    ).toBe(false);
    // Sibling rows sharing canonical quote + claim → ambiguous.
    expect(
      isUnresolvedClaimAmbiguous(
        'Sertraline helps a lot.',
        'Sertraline helps a lot.',
        'Same claim.',
        [
          {
            exactQuote: '“Sertraline helps a lot.”',
            normalizedClaim: 'same claim.',
          },
        ]
      )
    ).toBe(true);
    expect(countCanonicalQuoteOccurrences(answer, 'Sertraline helps')).toBe(2);
  });

  it('produces non-reusable ambiguous keys that never collide with base keys', () => {
    const base = computeFindingKey({
      kind: 'claim',
      exactQuote: 'q',
      normalizedClaim: 'c',
      startChar: null,
      endChar: null,
    });
    const amb1 = computeAmbiguousReviewKey(base, 7);
    const amb2 = computeAmbiguousReviewKey(base, 8);
    expect(amb1).not.toBe(base);
    expect(amb1).not.toBe(amb2);
  });

  it('matches omissions on text + sorted evidence, ignoring paragraph ids', () => {
    const ev = (
      quote: string,
      speaker: string | null,
      timestampMs: number | null
    ) => ({
      quote,
      speaker,
      timestampMs,
    });
    const a = computeFindingKey({
      kind: 'omission',
      normalizedClaim: 'Missed the trauma disclosure.',
      evidence: [
        ev('I was assaulted in 2019.', 'SPEAKER_01', 12000),
        ev('It still haunts me.', 'SPEAKER_01', 15000),
      ],
    });
    const reordered = computeFindingKey({
      kind: 'omission',
      normalizedClaim: '  MISSED the trauma DISCLOSURE. ',
      evidence: [
        ev('it still haunts me.', 'speaker_01', 15000),
        ev('“I was assaulted in 2019.”', 'SPEAKER_01', 12000),
      ],
    });
    expect(reordered).toBe(a);
    const differentEvidence = computeFindingKey({
      kind: 'omission',
      normalizedClaim: 'Missed the trauma disclosure.',
      evidence: [ev('Something else entirely.', 'SPEAKER_02', 99000)],
    });
    expect(differentEvidence).not.toBe(a);
  });

  it('does not match paraphrases, splits, or merges', () => {
    const key = (claim: string) =>
      computeFindingKey({
        kind: 'claim',
        exactQuote: 'The client takes Sertraline every morning without fail.',
        normalizedClaim: claim,
        startChar: 0,
        endChar: 10,
      });
    expect(key('The client takes Sertraline each morning reliably.')).not.toBe(
      key('The client takes Sertraline every morning without fail.')
    );
    expect(key('The client takes Sertraline.')).not.toBe(
      key('The client takes Sertraline every morning without fail.')
    );
  });

  it('treats omission and claim keys as disjoint', () => {
    const claim = computeFindingKey({
      kind: 'claim',
      exactQuote: 'x',
      normalizedClaim: 'Same text.',
      startChar: null,
      endChar: null,
    });
    const omission = computeFindingKey({
      kind: 'omission',
      normalizedClaim: 'Same text.',
      evidence: [],
    });
    expect(claim).not.toBe(omission);
  });
});

describe('verificationReview eligibility', () => {
  it.each([
    ['claim', 'partially_supported', true],
    ['claim', 'contradicted', true],
    ['claim', 'fabricated', true],
    ['claim', 'supported', false],
    ['omission', 'omission', true],
    ['omission', 'supported', false],
  ])('kind=%s verdict=%s → %s', (kind, verdict, expected) => {
    expect(isReviewEligibleFinding(kind as 'claim' | 'omission', verdict)).toBe(
      expected
    );
  });
});

describe('verificationReview tokens', () => {
  const tokenInput = () => ({
    statementId: 3,
    messageId: 9,
    kind: 'claim' as const,
    materialRevision: 'v1.abc',
    exactQuote: 'Quote here.',
    normalizedClaim: 'Claim here.',
    startChar: 1,
    endChar: 12,
    verdict: 'fabricated',
    severity: 'high',
    confidence: 0.9,
    reasoning: 'Not in transcript.',
    evidenceJson: null,
  });

  it('is deterministic and opaque', () => {
    const a = computeReviewToken(tokenInput());
    expect(computeReviewToken(tokenInput())).toBe(a);
    expect(a.startsWith('v1.')).toBe(true);
    expect(a).not.toContain('Quote here');
  });

  it('changes when the snapshot or revision changes', () => {
    const base = computeReviewToken(tokenInput());
    expect(
      computeReviewToken({ ...tokenInput(), materialRevision: 'v1.other' })
    ).not.toBe(base);
    expect(
      computeReviewToken({ ...tokenInput(), verdict: 'supported' })
    ).not.toBe(base);
    expect(computeReviewToken({ ...tokenInput(), statementId: 4 })).not.toBe(
      base
    );
    expect(
      computeReviewToken({ ...tokenInput(), reasoning: 'Different.' })
    ).not.toBe(base);
  });
});

describe('reduceEffectiveVerificationCounts', () => {
  const stmt = (
    kind: 'claim' | 'omission',
    verdict: EffectiveStatementInput['verdict'],
    reviewStatus: 'unreviewed' | 'confirmed' = 'unreviewed'
  ): EffectiveStatementInput => ({ kind, verdict, reviewStatus });

  it('implements the required fixture progression', () => {
    const base: EffectiveStatementInput[] = [
      stmt('claim', 'supported'),
      stmt('claim', 'partially_supported'),
      stmt('claim', 'fabricated'),
      stmt('omission', 'omission'),
    ];
    const initial = reduceEffectiveVerificationCounts(base);
    expect(initial.totalClaims).toBe(3);
    expect(initial.omissionsCount).toBe(1);
    expect(initial.accuracyScore).toBeCloseTo(1.5 / 4, 10);

    const confirmFabricated = reduceEffectiveVerificationCounts([
      base[0]!,
      base[1]!,
      stmt('claim', 'fabricated', 'confirmed'),
      base[3]!,
    ]);
    expect(confirmFabricated.supportedClaims).toBe(2);
    expect(confirmFabricated.partialClaims).toBe(1);
    expect(confirmFabricated.fabricatedClaims).toBe(0);
    expect(confirmFabricated.totalClaims).toBe(3);
    expect(confirmFabricated.accuracyScore).toBeCloseTo(2.5 / 4, 10);

    const confirmOmission = reduceEffectiveVerificationCounts([
      base[0]!,
      base[1]!,
      stmt('claim', 'fabricated', 'confirmed'),
      stmt('omission', 'omission', 'confirmed'),
    ]);
    expect(confirmOmission.omissionsCount).toBe(0);
    expect(confirmOmission.supportedClaims).toBe(2);
    expect(confirmOmission.accuracyScore).toBeCloseTo(2.5 / 3, 10);

    const confirmPartial = reduceEffectiveVerificationCounts([
      base[0]!,
      stmt('claim', 'partially_supported', 'confirmed'),
      stmt('claim', 'fabricated', 'confirmed'),
      stmt('omission', 'omission', 'confirmed'),
    ]);
    expect(confirmPartial.supportedClaims).toBe(3);
    expect(confirmPartial.partialClaims).toBe(0);
    expect(confirmPartial.accuracyScore).toBe(1);
  });

  it('scores zero-denominator as 1.0 and keeps 0–1 units unrounded', () => {
    expect(reduceEffectiveVerificationCounts([]).accuracyScore).toBe(1);
    const onlyOmission = reduceEffectiveVerificationCounts([
      stmt('omission', 'omission', 'confirmed'),
    ]);
    expect(onlyOmission.accuracyScore).toBe(1);
    const score = reduceEffectiveVerificationCounts([
      stmt('claim', 'supported'),
      stmt('claim', 'supported'),
      stmt('claim', 'partially_supported'),
    ]).accuracyScore;
    expect(score).toBeCloseTo(2.5 / 3, 10);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('satisfies T = S + P + C + F', () => {
    const counts = reduceEffectiveVerificationCounts([
      stmt('claim', 'supported'),
      stmt('claim', 'partially_supported', 'confirmed'),
      stmt('claim', 'contradicted'),
      stmt('claim', 'fabricated', 'confirmed'),
      stmt('omission', 'omission'),
    ]);
    expect(
      counts.supportedClaims +
        counts.partialClaims +
        counts.contradictedClaims +
        counts.fabricatedClaims
    ).toBe(counts.totalClaims);
    expect(counts.supportedClaims).toBe(3);
    expect(counts.omissionsCount).toBe(1);
  });

  it('keeps supported claims supported regardless of review state', () => {
    const counts = reduceEffectiveVerificationCounts([
      stmt('claim', 'supported', 'confirmed'),
    ]);
    expect(counts.supportedClaims).toBe(1);
    expect(counts.accuracyScore).toBe(1);
  });
});

describe('computeVerificationAccuracyScore', () => {
  it('weights partial at 0.5 and penalizes omissions in the denominator', () => {
    expect(computeVerificationAccuracyScore(1, 1, 3, 1)).toBeCloseTo(
      1.5 / 4,
      10
    );
    expect(computeVerificationAccuracyScore(0, 0, 0, 0)).toBe(1);
  });
});
