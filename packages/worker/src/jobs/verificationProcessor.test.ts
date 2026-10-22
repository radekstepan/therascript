// packages/worker/src/jobs/verificationProcessor.test.ts
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type { TranscriptParagraphData } from '@therascript/domain';

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
  verificationRepository: {
    findVerificationJobById: vi.fn(),
    findCandidateMessagesForVerification: vi.fn(),
    updateJobStatus: vi.fn(),
    saveMessageVerificationResult: vi.fn(),
  },
  transcriptRepository: {
    findParagraphsBySessionId: vi.fn(),
  },
  usageRepository: {
    insertUsageLog: vi.fn(),
  },
  templateRepository: {
    findByTitle: vi.fn(),
  },
  sessionRepository: {
    findById: vi.fn(),
  },
}));

vi.mock('@therascript/services', () => ({
  streamLlmChatDetailed: vi.fn(),
  calculateTokenCount: vi.fn(),
  extractJsonObject: vi.fn(),
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
  cleanExactQuote,
  normalizeTextWithMap,
  formatTranscriptParagraph,
  formatTranscriptForJudge,
  normalizeJudgeOutput,
  hydrateEvidenceItem,
  findParagraphByQuote,
  DEFAULT_VERIFICATION_JUDGE_PROMPT,
  sanitizeJsonForParse,
  parseJudgeJson,
  validateJudgeOutputStructure,
  isTrivialConversationalMessage,
  resolveJudgeThinkingBudget,
  JUDGE_MAX_THINKING_BUDGET,
  processVerificationJob,
} = await import('./verificationProcessor.js');

const services = await import('@therascript/services');
const data = await import('@therascript/data');
const analysisStub = await import('./analysisProcessor.js');

const streamLlmMock = services.streamLlmChatDetailed as unknown as Mock;
const calculateTokenCountMock = services.calculateTokenCount as unknown as Mock;
const extractJsonObjectMock = services.extractJsonObject as unknown as Mock;
const parseJsonMock = services.parseJsonObjectFromLlm as unknown as Mock;
const streamWithRetryMock = services.streamWithRetry as unknown as Mock;
const extractVisibleAnswerMock =
  services.extractVisibleAnswer as unknown as Mock;
const findJobMock = data.verificationRepository
  .findVerificationJobById as unknown as Mock;
const findCandidatesMock = data.verificationRepository
  .findCandidateMessagesForVerification as unknown as Mock;
const updateJobStatusMock = data.verificationRepository
  .updateJobStatus as unknown as Mock;
const saveResultMock = data.verificationRepository
  .saveMessageVerificationResult as unknown as Mock;
const findParagraphsMock = data.transcriptRepository
  .findParagraphsBySessionId as unknown as Mock;
const insertUsageMock = data.usageRepository.insertUsageLog as unknown as Mock;
const findTemplateMock = data.templateRepository.findByTitle as unknown as Mock;
const findSessionMock = data.sessionRepository.findById as unknown as Mock;
const resolveBudgetStub =
  analysisStub.resolveEffectiveThinkingBudget as unknown as Mock;

describe('cleanExactQuote', () => {
  it('strips matching outer double quotes', () => {
    expect(cleanExactQuote('"The client improved."')).toBe(
      'The client improved.'
    );
  });

  it('strips matching outer single and curly quotes', () => {
    expect(cleanExactQuote("'takes Sertraline daily'")).toBe(
      'takes Sertraline daily'
    );
    expect(cleanExactQuote('\u201Ctakes Sertraline\u201D')).toBe(
      'takes Sertraline'
    );
    expect(cleanExactQuote('\u2018takes Sertraline\u2019')).toBe(
      'takes Sertraline'
    );
  });

  it('strips leading/trailing ellipses in either order', () => {
    expect(cleanExactQuote('...The client improved...')).toBe(
      'The client improved'
    );
    expect(cleanExactQuote('\u2026The client improved\u2026')).toBe(
      'The client improved'
    );
    expect(cleanExactQuote('"...The client improved..."')).toBe(
      'The client improved'
    );
    expect(cleanExactQuote('..."The client improved"...')).toBe(
      'The client improved'
    );
  });

  it('leaves unmatched edge quotes and inner quotes alone', () => {
    expect(cleanExactQuote(`'Inspect' the thought`)).toBe(
      `'Inspect' the thought`
    );
    expect(cleanExactQuote(`say "hello" loudly`)).toBe(`say "hello" loudly`);
  });
});

describe('normalizeTextWithMap — quotes and dashes', () => {
  it('normalizes quote variants to a single quote with a 1-to-1 map', () => {
    const text = `\u201CInspect\u201D and \u2018review\u2019 vs "plain" and 'single'`;
    const { normalized, map } = normalizeTextWithMap(text);
    expect(normalized).toBe(`'inspect' and 'review' vs 'plain' and 'single'`);
    expect(map).toHaveLength(normalized.length);
    // Quote/dash normalization is 1-to-1: every non-space normalized char
    // traces back to its own source index (collapsed spaces point at the
    // following non-space char, per long-standing normalize behavior).
    for (let i = 0; i < normalized.length; i++) {
      expect(map[i]).toBe(normalized[i] === ' ' ? i + 1 : i);
    }
  });

  it('normalizes typographic dashes to hyphen', () => {
    const { normalized } = normalizeTextWithMap('well\u2013being \u2014 end');
    expect(normalized).toBe('well-being - end');
  });
});

describe('locateQuoteSpan — outer quotes', () => {
  const text = 'The client takes Sertraline every morning.';

  it('resolves quotes wrapped in outer double quotes', () => {
    expect(locateQuoteSpan(text, `"${text}"`)).toEqual({
      startChar: 0,
      endChar: text.length,
    });
  });

  it('resolves quotes wrapped in outer single or curly quotes', () => {
    const span = locateQuoteSpan(text, `'takes Sertraline every morning'`);
    expect(text.slice(span.startChar!, span.endChar!)).toBe(
      'takes Sertraline every morning'
    );
    const curly = locateQuoteSpan(text, '\u201CTakes Sertraline\u201D');
    expect(text.slice(curly.startChar!, curly.endChar!)).toBe(
      'takes Sertraline'
    );
  });
});

describe('locateQuoteSpan — inner quote substitution', () => {
  it(`resolves quotes where the LLM swapped " for '`, () => {
    const text =
      'The therapist asked the client to "Inspect" the thought record.';
    const quote = `asked the client to 'Inspect' the thought record`;
    const span = locateQuoteSpan(text, quote);
    expect(text.slice(span.startChar!, span.endChar!)).toBe(
      'asked the client to "Inspect" the thought record'
    );
  });

  it('resolves curly quotes against straight quotes', () => {
    const text = `The client said 'no' and left.`;
    const span = locateQuoteSpan(text, 'said \u201Cno\u201D and left');
    expect(text.slice(span.startChar!, span.endChar!)).toBe(
      `said 'no' and left`
    );
  });
});

describe('locateQuoteSpan — leading/trailing ellipses and markdown', () => {
  const text =
    'The client takes **Sertraline** every morning and `journals` nightly.';

  it('resolves quotes with leading/trailing ... around markdown', () => {
    const span = locateQuoteSpan(
      text,
      '...takes **Sertraline** every morning...'
    );
    expect(text.slice(span.startChar!, span.endChar!)).toBe(
      'takes **Sertraline** every morning'
    );
  });

  it('resolves quotes with \u2026 and inline code', () => {
    const span = locateQuoteSpan(text, '\u2026and `journals` nightly\u2026');
    expect(text.slice(span.startChar!, span.endChar!)).toBe(
      'and `journals` nightly'
    );
  });
});

describe('locateQuoteSpan — mid-quote ellipsis spanning', () => {
  it('spans two clauses within a single sentence window', () => {
    const text =
      'The client felt anxious (and somewhat restless) about work deadlines.';
    const span = locateQuoteSpan(
      text,
      'The client felt anxious ... about work deadlines.'
    );
    expect(span).toEqual({ startChar: 0, endChar: text.length });
  });

  it('does not block the statement inside a skipped parenthetical', () => {
    const text =
      'Summary: progress noted (the client described repeated nightmares ' +
      'about the accident, occurring three times weekly with sweating) ' +
      'and coping improved.';
    const outer = 'Summary: progress noted ... and coping improved.';
    const inner = 'repeated nightmares about the accident';
    const used: Array<[number, number]> = [];

    // The spliced clauses sit >80 chars apart: longest clause wins, the
    // parenthetical middle stays free.
    const outerSpan = locateQuoteSpan(text, outer, used);
    expect(outerSpan.startChar).toBe(0);
    expect(outerSpan.endChar).toBe('Summary: progress noted'.length);
    used.push([outerSpan.startChar!, outerSpan.endChar!]);

    const innerSpan = locateQuoteSpan(text, inner, used);
    expect(text.slice(innerSpan.startChar!, innerSpan.endChar!)).toBe(inner);
  });
});

describe('formatTranscriptParagraph / formatTranscriptForJudge', () => {
  const labeled: TranscriptParagraphData = {
    id: 3,
    timestamp: 65000,
    text: 'I take Sertraline.',
    speaker: 'SPEAKER_00',
  };

  it('includes the speaker label when showSpeakers is true', () => {
    expect(formatTranscriptParagraph(labeled)).toBe(
      '[P#3 01:05] SPEAKER_00: I take Sertraline.'
    );
  });

  it('omits the speaker label when showSpeakers is false', () => {
    expect(formatTranscriptParagraph(labeled, false)).toBe(
      '[P#3 01:05] I take Sertraline.'
    );
  });

  it('omits UNKNOWN / empty speaker labels even when showSpeakers is true', () => {
    expect(formatTranscriptParagraph({ ...labeled, speaker: 'UNKNOWN' })).toBe(
      '[P#3 01:05] I take Sertraline.'
    );
    expect(formatTranscriptParagraph({ ...labeled, speaker: '  ' })).toBe(
      '[P#3 01:05] I take Sertraline.'
    );
    expect(formatTranscriptParagraph({ ...labeled, speaker: undefined })).toBe(
      '[P#3 01:05] I take Sertraline.'
    );
  });

  it('formatTranscriptForJudge threads showSpeakers through', () => {
    const paragraphs: TranscriptParagraphData[] = [
      labeled,
      { ...labeled, id: 4, speaker: 'UNKNOWN' },
    ];
    const unlabeled = formatTranscriptForJudge(paragraphs, false);
    expect(unlabeled).not.toContain('SPEAKER_00');
    expect(unlabeled).not.toContain('UNKNOWN');
    expect(formatTranscriptForJudge(paragraphs, true)).toContain('SPEAKER_00:');
  });
});

describe('evidence hydration against ground-truth paragraphs', () => {
  const paragraphs: TranscriptParagraphData[] = [
    {
      id: 0,
      timestamp: 866,
      text: 'I take Sertraline every morning.',
      speaker: 'SPEAKER_00',
    },
    {
      id: 1,
      timestamp: 18850,
      text: 'My sleep has improved a lot.',
      speaker: 'UNKNOWN',
    },
  ];
  const paragraphsById = new Map(paragraphs.map((p) => [p.id, p]));

  const judgeClaim = (evidence: unknown) => ({
    summary_assessment: 'Mostly accurate.',
    claims: [
      {
        exact_quote: 'The client takes Sertraline.',
        normalized_claim: 'Client takes Sertraline.',
        verdict: 'supported',
        severity: 'none',
        confidence: 0.9,
        reasoning: 'Stated in the transcript.',
        evidence: [evidence],
      },
    ],
    omissions: [],
  });

  it('overwrites hallucinated timestampMs/speaker with ground truth', () => {
    const result = normalizeJudgeOutput(
      judgeClaim({
        paragraphIndex: 0,
        timestampMs: 80000,
        speaker: 'SPEAKER_01',
        quote: 'I take Sertraline.',
      }),
      { paragraphsById, showSpeakers: true }
    );
    expect(result.claims[0].evidence).toEqual([
      {
        paragraphIndex: 0,
        timestampMs: 866,
        speaker: 'SPEAKER_00',
        quote: 'I take Sertraline.',
      },
    ]);
  });

  it('nulls speaker when showSpeakers is false', () => {
    const result = normalizeJudgeOutput(
      judgeClaim({
        paragraphIndex: 0,
        timestampMs: 80000,
        speaker: 'SPEAKER_01',
        quote: 'I take Sertraline.',
      }),
      { paragraphsById, showSpeakers: false }
    );
    expect(result.claims[0].evidence[0]).toMatchObject({
      paragraphIndex: 0,
      timestampMs: 866,
      speaker: null,
    });
  });

  it('nulls speaker when the ground-truth speaker is UNKNOWN', () => {
    const result = normalizeJudgeOutput(
      judgeClaim({
        paragraphIndex: 1,
        timestampMs: 76800,
        speaker: 'UNKNOWN',
        quote: 'My sleep has improved a lot.',
      }),
      { paragraphsById, showSpeakers: true }
    );
    expect(result.claims[0].evidence[0]).toMatchObject({
      paragraphIndex: 1,
      timestampMs: 18850,
      speaker: null,
    });
  });

  it('resolves a missing paragraphIndex by matching the quote', () => {
    expect(
      findParagraphByQuote(paragraphsById, '"My sleep has improved a lot."')
    ).toMatchObject({ id: 1 });
    const result = normalizeJudgeOutput(
      judgeClaim({
        timestampMs: 135000,
        speaker: 'SPEAKER_01',
        quote: '...sleep has improved a lot...',
      }),
      { paragraphsById, showSpeakers: false }
    );
    expect(result.claims[0].evidence[0]).toMatchObject({
      paragraphIndex: 1,
      timestampMs: 18850,
      speaker: null,
    });
  });

  it('nulls citations that match no paragraph in the session', () => {
    const direct = hydrateEvidenceItem(
      {
        paragraphIndex: 99,
        timestampMs: 80000,
        speaker: 'SPEAKER_01',
        quote: 'A claim nowhere in the transcript.',
      },
      { paragraphsById, showSpeakers: true }
    );
    expect(direct).toEqual({
      paragraphIndex: null,
      timestampMs: null,
      speaker: null,
      quote: 'A claim nowhere in the transcript.',
    });
  });

  it('rejects a fabricated quote paired with a valid paragraph index', () => {
    const direct = hydrateEvidenceItem(
      {
        paragraphIndex: 0,
        timestampMs: 866,
        speaker: 'SPEAKER_00',
        quote: 'The client levitates every evening.',
      },
      { paragraphsById, showSpeakers: true }
    );
    expect(direct).toEqual({
      paragraphIndex: null,
      timestampMs: null,
      speaker: null,
      quote: 'The client levitates every evening.',
    });
  });

  it('re-attributes a mismatched index to the paragraph containing the quote', () => {
    const direct = hydrateEvidenceItem(
      {
        paragraphIndex: 1,
        timestampMs: 18850,
        speaker: 'UNKNOWN',
        quote: 'I take Sertraline.',
      },
      { paragraphsById, showSpeakers: true }
    );
    expect(direct).toEqual({
      paragraphIndex: 0,
      timestampMs: 866,
      speaker: 'SPEAKER_00',
      quote: 'I take Sertraline.',
    });
  });

  it('keeps a correctly matched citation on its indexed paragraph', () => {
    const direct = hydrateEvidenceItem(
      {
        paragraphIndex: 0,
        timestampMs: 80000,
        speaker: 'SPEAKER_01',
        quote: 'I take Sertraline.',
      },
      { paragraphsById, showSpeakers: true }
    );
    expect(direct).toEqual({
      paragraphIndex: 0,
      timestampMs: 866,
      speaker: 'SPEAKER_00',
      quote: 'I take Sertraline.',
    });
  });

  it('hydrates omission evidence as well', () => {
    const result = normalizeJudgeOutput(
      {
        summary_assessment: 'Missed a point.',
        claims: [],
        omissions: [
          {
            normalized_claim: 'Client takes Sertraline.',
            severity: 'high',
            confidence: 0.8,
            reasoning: 'Matters.',
            evidence: [
              {
                paragraphIndex: 0,
                timestampMs: 80000,
                speaker: 'SPEAKER_01',
                quote: 'I take Sertraline.',
              },
            ],
          },
        ],
      },
      { paragraphsById, showSpeakers: true }
    );
    expect(result.omissions[0].evidence[0]).toMatchObject({
      paragraphIndex: 0,
      timestampMs: 866,
      speaker: 'SPEAKER_00',
    });
  });

  it('preserves legacy behavior when no hydration context is given', () => {
    const result = normalizeJudgeOutput(
      judgeClaim({
        paragraphIndex: 7,
        timestampMs: 80000,
        speaker: 'SPEAKER_01',
        quote: 'I take Sertraline.',
      })
    );
    expect(result.claims[0].evidence[0]).toMatchObject({
      paragraphIndex: 7,
      timestampMs: 80000,
      speaker: 'SPEAKER_01',
    });
  });
});

describe('DEFAULT_VERIFICATION_JUDGE_PROMPT', () => {
  it('tells the Judge how to cite paragraphIndex and null speakers', () => {
    expect(DEFAULT_VERIFICATION_JUDGE_PROMPT).toContain('[P#<index>');
    expect(DEFAULT_VERIFICATION_JUDGE_PROMPT).toContain('paragraphIndex');
    expect(DEFAULT_VERIFICATION_JUDGE_PROMPT).toMatch(/speaker.*null when/i);
  });
});

describe('resolveJudgeThinkingBudget', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('caps an unrestricted (-1-clamped) budget at 2048', () => {
    resolveBudgetStub.mockReturnValue(4000);
    expect(resolveJudgeThinkingBudget(-1, 4000)).toBe(
      JUDGE_MAX_THINKING_BUDGET
    );
    expect(JUDGE_MAX_THINKING_BUDGET).toBe(2048);
  });

  it('passes through budgets already under the cap', () => {
    resolveBudgetStub.mockReturnValue(512);
    expect(resolveJudgeThinkingBudget(512, 1638)).toBe(512);
  });

  it('keeps thinking disabled when the shared resolver returns 0', () => {
    resolveBudgetStub.mockReturnValue(0);
    expect(resolveJudgeThinkingBudget(0, 1638)).toBe(0);
  });
});

describe('sanitizeJsonForParse', () => {
  it('recovers raw newlines/tabs inside string literals', () => {
    const raw = '{"summary": "line one\nline two\tindented", "n": 1}';
    expect(() => JSON.parse(raw)).toThrow();
    expect(JSON.parse(sanitizeJsonForParse(raw))).toEqual({
      summary: 'line one\nline two\tindented',
      n: 1,
    });
  });

  it('strips trailing commas before } and ]', () => {
    const raw = '{"claims": [{"a": 1,},], "omissions": [],}';
    expect(() => JSON.parse(raw)).toThrow();
    expect(JSON.parse(sanitizeJsonForParse(raw))).toEqual({
      claims: [{ a: 1 }],
      omissions: [],
    });
  });

  it('leaves commas and braces inside string values untouched', () => {
    const raw = '{"reasoning": "ends with ,} inside", "n": 2,}';
    expect(JSON.parse(sanitizeJsonForParse(raw))).toEqual({
      reasoning: 'ends with ,} inside',
      n: 2,
    });
  });

  it('is a no-op for already-valid JSON', () => {
    const raw = '{"a": "x\\"y\\n", "b": [1, 2]}';
    expect(sanitizeJsonForParse(raw)).toBe(raw);
  });
});

describe('parseJudgeJson', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('passes strict-parseable output through without sanitizing', () => {
    parseJsonMock.mockReturnValueOnce({ ok: true });
    expect(parseJudgeJson('{"ok": true}')).toEqual({ ok: true });
    expect(extractJsonObjectMock).not.toHaveBeenCalled();
  });

  it('recovers via sanitize when the strict parse throws', () => {
    const raw = '{"summary": "a\nb", "n": 1,}';
    parseJsonMock.mockImplementationOnce(() => {
      throw new Error('Bad control character in string literal');
    });
    extractJsonObjectMock.mockReturnValueOnce({
      json: raw,
      complete: true,
    });
    expect(parseJudgeJson(raw)).toEqual({ summary: 'a\nb', n: 1 });
  });

  it('returns null for truncated output without attempting sanitize', () => {
    parseJsonMock.mockReturnValueOnce(null);
    expect(parseJudgeJson('<think>unfinished reasoning')).toBeNull();
    expect(extractJsonObjectMock).not.toHaveBeenCalled();
  });

  it('returns null when the sanitized re-parse still fails', () => {
    parseJsonMock.mockImplementationOnce(() => {
      throw new Error("Expected ',' or '}' after property value");
    });
    extractJsonObjectMock.mockReturnValueOnce({
      json: '{oops not json at all}',
      complete: true,
    });
    expect(parseJudgeJson('{oops not json at all}')).toBeNull();
  });
});

describe('validateJudgeOutputStructure', () => {
  it('rejects empty and error objects', () => {
    expect(validateJudgeOutputStructure({}).valid).toBe(false);
    expect(
      validateJudgeOutputStructure({ error: 'unable to assess' }).valid
    ).toBe(false);
    expect(validateJudgeOutputStructure({}).reason).toMatch(/claims/);
  });

  it('rejects missing or non-array required arrays', () => {
    expect(
      validateJudgeOutputStructure({ claims: [], omissions: [] }).valid
    ).toBe(true);
    expect(validateJudgeOutputStructure({ claims: [] }).valid).toBe(false);
    expect(validateJudgeOutputStructure({ omissions: [] }).valid).toBe(false);
    expect(
      validateJudgeOutputStructure({ claims: 'none', omissions: [] }).valid
    ).toBe(false);
    expect(
      validateJudgeOutputStructure({ claims: [], omissions: {} }).valid
    ).toBe(false);
    expect(
      validateJudgeOutputStructure({ claims: null, omissions: null }).valid
    ).toBe(false);
  });

  it('rejects claim arrays with no usable records', () => {
    expect(
      validateJudgeOutputStructure({
        claims: [{ foo: 1 }, 'not-an-object', null, 42],
        omissions: [],
      }).valid
    ).toBe(false);
    expect(
      validateJudgeOutputStructure({
        claims: [{ exact_quote: '   ', normalized_claim: '' }],
        omissions: [],
      }).valid
    ).toBe(false);
  });

  it('rejects omission arrays with no usable records', () => {
    expect(
      validateJudgeOutputStructure({
        claims: [],
        omissions: [{ severity: 'high' }, null],
      }).valid
    ).toBe(false);
  });

  it('rejects non-object top-level values', () => {
    expect(validateJudgeOutputStructure(null).valid).toBe(false);
    expect(validateJudgeOutputStructure([]).valid).toBe(false);
    expect(validateJudgeOutputStructure('claims').valid).toBe(false);
    expect(validateJudgeOutputStructure(42).valid).toBe(false);
  });

  it('accepts explicitly valid empty arrays', () => {
    expect(
      validateJudgeOutputStructure({
        summary_assessment:
          'Conversational acknowledgement; nothing to verify.',
        claims: [],
        omissions: [],
      })
    ).toEqual({ valid: true, reason: null });
  });

  it('accepts arrays with at least one usable record', () => {
    expect(
      validateJudgeOutputStructure({
        claims: [
          { bogus: true },
          { exact_quote: 'The client takes Sertraline.' },
        ],
        omissions: [],
      }).valid
    ).toBe(true);
    expect(
      validateJudgeOutputStructure({
        claims: [],
        omissions: [{ normalized_claim: 'Missed the dosage detail.' }],
      }).valid
    ).toBe(true);
  });
});

describe('isTrivialConversationalMessage', () => {
  it('matches the canonical short greeting', () => {
    expect(
      isTrivialConversationalMessage(
        'Hello! How can I help you with the information provided in this transcript?'
      )
    ).toBe(true);
  });

  it('strips <think> blocks before matching', () => {
    expect(
      isTrivialConversationalMessage(
        '<think>deciding how to greet the user</think>Hi there! What would you like to know?'
      )
    ).toBe(true);
  });

  it('matches other short greeting/prompt patterns', () => {
    expect(isTrivialConversationalMessage('Hey! How may I assist you?')).toBe(
      true
    );
    expect(isTrivialConversationalMessage('Good morning! Happy to help.')).toBe(
      true
    );
  });

  it('rejects short factual answers containing digits', () => {
    expect(
      isTrivialConversationalMessage('The client reported 3 panic attacks.')
    ).toBe(false);
  });

  it('rejects messages containing quotes or lists', () => {
    expect(
      isTrivialConversationalMessage('Hello, the client said "hi" back.')
    ).toBe(false);
    expect(isTrivialConversationalMessage('Hello:\n- one\n- two')).toBe(false);
    expect(
      isTrivialConversationalMessage('Hello, see `code` for details.')
    ).toBe(false);
  });

  it('rejects long messages and content without a greeting pattern', () => {
    expect(
      isTrivialConversationalMessage(
        'Hello there, this greeting is deliberately padded well beyond the one hundred and twenty character limit so it cannot fast-path.'
      )
    ).toBe(false);
    expect(
      isTrivialConversationalMessage('The client takes Sertraline daily.')
    ).toBe(false);
    expect(isTrivialConversationalMessage('   ')).toBe(false);
  });

  it('rejects greetings followed by factual claims', () => {
    expect(
      isTrivialConversationalMessage(
        'Hello! The patient reported suicidal thoughts.'
      )
    ).toBe(false);
    expect(
      isTrivialConversationalMessage('Hi! The client takes Sertraline daily.')
    ).toBe(false);
    expect(
      isTrivialConversationalMessage(
        'Good morning! The patient described panic attacks.'
      )
    ).toBe(false);
    // Spelled-out numbers carry no digits but are still substantive.
    expect(
      isTrivialConversationalMessage('Hi! The client had three panic attacks.')
    ).toBe(false);
  });

  it('rejects factual answers ending with a conversational prompt', () => {
    expect(
      isTrivialConversationalMessage(
        'The patient takes Sertraline. Let me know if you need anything else.'
      )
    ).toBe(false);
    expect(
      isTrivialConversationalMessage(
        'The client reported insomnia. Please let me know if you have questions!'
      )
    ).toBe(false);
    expect(
      isTrivialConversationalMessage('Let me know. The patient is stable.')
    ).toBe(false);
  });

  it('rejects single-clause blends of greeting and factual content', () => {
    expect(
      isTrivialConversationalMessage('Hello, the patient is stable.')
    ).toBe(false);
    expect(
      isTrivialConversationalMessage(
        'Happy to help explain that the client takes Sertraline.'
      )
    ).toBe(false);
    expect(
      isTrivialConversationalMessage(
        'How can I help you understand the patient diagnosis?'
      )
    ).toBe(false);
  });

  it('still matches pure multi-clause conversational greetings', () => {
    expect(isTrivialConversationalMessage('Hello!')).toBe(true);
    expect(isTrivialConversationalMessage('Hello, how are you?')).toBe(true);
    expect(isTrivialConversationalMessage('Hello! How are you today?')).toBe(
      true
    );
    expect(
      isTrivialConversationalMessage('Hi, how can I help you today?')
    ).toBe(true);
    expect(
      isTrivialConversationalMessage(
        'Good morning, happy to help with your questions.'
      )
    ).toBe(true);
    expect(
      isTrivialConversationalMessage('Please let me know if you need anything!')
    ).toBe(true);
  });
});

describe('processVerificationJob — judge hardening', () => {
  const paragraphs: TranscriptParagraphData[] = [
    {
      id: 0,
      timestamp: 866,
      text: 'I take Sertraline every morning and I feel better.',
      speaker: 'SPEAKER_00',
    },
  ];

  const jobRecord = {
    id: 1,
    status: 'pending',
    scope: 'all_unverified',
    session_ids_json: null,
    chat_id: null,
    skip_verified: true,
    total_messages: 0,
    processed_messages: 0,
    total_statements: 0,
    flagged_statements: 0,
    omissions_count: 0,
    created_at: Date.now(),
    completed_at: null,
    error_message: null,
    model_name: 'default',
    context_size: 8192,
    thinking_budget: -1,
    temperature: 0.3,
    top_p: null,
    repeat_penalty: null,
    num_gpu_layers: null,
    llm_base_url: null,
  };

  const candidateFor = (text: string) => ({
    id: 11,
    chatId: 5,
    sessionId: 2,
    sender: 'ai',
    text,
    timestamp: Date.now(),
    model: 'author-model',
    userQuestion: 'What did the client say?',
  });

  async function* fakeStream(
    chunks: Array<{ content?: string; thinking?: string }>,
    result: { promptTokens?: number; completionTokens?: number }
  ): AsyncGenerator<{ content?: string; thinking?: string }, unknown> {
    for (const chunk of chunks) yield chunk;
    return result;
  }

  beforeEach(() => {
    vi.resetAllMocks();
    extractVisibleAnswerMock.mockImplementation((text: string) => text);
    calculateTokenCountMock.mockReturnValue(10);
    resolveBudgetStub.mockReturnValue(1638);
    findJobMock.mockReturnValue({ ...jobRecord });
    findParagraphsMock.mockReturnValue(paragraphs);
    findTemplateMock.mockReturnValue(null);
    findSessionMock.mockReturnValue({ showSpeakers: 1 });
    updateJobStatusMock.mockReturnValue(true);
    saveResultMock.mockReturnValue({});
    // Transparent streamWithRetry: run the factory once, no retries.
    streamWithRetryMock.mockImplementation(async function* (factory: any) {
      return yield* factory();
    });
  });

  const runJob = () =>
    processVerificationJob({
      data: { jobId: 1 },
      updateProgress: vi.fn(),
    } as any);

  it('retries once with thinking disabled when the first response is truncated inside <think>', async () => {
    findCandidatesMock.mockReturnValue([
      candidateFor('The client takes Sertraline every morning.'),
    ]);
    // First attempt: thinking-only output (truncated, no JSON).
    streamLlmMock
      .mockImplementationOnce(() =>
        fakeStream([{ thinking: 'let me think…' }], {
          promptTokens: 100,
          completionTokens: 7000,
        })
      )
      // Retry: valid JSON content.
      .mockImplementationOnce(() =>
        fakeStream([{ content: '{"summary_assessment": "ok"}' }], {
          promptTokens: 120,
          completionTokens: 60,
        })
      );
    parseJsonMock.mockReturnValueOnce(null).mockReturnValueOnce({
      summary_assessment: 'All supported.',
      claims: [
        {
          exact_quote: 'The client takes Sertraline every morning',
          normalized_claim: 'Client takes Sertraline every morning.',
          verdict: 'supported',
          severity: 'none',
          confidence: 0.9,
          reasoning: 'Stated verbatim in P#0.',
          evidence: [],
        },
      ],
      omissions: [],
    });

    await runJob();

    expect(streamLlmMock).toHaveBeenCalledTimes(2);
    // Initial call uses the capped thinking budget, retry disables thinking
    // with low-variance sampling.
    expect(streamLlmMock.mock.calls[0][1]).toMatchObject({
      thinkingBudget: 1638,
      temperature: 0.3,
    });
    expect(streamLlmMock.mock.calls[1][1]).toMatchObject({
      thinkingBudget: 0,
      temperature: 0.1,
      chatTemplateKwargs: { enable_thinking: false },
    });
    // Retry appends the strict-JSON reminder to the user message.
    const retryMessages = streamLlmMock.mock.calls[1][0];
    expect(retryMessages[1].text).toContain('valid JSON');
    // Usage is logged per attempt; the message row accumulates both.
    expect(insertUsageMock).toHaveBeenCalledTimes(2);
    expect(saveResultMock).toHaveBeenCalledTimes(1);
    expect(saveResultMock.mock.calls[0][0]).toMatchObject({
      messageId: 11,
      accuracyScore: 1,
      promptTokens: 220,
      completionTokens: 7060,
    });
    expect(saveResultMock.mock.calls[0][0].status ?? 'completed').toBe(
      'completed'
    );
  });

  it('persists accumulated usage on the failed row when both attempts fail parsing', async () => {
    findCandidatesMock.mockReturnValue([
      candidateFor('The client takes Sertraline every morning.'),
    ]);
    streamLlmMock
      .mockImplementationOnce(() =>
        fakeStream([{ thinking: 'thinking…' }], {
          promptTokens: 50,
          completionTokens: 500,
        })
      )
      .mockImplementationOnce(() =>
        fakeStream([{ content: 'still not json' }], {
          promptTokens: 60,
          completionTokens: 70,
        })
      );
    parseJsonMock.mockReturnValue(null);
    extractJsonObjectMock.mockReturnValue({ json: '', complete: false });

    await runJob();

    expect(streamLlmMock).toHaveBeenCalledTimes(2);
    expect(insertUsageMock).toHaveBeenCalledTimes(2);
    expect(saveResultMock).toHaveBeenCalledTimes(1);
    expect(saveResultMock.mock.calls[0][0]).toMatchObject({
      messageId: 11,
      status: 'failed',
      promptTokens: 110,
      completionTokens: 570,
    });
    expect(saveResultMock.mock.calls[0][0].durationMs).toEqual(
      expect.any(Number)
    );
    expect(saveResultMock.mock.calls[0][0].errorMessage).toContain(
      'did not return valid JSON'
    );
  });

  it('short-circuits trivial greetings with zero LLM calls', async () => {
    findCandidatesMock.mockReturnValue([
      candidateFor(
        'Hello! How can I help you with the information provided in this transcript?'
      ),
    ]);

    await runJob();

    expect(streamLlmMock).not.toHaveBeenCalled();
    expect(insertUsageMock).not.toHaveBeenCalled();
    expect(saveResultMock).toHaveBeenCalledTimes(1);
    expect(saveResultMock.mock.calls[0][0]).toMatchObject({
      messageId: 11,
      accuracyScore: 1.0,
      statements: [],
      promptTokens: 0,
      completionTokens: 0,
      durationMs: 0,
    });
  });

  it('still sends short factual answers to the Judge LLM', async () => {
    findCandidatesMock.mockReturnValue([
      candidateFor('The client reported 3 panic attacks.'),
    ]);
    streamLlmMock.mockImplementationOnce(() =>
      fakeStream([{ content: '{"summary_assessment": "clean"}' }], {
        promptTokens: 90,
        completionTokens: 40,
      })
    );
    parseJsonMock.mockReturnValueOnce({
      summary_assessment: 'No verifiable claims beyond the count.',
      claims: [],
      omissions: [],
    });

    await runJob();

    expect(streamLlmMock).toHaveBeenCalledTimes(1);
    expect(saveResultMock).toHaveBeenCalledTimes(1);
    expect(saveResultMock.mock.calls[0][0]).toMatchObject({
      messageId: 11,
      accuracyScore: 1,
      promptTokens: 90,
      completionTokens: 40,
    });
  });

  it('sends greeting-prefixed factual answers to the Judge and records negative verdicts', async () => {
    findCandidatesMock.mockReturnValue([
      candidateFor('Hello! The patient reported suicidal thoughts.'),
    ]);
    streamLlmMock.mockImplementationOnce(() =>
      fakeStream([{ content: '{"summary_assessment": "flagged"}' }], {
        promptTokens: 90,
        completionTokens: 40,
      })
    );
    parseJsonMock.mockReturnValueOnce({
      summary_assessment: 'Contradicted by the transcript.',
      claims: [
        {
          exact_quote: 'The patient reported suicidal thoughts.',
          normalized_claim: 'Patient reported suicidal thoughts.',
          verdict: 'contradicted',
          severity: 'high',
          confidence: 0.9,
          reasoning: 'No such statement in the transcript.',
          evidence: [],
        },
      ],
      omissions: [],
    });

    await runJob();

    expect(streamLlmMock).toHaveBeenCalledTimes(1);
    expect(saveResultMock).toHaveBeenCalledTimes(1);
    expect(saveResultMock.mock.calls[0][0]).toMatchObject({
      messageId: 11,
      accuracyScore: 0,
    });
    expect(saveResultMock.mock.calls[0][0].statements).toHaveLength(1);
    expect(saveResultMock.mock.calls[0][0].statements[0]).toMatchObject({
      verdict: 'contradicted',
    });
  });

  it('sends factual answers ending with a prompt to the Judge and records negative verdicts', async () => {
    findCandidatesMock.mockReturnValue([
      candidateFor(
        'The client takes Sertraline daily. Let me know if you need anything else!'
      ),
    ]);
    streamLlmMock.mockImplementationOnce(() =>
      fakeStream([{ content: '{"summary_assessment": "flagged"}' }], {
        promptTokens: 90,
        completionTokens: 40,
      })
    );
    parseJsonMock.mockReturnValueOnce({
      summary_assessment: 'Fabricated medication claim.',
      claims: [
        {
          exact_quote: 'The client takes Sertraline daily.',
          normalized_claim: 'Client takes Sertraline daily.',
          verdict: 'fabricated',
          severity: 'high',
          confidence: 0.95,
          reasoning: 'No medication mention in the transcript.',
          evidence: [],
        },
      ],
      omissions: [],
    });

    await runJob();

    expect(streamLlmMock).toHaveBeenCalledTimes(1);
    expect(saveResultMock).toHaveBeenCalledTimes(1);
    expect(saveResultMock.mock.calls[0][0]).toMatchObject({
      messageId: 11,
      accuracyScore: 0,
    });
    expect(saveResultMock.mock.calls[0][0].statements).toHaveLength(1);
    expect(saveResultMock.mock.calls[0][0].statements[0]).toMatchObject({
      verdict: 'fabricated',
    });
  });

  it('retries once when the first response is structurally invalid, then completes on a valid retry', async () => {
    findCandidatesMock.mockReturnValue([
      candidateFor('The client takes Sertraline every morning.'),
    ]);
    streamLlmMock
      .mockImplementationOnce(() =>
        fakeStream([{ content: '{}' }], {
          promptTokens: 100,
          completionTokens: 10,
        })
      )
      .mockImplementationOnce(() =>
        fakeStream([{ content: '{"summary_assessment": "ok"}' }], {
          promptTokens: 120,
          completionTokens: 60,
        })
      );
    parseJsonMock.mockReturnValueOnce({}).mockReturnValueOnce({
      summary_assessment: 'All supported.',
      claims: [
        {
          exact_quote: 'The client takes Sertraline every morning',
          normalized_claim: 'Client takes Sertraline every morning.',
          verdict: 'supported',
          severity: 'none',
          confidence: 0.9,
          reasoning: 'Stated verbatim in P#0.',
          evidence: [],
        },
      ],
      omissions: [],
    });

    await runJob();

    expect(streamLlmMock).toHaveBeenCalledTimes(2);
    expect(streamLlmMock.mock.calls[1][1]).toMatchObject({
      thinkingBudget: 0,
      temperature: 0.1,
    });
    expect(saveResultMock).toHaveBeenCalledTimes(1);
    expect(saveResultMock.mock.calls[0][0]).toMatchObject({
      messageId: 11,
      accuracyScore: 1,
      promptTokens: 220,
      completionTokens: 70,
    });
    expect(saveResultMock.mock.calls[0][0].status ?? 'completed').toBe(
      'completed'
    );
  });

  it('persists a failed verification when both attempts return structurally invalid JSON', async () => {
    findCandidatesMock.mockReturnValue([
      candidateFor('The client takes Sertraline every morning.'),
    ]);
    streamLlmMock
      .mockImplementationOnce(() =>
        fakeStream([{ content: '{}' }], {
          promptTokens: 100,
          completionTokens: 10,
        })
      )
      .mockImplementationOnce(() =>
        fakeStream([{ content: '{"error": "unable to assess"}' }], {
          promptTokens: 120,
          completionTokens: 15,
        })
      );
    parseJsonMock
      .mockReturnValueOnce({})
      .mockReturnValueOnce({ error: 'unable to assess' });

    await runJob();

    expect(streamLlmMock).toHaveBeenCalledTimes(2);
    expect(insertUsageMock).toHaveBeenCalledTimes(2);
    expect(saveResultMock).toHaveBeenCalledTimes(1);
    expect(saveResultMock.mock.calls[0][0]).toMatchObject({
      messageId: 11,
      status: 'failed',
      promptTokens: 220,
      completionTokens: 25,
    });
    expect(saveResultMock.mock.calls[0][0].errorMessage).toMatch(
      /structurally invalid/
    );
    expect(saveResultMock.mock.calls[0][0]).not.toMatchObject({
      accuracyScore: 1,
    });
  });

  it('persists a failed verification when claim entries are all malformed', async () => {
    findCandidatesMock.mockReturnValue([
      candidateFor('The client takes Sertraline every morning.'),
    ]);
    streamLlmMock.mockImplementation(() =>
      fakeStream([{ content: '{"claims": [{}]}' }], {
        promptTokens: 100,
        completionTokens: 20,
      })
    );
    parseJsonMock.mockReturnValue({
      summary_assessment: 'No usable records.',
      claims: [{ unrelated: 'field' }, 'junk', null],
      omissions: [],
    });

    await runJob();

    expect(streamLlmMock).toHaveBeenCalledTimes(2);
    expect(saveResultMock).toHaveBeenCalledTimes(1);
    expect(saveResultMock.mock.calls[0][0].status).toBe('failed');
    expect(saveResultMock.mock.calls[0][0].errorMessage).toMatch(
      /structurally invalid/
    );
  });

  it('persists a failed verification when claims is not an array', async () => {
    findCandidatesMock.mockReturnValue([
      candidateFor('The client takes Sertraline every morning.'),
    ]);
    streamLlmMock.mockImplementation(() =>
      fakeStream([{ content: '{"claims": "none"}' }], {
        promptTokens: 100,
        completionTokens: 20,
      })
    );
    parseJsonMock.mockReturnValue({
      summary_assessment: 'Wrong-typed claims.',
      claims: 'none',
      omissions: [],
    });

    await runJob();

    expect(streamLlmMock).toHaveBeenCalledTimes(2);
    expect(saveResultMock).toHaveBeenCalledTimes(1);
    expect(saveResultMock.mock.calls[0][0].status).toBe('failed');
    expect(saveResultMock.mock.calls[0][0].errorMessage).toMatch(
      /structurally invalid/
    );
  });
});
