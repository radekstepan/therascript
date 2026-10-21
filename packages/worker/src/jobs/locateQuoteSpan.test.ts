// packages/worker/src/jobs/locateQuoteSpan.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('@therascript/config', () => ({
  default: {
    llm: {
      baseURL: 'http://localhost:1234',
      modelPath: 'default',
      contextSize: 8192,
    },
  },
}));

vi.mock('@therascript/data', () => ({
  verificationRepository: {},
  transcriptRepository: {},
  usageRepository: {},
  templateRepository: {},
}));

vi.mock('@therascript/services', () => ({
  streamLlmChatDetailed: vi.fn(),
  calculateTokenCount: vi.fn(),
  parseJsonObjectFromLlm: vi.fn(),
  streamWithRetry: vi.fn(),
  extractVisibleAnswer: vi.fn((text: string) => text),
}));

vi.mock('./analysisProcessor.js', () => ({
  loadLlmModelForWorker: vi.fn(),
  loadLlmApiTokenForWorker: vi.fn().mockReturnValue(null),
  unloadModelAtUrlForWorker: vi.fn(),
  resolveEffectiveThinkingBudget: vi.fn(),
}));

vi.mock('../services/streamPublisher.js', () => ({
  publishVerificationEvent: vi.fn(),
}));

const {
  locateQuoteSpan,
  computeVerificationAccuracy,
  normalizeJudgeOutput,
  selectJudgeTranscriptContext,
  formatTranscriptForJudge,
} = await import('./verificationProcessor.js');

describe('locateQuoteSpan — exact match pass', () => {
  it('returns offsets for a verbatim substring', () => {
    const text = 'The client reported anxiety about work deadlines.';
    const quote = 'reported anxiety about work';
    const span = locateQuoteSpan(text, quote);
    expect(span).toEqual({
      startChar: text.indexOf(quote),
      endChar: text.indexOf(quote) + quote.length,
    });
  });

  it('resolves duplicate phrases to distinct occurrences via usedRanges', () => {
    const text =
      'Note: the client felt anxious. Later, the client felt anxious again.';
    const quote = 'the client felt anxious';
    const used: Array<[number, number]> = [];
    const first = locateQuoteSpan(text, quote, used);
    expect(first.startChar).toBe(text.indexOf('the client felt anxious'));
    used.push([first.startChar!, first.endChar!]);
    const second = locateQuoteSpan(text, quote, used);
    expect(second.startChar).toBe(
      text.indexOf('the client felt anxious', first.endChar!)
    );
    expect(second.startChar).not.toBe(first.startChar);
  });

  it('returns null spans when every occurrence is already used', () => {
    const text = 'Only one mention of panic here.';
    const quote = 'panic';
    const idx = text.indexOf(quote);
    const span = locateQuoteSpan(text, quote, [[idx, idx + quote.length]]);
    expect(span).toEqual({ startChar: null, endChar: null });
  });
});

describe('locateQuoteSpan — normalized pass', () => {
  it('matches across markdown bold markers', () => {
    const text = 'The client takes **Sertraline** every morning.';
    const quote = 'takes Sertraline every morning';
    const span = locateQuoteSpan(text, quote);
    expect(span.startChar).not.toBeNull();
    expect(text.slice(span.startChar!, span.endChar!)).toBe(
      'takes **Sertraline** every morning'
    );
  });

  it('matches across whitespace and newline differences', () => {
    const text = 'Sleep   improved\nsignificantly  this week.';
    const quote = 'Sleep improved significantly this week.';
    const span = locateQuoteSpan(text, quote);
    expect(span).toEqual({ startChar: 0, endChar: text.length });
  });

  it('matches case-insensitively', () => {
    const text = 'The THERAPIST suggested breathing exercises.';
    const quote = 'therapist suggested Breathing Exercises';
    const span = locateQuoteSpan(text, quote);
    expect(text.slice(span.startChar!, span.endChar!)).toBe(
      'THERAPIST suggested breathing exercises'
    );
  });

  it('matches across inline code and underscore formatting', () => {
    const text = 'Diagnosis: `GAD` with _mild_ depressive symptoms.';
    const quote = 'Diagnosis: GAD with mild depressive symptoms.';
    const span = locateQuoteSpan(text, quote);
    expect(span).toEqual({ startChar: 0, endChar: text.length });
  });
});

describe('locateQuoteSpan — anchor pass', () => {
  const text =
    'In summary, the client described a difficult childhood marked by frequent moves between foster homes, ' +
    'periods of neglect, and a close bond with a grandmother who provided the only stability during those years.';

  it('locates a long quote with a slightly altered middle', () => {
    const head = text.slice(0, 60);
    const tail = text.slice(-60);
    // Simulate the Judge lightly paraphrasing the middle of a long quote.
    const quote = `${head} ... various hardships ... ${tail}`;
    const span = locateQuoteSpan(text, quote);
    expect(span.startChar).toBe(0);
    expect(span.endChar).toBe(text.length);
  });

  it('rejects anchors whose tail falls outside the bounded window', () => {
    const head = 'the client described a difficult childhood marked';
    const tail = 'who provided the only stability during those years';
    const scattered = `${head} — ${'unrelated filler discussion about scheduling. '.repeat(20)} — ${tail}.`;
    const quote = `${head} and other events ${tail}`;
    expect(quote.length).toBeGreaterThan(40); // anchor-pass eligible
    // Head matches at 0 and tail matches ~1100 chars later, but the short
    // quote only allows a ~260-char window: no span.
    expect(locateQuoteSpan(scattered, quote)).toEqual({
      startChar: null,
      endChar: null,
    });
  });
});

describe('locateQuoteSpan — no match', () => {
  it('returns null spans for quotes absent from the text', () => {
    expect(
      locateQuoteSpan('The client slept well.', 'The client owns a boat.')
    ).toEqual({ startChar: null, endChar: null });
  });

  it('returns null spans for empty inputs', () => {
    expect(locateQuoteSpan('', 'something')).toEqual({
      startChar: null,
      endChar: null,
    });
    expect(locateQuoteSpan('something', '')).toEqual({
      startChar: null,
      endChar: null,
    });
  });

  it('does not match a quote longer than the text', () => {
    expect(locateQuoteSpan('short', 'a much longer quote than short')).toEqual({
      startChar: null,
      endChar: null,
    });
  });
});

describe('computeVerificationAccuracy', () => {
  it('weights supported 1.0 and partial 0.5 over claims + omissions', () => {
    // (2 + 0.5 * 2) / (4 + 1) = 3/5
    expect(computeVerificationAccuracy(2, 2, 4, 1)).toBeCloseTo(0.6, 10);
  });

  it('returns 1.0 for perfect and for empty (conversational) audits', () => {
    expect(computeVerificationAccuracy(5, 0, 5, 0)).toBe(1);
    expect(computeVerificationAccuracy(0, 0, 0, 0)).toBe(1);
  });

  it('returns 0 when every claim is contradicted/fabricated', () => {
    expect(computeVerificationAccuracy(0, 0, 3, 0)).toBe(0);
  });
});

describe('normalizeJudgeOutput', () => {
  it('coerces unknown verdicts to partially_supported and drops empty claims', () => {
    const result = normalizeJudgeOutput({
      summary_assessment: 'Mixed.',
      claims: [
        {
          exact_quote: 'The client takes Sertraline.',
          normalized_claim: 'Client takes Sertraline.',
          verdict: 'totally_made_up_verdict',
          severity: 'bogus',
          confidence: 0.7,
          reasoning: 'Why.',
          evidence: [
            {
              paragraphIndex: 3,
              timestampMs: 12000,
              speaker: 'SPEAKER_00',
              quote: 'I take Sertraline.',
            },
          ],
        },
        { exact_quote: '   ', normalized_claim: '' },
      ],
      omissions: [
        {
          normalized_claim: 'Missed panic attack mention.',
          severity: 'high',
          confidence: 1.5,
          reasoning: 'Matters.',
          evidence: 'not-an-array',
        },
      ],
    });
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0].verdict).toBe('partially_supported');
    expect(result.claims[0].severity).toBe('medium');
    expect(result.claims[0].evidence).toHaveLength(1);
    expect(result.omissions).toHaveLength(1);
    expect(result.omissions[0].severity).toBe('high');
    expect(result.omissions[0].confidence).toBe(1);
    expect(result.omissions[0].evidence).toEqual([]);
  });

  it('returns empty arrays for null / malformed output', () => {
    expect(normalizeJudgeOutput(null)).toEqual({
      summaryAssessment: null,
      claims: [],
      omissions: [],
    });
    expect(normalizeJudgeOutput({ claims: 'nope', omissions: 42 })).toEqual({
      summaryAssessment: null,
      claims: [],
      omissions: [],
    });
  });
});

describe('selectJudgeTranscriptContext', () => {
  const paragraphs = [
    {
      id: 0,
      timestamp: 0,
      text: 'Hello, how are you today?',
      speaker: 'SPEAKER_00',
    },
    {
      id: 1,
      timestamp: 60000,
      text: 'I had a panic attack at work yesterday.',
      speaker: 'SPEAKER_01',
    },
    {
      id: 2,
      timestamp: 120000,
      text: 'My breathing exercises helped a little.',
      speaker: 'SPEAKER_01',
    },
  ];

  it('passes short transcripts through untruncated', () => {
    const ctx = selectJudgeTranscriptContext(
      paragraphs,
      'anything',
      100000,
      (t) => t.length
    );
    expect(ctx.truncated).toBe(false);
    expect(ctx.includedParagraphs).toBe(3);
    expect(ctx.text).toBe(formatTranscriptForJudge(paragraphs));
  });

  it('selects keyword-relevant paragraphs plus neighbors in order', () => {
    const full = formatTranscriptForJudge(paragraphs);
    // Budget fits paragraph 1 + its neighbors (0 and 2) but not the whole
    // text plus marker: force the selection path with a mid-size budget.
    const ctx = selectJudgeTranscriptContext(
      paragraphs,
      'panic attack at work',
      full.length - 10,
      (t) => t.length
    );
    expect(ctx.truncated).toBe(true);
    expect(ctx.text).toContain('panic attack');
    // Chronological order preserved.
    expect(ctx.text.indexOf('[P#0')).toBeLessThan(ctx.text.indexOf('[P#1'));
  });

  it('always keeps at least the most relevant paragraph on tiny budgets', () => {
    const ctx = selectJudgeTranscriptContext(
      paragraphs,
      'breathing exercises',
      1,
      (t) => t.length
    );
    expect(ctx.includedParagraphs).toBe(1);
    expect(ctx.text).toContain('breathing exercises');
  });
});
