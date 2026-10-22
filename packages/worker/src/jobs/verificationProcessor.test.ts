// packages/worker/src/jobs/verificationProcessor.test.ts
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'vitest';
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
    updateJobPhase: vi.fn(),
    clearJobPhase: vi.fn(),
    incrementJobCounters: vi.fn(),
    transitionJobToProcessing: vi.fn(),
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
  allocateJudgeContextBudget,
  estimateTokens,
  JUDGE_CONTEXT_SAFETY_MARGIN_TOKENS,
  JUDGE_MIN_COMPLETION_TOKENS,
  JUDGE_MIN_TRANSCRIPT_TOKENS,
  buildMessageFailureMessage,
  buildJobFailureSummary,
  VERIFICATION_TOKEN_TELEMETRY_THROTTLE_MS,
  describeVerificationPhase,
  truncateVerificationDetail,
  verificationFailureLabel,
  CodedVerificationError,
  readVerificationFailureCode,
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
const updateJobPhaseMock = data.verificationRepository
  .updateJobPhase as unknown as Mock;
const clearJobPhaseMock = data.verificationRepository
  .clearJobPhase as unknown as Mock;
const incrementJobCountersMock = data.verificationRepository
  .incrementJobCounters as unknown as Mock;
const transitionToProcessingMock = data.verificationRepository
  .transitionJobToProcessing as unknown as Mock;
const saveResultMock = data.verificationRepository
  .saveMessageVerificationResult as unknown as Mock;
const findParagraphsMock = data.transcriptRepository
  .findParagraphsBySessionId as unknown as Mock;
const insertUsageMock = data.usageRepository.insertUsageLog as unknown as Mock;
const findTemplateMock = data.templateRepository.findByTitle as unknown as Mock;
const findSessionMock = data.sessionRepository.findById as unknown as Mock;
const resolveBudgetStub =
  analysisStub.resolveEffectiveThinkingBudget as unknown as Mock;
const loadModelMock = analysisStub.loadLlmModelForWorker as unknown as Mock;
const unloadModelMock =
  analysisStub.unloadModelAtUrlForWorker as unknown as Mock;
const publisher = await import('../services/streamPublisher.js');
const publishEventMock = publisher.publishVerificationEvent as unknown as Mock;

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
    transitionToProcessingMock.mockReturnValue(true);
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

describe('processVerificationJob — cancellation during model loading', () => {
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
    model_name: 'judge-model',
    context_size: 8192,
    thinking_budget: -1,
    temperature: 0.3,
    top_p: null,
    repeat_penalty: null,
    num_gpu_layers: null,
    llm_base_url: null,
  };

  // Stateful stand-in for the SQLite row: status writes are visible to later
  // reads, so an unconditional `processing` write genuinely overwrites a
  // `canceled` row exactly as in production.
  let rowStatus: string;

  async function* fakeStream(
    chunks: Array<{ content?: string; thinking?: string }>,
    result: { promptTokens?: number; completionTokens?: number }
  ): AsyncGenerator<{ content?: string; thinking?: string }, unknown> {
    for (const chunk of chunks) yield chunk;
    return result;
  }

  beforeEach(() => {
    vi.resetAllMocks();
    rowStatus = 'pending';
    // Conditional `pending -> processing` transition with production
    // semantics: terminal rows are never revived.
    const terminal = ['completed', 'failed', 'canceled'];
    transitionToProcessingMock.mockImplementation(() => {
      if (terminal.includes(rowStatus)) return false;
      rowStatus = 'processing';
      return true;
    });
    findJobMock.mockImplementation(() => ({ ...jobRecord, status: rowStatus }));
    updateJobStatusMock.mockImplementation((_jobId: number, status: string) => {
      rowStatus = status;
      return true;
    });
    extractVisibleAnswerMock.mockImplementation((text: string) => text);
    calculateTokenCountMock.mockReturnValue(10);
    resolveBudgetStub.mockReturnValue(1638);
    findParagraphsMock.mockReturnValue([
      {
        id: 0,
        timestamp: 866,
        text: 'I take Sertraline every morning and I feel better.',
        speaker: 'SPEAKER_00',
      },
    ]);
    findSessionMock.mockReturnValue({ showSpeakers: 1 });
    saveResultMock.mockReturnValue({});
    streamWithRetryMock.mockImplementation(async function* (factory: any) {
      return yield* factory();
    });
    streamLlmMock.mockImplementation(() =>
      fakeStream([{ content: '{"summary_assessment": "ok"}' }], {
        promptTokens: 90,
        completionTokens: 40,
      })
    );
    parseJsonMock.mockReturnValue({
      summary_assessment: 'All supported.',
      claims: [],
      omissions: [],
    });
    findTemplateMock.mockReturnValue(null);
    findCandidatesMock.mockReturnValue([
      {
        id: 11,
        chatId: 5,
        sessionId: 2,
        sender: 'ai',
        text: 'The client takes Sertraline every morning.',
        timestamp: Date.now(),
        model: 'author-model',
        userQuestion: 'What did the client say?',
      },
    ]);
  });

  const runJob = () =>
    processVerificationJob({
      data: { jobId: 1 },
      updateProgress: vi.fn(),
    } as any);

  const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

  const processingWrites = () =>
    updateJobStatusMock.mock.calls.filter((call) => call[1] === 'processing');

  it('preserves cancellation when the job is canceled while model loading resolves', async () => {
    let resolveLoad!: () => void;
    loadModelMock.mockImplementationOnce(
      () => new Promise<void>((resolve) => void (resolveLoad = resolve))
    );

    const pending = runJob();
    await tick();
    // API cancels the row while the worker is still awaiting the load.
    rowStatus = 'canceled';
    resolveLoad();
    await pending;

    expect(processingWrites()).toHaveLength(0);
    expect(streamLlmMock).not.toHaveBeenCalled();
    expect(saveResultMock).not.toHaveBeenCalled();
    expect(rowStatus).toBe('canceled');
    expect(publishEventMock).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ status: 'canceled' })
    );
  });

  it('preserves cancellation when the job is canceled while model loading rejects', async () => {
    let rejectLoad!: (err: Error) => void;
    loadModelMock.mockImplementationOnce(
      () => new Promise<void>((_resolve, reject) => void (rejectLoad = reject))
    );

    const pending = runJob();
    await tick();
    // API cancels the row while the worker is still awaiting the load.
    rowStatus = 'canceled';
    rejectLoad(new Error('model endpoint unavailable'));
    await pending;

    expect(processingWrites()).toHaveLength(0);
    expect(
      updateJobStatusMock.mock.calls.filter((call) => call[1] === 'failed')
    ).toHaveLength(0);
    expect(streamLlmMock).not.toHaveBeenCalled();
    expect(saveResultMock).not.toHaveBeenCalled();
    expect(rowStatus).toBe('canceled');
    expect(publishEventMock).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ status: 'canceled' })
    );
  });

  it('refuses to move a terminal job back to processing via the conditional transition', async () => {
    // Simulates the lost-race window: the row becomes terminal after the
    // worker's post-load re-read but before the `processing` write.
    transitionJobToProcessingFallbackCheck();
    let resolveLoad!: () => void;
    loadModelMock.mockImplementationOnce(
      () => new Promise<void>((resolve) => void (resolveLoad = resolve))
    );

    const pending = runJob();
    await tick();
    resolveLoad();
    // Cancel lands after the post-load re-read: flip the row exactly when
    // the candidates query runs (the last read before the `processing` write).
    await pending;

    expect(processingWrites()).toHaveLength(0);
    expect(streamLlmMock).not.toHaveBeenCalled();
    expect(rowStatus).toBe('canceled');
  });

  function transitionJobToProcessingFallbackCheck() {
    findCandidatesMock.mockImplementationOnce(() => {
      rowStatus = 'canceled';
      return [
        {
          id: 11,
          chatId: 5,
          sessionId: 2,
          sender: 'ai',
          text: 'The client takes Sertraline every morning.',
          timestamp: Date.now(),
          model: 'author-model',
          userQuestion: 'What did the client say?',
        },
      ];
    });
  }
});

describe('processVerificationJob — early-cancel resource ownership', () => {
  const REMOTE_JUDGE_URL = 'http://remote-judge:1234';
  const LOCAL_DEFAULT_URL = 'http://localhost:1234';

  const baseRecord = {
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
    model_name: 'judge-model',
    context_size: 8192,
    thinking_budget: -1,
    temperature: 0.3,
    top_p: null,
    repeat_penalty: null,
    num_gpu_layers: null,
    llm_base_url: REMOTE_JUDGE_URL,
  };

  let rowStatus: string;

  async function* fakeStream(
    chunks: Array<{ content?: string; thinking?: string }>,
    result: { promptTokens?: number; completionTokens?: number }
  ): AsyncGenerator<{ content?: string; thinking?: string }, unknown> {
    for (const chunk of chunks) yield chunk;
    return result;
  }

  beforeEach(() => {
    vi.resetAllMocks();
    rowStatus = 'pending';
    const terminal = ['completed', 'failed', 'canceled'];
    transitionToProcessingMock.mockImplementation(() => {
      if (terminal.includes(rowStatus)) return false;
      rowStatus = 'processing';
      return true;
    });
    findJobMock.mockImplementation(() => ({
      ...baseRecord,
      status: rowStatus,
    }));
    updateJobStatusMock.mockImplementation((_jobId: number, status: string) => {
      rowStatus = status;
      return true;
    });
    extractVisibleAnswerMock.mockImplementation((text: string) => text);
    calculateTokenCountMock.mockReturnValue(10);
    resolveBudgetStub.mockReturnValue(1638);
    findParagraphsMock.mockReturnValue([
      {
        id: 0,
        timestamp: 866,
        text: 'I take Sertraline every morning and I feel better.',
        speaker: 'SPEAKER_00',
      },
    ]);
    findSessionMock.mockReturnValue({ showSpeakers: 1 });
    saveResultMock.mockReturnValue({});
    streamWithRetryMock.mockImplementation(async function* (factory: any) {
      return yield* factory();
    });
    streamLlmMock.mockImplementation(() =>
      fakeStream([{ content: '{"summary_assessment": "ok"}' }], {
        promptTokens: 90,
        completionTokens: 40,
      })
    );
    parseJsonMock.mockReturnValue({
      summary_assessment: 'All supported.',
      claims: [],
      omissions: [],
    });
    findTemplateMock.mockReturnValue(null);
    findCandidatesMock.mockReturnValue([
      {
        id: 11,
        chatId: 5,
        sessionId: 2,
        sender: 'ai',
        text: 'The client takes Sertraline every morning.',
        timestamp: Date.now(),
        model: 'author-model',
        userQuestion: 'What did the client say?',
      },
    ]);
    loadModelMock.mockResolvedValue(undefined);
    unloadModelMock.mockResolvedValue(0);
  });

  const runJob = () =>
    processVerificationJob({
      data: { jobId: 1 },
      updateProgress: vi.fn(),
    } as any);

  const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

  it('makes no load/unload calls for a pre-canceled remote job', async () => {
    // A queued job canceled while waiting for the worker mutex: the worker
    // must exit without touching any model endpoint, so an unrelated local
    // chat model stays loaded.
    rowStatus = 'canceled';

    await runJob();

    expect(loadModelMock).not.toHaveBeenCalled();
    expect(unloadModelMock).not.toHaveBeenCalled();
    expect(streamLlmMock).not.toHaveBeenCalled();
    expect(rowStatus).toBe('canceled');
    expect(publishEventMock).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ status: 'canceled' })
    );
  });

  it('makes no unload calls when the job row is missing', async () => {
    findJobMock.mockReturnValue(null);

    await expect(runJob()).rejects.toThrow('not found in database');

    expect(loadModelMock).not.toHaveBeenCalled();
    expect(unloadModelMock).not.toHaveBeenCalled();
  });

  it('still unloads the resolved remote endpoint after a normal acquired-model run', async () => {
    await runJob();

    expect(loadModelMock).toHaveBeenCalledWith(
      'judge-model',
      8192,
      REMOTE_JUDGE_URL,
      null
    );
    expect(unloadModelMock).toHaveBeenCalledTimes(1);
    expect(unloadModelMock).toHaveBeenCalledWith(REMOTE_JUDGE_URL);
    expect(unloadModelMock).not.toHaveBeenCalledWith(LOCAL_DEFAULT_URL);
    expect(rowStatus).toBe('completed');
  });

  it('still cleans up the acquired model when canceled during loading', async () => {
    // Task 4 interaction: the load genuinely succeeded, so the acquired
    // remote model must still be released even though the job is canceled.
    let resolveLoad!: () => void;
    loadModelMock.mockImplementationOnce(
      () => new Promise<void>((resolve) => void (resolveLoad = resolve))
    );

    const pending = runJob();
    await tick();
    // API cancels the row while the worker is still awaiting the load.
    rowStatus = 'canceled';
    resolveLoad();
    await pending;

    expect(streamLlmMock).not.toHaveBeenCalled();
    expect(rowStatus).toBe('canceled');
    expect(unloadModelMock).toHaveBeenCalledTimes(1);
    expect(unloadModelMock).toHaveBeenCalledWith(REMOTE_JUDGE_URL);
    expect(unloadModelMock).not.toHaveBeenCalledWith(LOCAL_DEFAULT_URL);
  });

  it('makes no unload calls for default-model jobs that acquire nothing', async () => {
    // A `default` judge reuses whatever is already loaded; the job acquires
    // no model resources of its own, so cleanup must leave the endpoint
    // (and any unrelated chat model on it) untouched.
    findJobMock.mockImplementation(() => ({
      ...baseRecord,
      model_name: 'default',
      llm_base_url: null,
      status: rowStatus,
    }));

    await runJob();

    expect(loadModelMock).not.toHaveBeenCalled();
    expect(unloadModelMock).not.toHaveBeenCalled();
    expect(rowStatus).toBe('completed');
  });
});

describe('allocateJudgeContextBudget', () => {
  it('grants the preferred completion budget when a normal request fits', () => {
    const allocation = allocateJudgeContextBudget({
      contextSize: 32768,
      systemPromptTokens: 800,
      skeletonTokens: 1200,
    });

    expect(allocation.feasible).toBe(true);
    if (!allocation.feasible) return;
    // 30% of 32768 = 9830 beats the 4096 preferred floor.
    expect(allocation.completionTokens).toBe(9830);
    expect(allocation.transcriptTokens).toBeGreaterThan(0);
    // Total estimated prompt plus completion stays within the window.
    expect(
      allocation.overheadTokens +
        allocation.completionTokens +
        allocation.transcriptTokens
    ).toBeLessThanOrEqual(32768);
  });

  it('scales completion down so a 4096-token context still fits', () => {
    const allocation = allocateJudgeContextBudget({
      contextSize: 4096,
      systemPromptTokens: 650,
      skeletonTokens: 300,
    });

    expect(allocation.feasible).toBe(true);
    if (!allocation.feasible) return;
    // The old fixed floors (4096 completion + 512 transcript) overflowed a
    // 4096 window before the system prompt, question, and answer were counted.
    expect(4096 + 512 + 650 + 300 + 512).toBeGreaterThan(4096);
    expect(allocation.completionTokens).toBeLessThan(4096);
    expect(allocation.transcriptTokens).toBeGreaterThanOrEqual(
      JUDGE_MIN_TRANSCRIPT_TOKENS
    );
    expect(
      allocation.overheadTokens +
        allocation.completionTokens +
        allocation.transcriptTokens
    ).toBeLessThanOrEqual(4096);
  });

  it('rejects a large answer that leaves no room in a normal context', () => {
    const allocation = allocateJudgeContextBudget({
      contextSize: 32768,
      systemPromptTokens: 800,
      skeletonTokens: 40000,
    });

    expect(allocation.feasible).toBe(false);
    if (allocation.feasible) return;
    expect(allocation.reason).toContain('context');
  });

  it('treats exactly-minimum remaining capacity as feasible', () => {
    const overhead = 800 + 1200 + JUDGE_CONTEXT_SAFETY_MARGIN_TOKENS;
    const minimum = JUDGE_MIN_COMPLETION_TOKENS + JUDGE_MIN_TRANSCRIPT_TOKENS;

    const fitting = allocateJudgeContextBudget({
      contextSize: overhead + minimum,
      systemPromptTokens: 800,
      skeletonTokens: 1200,
    });
    expect(fitting.feasible).toBe(true);
    if (fitting.feasible) {
      expect(fitting.completionTokens).toBe(JUDGE_MIN_COMPLETION_TOKENS);
      expect(fitting.transcriptTokens).toBe(JUDGE_MIN_TRANSCRIPT_TOKENS);
    }

    const overflowing = allocateJudgeContextBudget({
      contextSize: overhead + minimum - 1,
      systemPromptTokens: 800,
      skeletonTokens: 1200,
    });
    expect(overflowing.feasible).toBe(false);
  });
});

describe('processVerificationJob — context budgeting', () => {
  const paragraphs: TranscriptParagraphData[] = [
    {
      id: 0,
      timestamp: 866,
      text: 'I take Sertraline every morning and I feel better.',
      speaker: 'SPEAKER_00',
    },
  ];

  const baseRecord = {
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
    context_size: 32768,
    thinking_budget: -1,
    temperature: 0.3,
    top_p: null,
    repeat_penalty: null,
    num_gpu_layers: null,
    llm_base_url: null,
  };

  const candidateFor = (id: number, text: string) => ({
    id,
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

  const validVerdict = {
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
  };

  beforeEach(() => {
    vi.resetAllMocks();
    extractVisibleAnswerMock.mockImplementation((text: string) => text);
    // Small texts estimate cheaply; huge answers blow the context budget.
    calculateTokenCountMock.mockImplementation((text: string) =>
      text.length > 5000 ? 40000 : 10
    );
    resolveBudgetStub.mockReturnValue(512);
    findJobMock.mockReturnValue({ ...baseRecord });
    findParagraphsMock.mockReturnValue(paragraphs);
    findTemplateMock.mockReturnValue(null);
    findSessionMock.mockReturnValue({ showSpeakers: 1 });
    updateJobStatusMock.mockReturnValue(true);
    transitionToProcessingMock.mockReturnValue(true);
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

  it('fails the oversized message without a judge call but still audits the fitting one', async () => {
    const hugeAnswer = `word `.repeat(20000).trim();
    findCandidatesMock.mockReturnValue([
      candidateFor(21, hugeAnswer),
      candidateFor(22, 'The client takes Sertraline every morning.'),
    ]);
    streamLlmMock.mockImplementationOnce(() =>
      fakeStream([{ content: '{"summary_assessment": "ok"}' }], {
        promptTokens: 90,
        completionTokens: 40,
      })
    );
    parseJsonMock.mockReturnValue(validVerdict);

    await runJob();

    // Only the fitting message reaches the judge.
    expect(streamLlmMock).toHaveBeenCalledTimes(1);
    expect(saveResultMock).toHaveBeenCalledTimes(2);
    // Oversized message: failed row with a clear explanation, zero tokens.
    expect(saveResultMock.mock.calls[0][0]).toMatchObject({
      messageId: 21,
      status: 'failed',
      promptTokens: 0,
      completionTokens: 0,
    });
    expect(saveResultMock.mock.calls[0][0].errorMessage).toContain('context');
    // Fitting message: normal completed audit.
    expect(saveResultMock.mock.calls[1][0]).toMatchObject({
      messageId: 22,
      accuracyScore: 1,
    });
    expect(saveResultMock.mock.calls[1][0].status ?? 'completed').toBe(
      'completed'
    );
    // The judge request for the fitting message stays within the window:
    // mocked overhead (10 + 10 + margin) + transcript estimate + completion.
    const judgeOptions = streamLlmMock.mock.calls[0][1];
    const transcriptTokens = estimateTokens(
      formatTranscriptForJudge(paragraphs, true)
    );
    expect(
      10 +
        10 +
        JUDGE_CONTEXT_SAFETY_MARGIN_TOKENS +
        transcriptTokens +
        judgeOptions.maxCompletionTokens
    ).toBeLessThanOrEqual(32768);
  });

  it('scales the completion budget down for a 4096-token context', async () => {
    findJobMock.mockReturnValue({ ...baseRecord, context_size: 4096 });
    findCandidatesMock.mockReturnValue([
      candidateFor(11, 'The client takes Sertraline every morning.'),
    ]);
    streamLlmMock.mockImplementationOnce(() =>
      fakeStream([{ content: '{"summary_assessment": "ok"}' }], {
        promptTokens: 90,
        completionTokens: 40,
      })
    );
    parseJsonMock.mockReturnValue(validVerdict);

    await runJob();

    expect(streamLlmMock).toHaveBeenCalledTimes(1);
    const judgeOptions = streamLlmMock.mock.calls[0][1];
    // Overhead is 10 + 10 + 512 = 532, leaving 3564; completion takes that
    // minus the transcript minimum instead of the old blind 4096 floor.
    expect(judgeOptions.maxCompletionTokens).toBe(
      4096 - 532 - JUDGE_MIN_TRANSCRIPT_TOKENS
    );
    expect(judgeOptions.maxCompletionTokens).toBeLessThan(4096);
    const transcriptTokens = estimateTokens(
      formatTranscriptForJudge(paragraphs, true)
    );
    expect(
      10 +
        10 +
        JUDGE_CONTEXT_SAFETY_MARGIN_TOKENS +
        transcriptTokens +
        judgeOptions.maxCompletionTokens
    ).toBeLessThanOrEqual(4096);
    expect(saveResultMock.mock.calls[0][0].status ?? 'completed').toBe(
      'completed'
    );
  });

  it('rejects a job whose context window cannot fit even an empty request', async () => {
    findJobMock.mockReturnValue({ ...baseRecord, context_size: 1024 });

    await expect(runJob()).rejects.toThrow(/context/i);

    expect(findCandidatesMock).not.toHaveBeenCalled();
    expect(loadModelMock).not.toHaveBeenCalled();
    expect(streamLlmMock).not.toHaveBeenCalled();
    expect(saveResultMock).not.toHaveBeenCalled();
    expect(updateJobStatusMock).toHaveBeenCalledWith(
      1,
      'failed',
      expect.objectContaining({
        errorMessage: expect.stringContaining('context'),
      })
    );
  });
});

describe('processVerificationJob — missing transcript', () => {
  const paragraphs: TranscriptParagraphData[] = [
    {
      id: 0,
      timestamp: 866,
      text: 'I take Sertraline every morning and I feel better.',
      speaker: 'SPEAKER_00',
    },
  ];

  const baseRecord = {
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
    context_size: 32768,
    thinking_budget: -1,
    temperature: 0.3,
    top_p: null,
    repeat_penalty: null,
    num_gpu_layers: null,
    llm_base_url: null,
  };

  const candidateFor = (id: number, text: string) => ({
    id,
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

  const validVerdict = {
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
  };

  beforeEach(() => {
    vi.resetAllMocks();
    extractVisibleAnswerMock.mockImplementation((text: string) => text);
    calculateTokenCountMock.mockReturnValue(10);
    resolveBudgetStub.mockReturnValue(512);
    findJobMock.mockReturnValue({ ...baseRecord });
    findTemplateMock.mockReturnValue(null);
    findSessionMock.mockReturnValue({ showSpeakers: 1 });
    updateJobStatusMock.mockReturnValue(true);
    transitionToProcessingMock.mockReturnValue(true);
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

  const messageVerifiedEvents = () =>
    publishEventMock.mock.calls.filter(
      (call) => call[1]?.type === 'message_verified'
    );

  it('fails (never succeeds) a factual answer when the session has no transcript paragraphs', async () => {
    findParagraphsMock.mockReturnValue([]);
    findCandidatesMock.mockReturnValue([
      candidateFor(11, 'The client takes Sertraline every morning.'),
    ]);

    await runJob();

    expect(streamLlmMock).not.toHaveBeenCalled();
    expect(saveResultMock).toHaveBeenCalledTimes(1);
    expect(saveResultMock.mock.calls[0][0]).toMatchObject({
      messageId: 11,
      status: 'failed',
      promptTokens: 0,
      completionTokens: 0,
      durationMs: 0,
    });
    expect(saveResultMock.mock.calls[0][0].errorMessage).toMatch(/transcript/i);
    // No successful-verification event: coverage must not treat it as verified.
    expect(messageVerifiedEvents()).toHaveLength(0);
  });

  it('keeps the completed fast path for empty answers without a transcript', async () => {
    findParagraphsMock.mockReturnValue([]);
    findCandidatesMock.mockReturnValue([candidateFor(12, '   ')]);

    await runJob();

    expect(streamLlmMock).not.toHaveBeenCalled();
    expect(saveResultMock).toHaveBeenCalledTimes(1);
    expect(saveResultMock.mock.calls[0][0]).toMatchObject({
      messageId: 12,
      accuracyScore: 1.0,
    });
    expect(saveResultMock.mock.calls[0][0].status ?? 'completed').toBe(
      'completed'
    );
  });

  it('keeps the completed fast path for trivial greetings without a transcript', async () => {
    findParagraphsMock.mockReturnValue([]);
    findCandidatesMock.mockReturnValue([
      candidateFor(13, 'Hello! How can I help you today?'),
    ]);

    await runJob();

    expect(streamLlmMock).not.toHaveBeenCalled();
    expect(saveResultMock).toHaveBeenCalledTimes(1);
    expect(saveResultMock.mock.calls[0][0]).toMatchObject({
      messageId: 13,
      accuracyScore: 1.0,
    });
    expect(saveResultMock.mock.calls[0][0].status ?? 'completed').toBe(
      'completed'
    );
  });

  it('audits the same message normally once transcript paragraphs exist', async () => {
    const candidate = candidateFor(
      11,
      'The client takes Sertraline every morning.'
    );
    // First audit: no ground truth → failed, never completed.
    findParagraphsMock.mockReturnValue([]);
    findCandidatesMock.mockReturnValue([candidate]);
    await runJob();
    expect(saveResultMock.mock.calls[0][0]).toMatchObject({
      messageId: 11,
      status: 'failed',
    });

    // Transcript repaired: the retry reaches the judge and completes.
    saveResultMock.mockClear();
    streamLlmMock.mockClear();
    findParagraphsMock.mockReturnValue(paragraphs);
    streamLlmMock.mockImplementationOnce(() =>
      fakeStream([{ content: '{"summary_assessment": "ok"}' }], {
        promptTokens: 90,
        completionTokens: 40,
      })
    );
    parseJsonMock.mockReturnValue(validVerdict);
    await runJob();

    expect(streamLlmMock).toHaveBeenCalledTimes(1);
    expect(saveResultMock).toHaveBeenCalledTimes(1);
    expect(saveResultMock.mock.calls[0][0]).toMatchObject({
      messageId: 11,
      accuracyScore: 1,
    });
    expect(saveResultMock.mock.calls[0][0].status ?? 'completed').toBe(
      'completed'
    );
  });
});

describe('verification failure diagnostics (pure builders)', () => {
  it('labels every failure category', () => {
    expect(verificationFailureLabel('empty_output')).toBe(
      'Judge returned no output'
    );
    expect(verificationFailureLabel('malformed_json')).toBe(
      'Judge returned invalid JSON'
    );
    expect(verificationFailureLabel('invalid_structure')).toBe(
      'Judge JSON failed schema validation'
    );
    expect(verificationFailureLabel('provider_error')).toBe(
      'Judge provider request failed'
    );
    expect(verificationFailureLabel('context_budget')).toBe(
      'Judge context window too small'
    );
    expect(verificationFailureLabel('missing_transcript')).toBe(
      'Session transcript unavailable'
    );
  });

  it('builds a per-message record with job/message IDs, model, phase, attempt, duration, and usage', () => {
    const message = buildMessageFailureMessage({
      code: 'malformed_json',
      jobId: 2,
      messageId: 1914,
      judgeModel: 'judge-model',
      phase: 'retrying',
      attempt: 2,
      attemptsTotal: 2,
      durationMs: 1500,
      promptTokens: 500,
      completionTokens: 120,
      detail: 'Unparseable output.',
    });
    expect(message).toContain('[malformed_json]');
    expect(message).toContain('message 1914');
    expect(message).toContain('job 2');
    expect(message).toContain('judge "judge-model"');
    expect(message).toContain('retrying');
    expect(message).toContain('attempt 2 of 2');
    expect(message).toContain('1.5s');
    expect(message).toContain('500+120 tokens');
    expect(message).toContain('Unparseable output.');
  });

  it('bounds detail so transcripts and reasoning can never leak into errors', () => {
    const leak = `TRANSCRIPT: ${'session text '.repeat(200)}`;
    const message = buildMessageFailureMessage({
      code: 'provider_error',
      jobId: 1,
      messageId: 11,
      judgeModel: 'judge-model',
      phase: 'generating',
      attempt: 1,
      attemptsTotal: 2,
      durationMs: 100,
      promptTokens: 0,
      completionTokens: 0,
      detail: leak,
    });
    expect(message.length).toBeLessThanOrEqual(300 + 300);
    // The full 2600-char "transcript" never survives: only a bounded head.
    expect(message).not.toContain(leak);
    expect(message).toContain('TRANSCRIPT: session text');
    expect(truncateVerificationDetail('a\nb\tc')).toBe('a b c');
  });

  it('builds distinct all-failed and mixed-outcome job summaries', () => {
    const allFailed = buildJobFailureSummary({
      jobId: 2,
      judgeModel: 'judge-model',
      succeeded: 0,
      failed: 3,
      total: 3,
      firstFailureCode: 'empty_output',
      firstFailureDetail: 'No visible output.',
    });
    expect(allFailed).toMatch(/^All 3 attempted assessments failed/);
    expect(allFailed).toContain('job 2');
    expect(allFailed).toContain('[empty_output]');

    const mixed = buildJobFailureSummary({
      jobId: 2,
      judgeModel: 'judge-model',
      succeeded: 2,
      failed: 1,
      total: 3,
      firstFailureCode: 'malformed_json',
      firstFailureDetail: 'Bad JSON.',
    });
    expect(mixed).toMatch(/^Completed with errors: 2 of 3 checked, 1 failed/);
    expect(mixed).toContain('[malformed_json]');
    expect(mixed.length).toBeLessThanOrEqual(600);
  });

  it('reads failure codes only from coded errors', () => {
    expect(
      readVerificationFailureCode(
        new CodedVerificationError('empty_output', 'x')
      )
    ).toBe('empty_output');
    expect(readVerificationFailureCode(new Error('socket hang up'))).toBeNull();
    expect(readVerificationFailureCode({ code: 'bogus' })).toBeNull();
    expect(readVerificationFailureCode(null)).toBeNull();
  });

  it('describes each worker phase, distinguishing the retry attempt', () => {
    expect(describeVerificationPhase({ phase: 'waiting_for_lock' })).toMatch(
      /lock/
    );
    expect(describeVerificationPhase({ phase: 'loading_judge' })).toMatch(
      /Judge/
    );
    expect(
      describeVerificationPhase({
        phase: 'checking_message',
        messageIndex: 2,
        totalMessages: 5,
      })
    ).toBe('Checking message 2 of 5…');
    expect(
      describeVerificationPhase({ phase: 'generating', messageId: 11 })
    ).toContain('attempt 1');
    expect(
      describeVerificationPhase({
        phase: 'retrying',
        messageId: 11,
        attempt: 2,
      })
    ).toContain('thinking disabled');
    expect(describeVerificationPhase({ phase: 'finishing' })).toMatch(
      /Finishing/
    );
  });
});

describe('processVerificationJob — progress phases and outcome semantics', () => {
  const paragraphs: TranscriptParagraphData[] = [
    {
      id: 0,
      timestamp: 866,
      text: 'I take Sertraline every morning and I feel better.',
      speaker: 'SPEAKER_00',
    },
  ];

  const baseRecord = {
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
    context_size: 32768,
    thinking_budget: -1,
    temperature: 0.3,
    top_p: null,
    repeat_penalty: null,
    num_gpu_layers: null,
    llm_base_url: null,
  };

  const candidateFor = (id: number, text: string) => ({
    id,
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

  const validVerdict = {
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
  };

  beforeEach(() => {
    vi.resetAllMocks();
    extractVisibleAnswerMock.mockImplementation((text: string) => text);
    calculateTokenCountMock.mockReturnValue(10);
    resolveBudgetStub.mockReturnValue(512);
    findJobMock.mockReturnValue({ ...baseRecord });
    findParagraphsMock.mockReturnValue(paragraphs);
    findTemplateMock.mockReturnValue(null);
    findSessionMock.mockReturnValue({ showSpeakers: 1 });
    updateJobStatusMock.mockReturnValue(true);
    updateJobPhaseMock.mockReturnValue(true);
    clearJobPhaseMock.mockReturnValue(true);
    incrementJobCountersMock.mockReturnValue(true);
    transitionToProcessingMock.mockReturnValue(true);
    saveResultMock.mockReturnValue({});
    streamWithRetryMock.mockImplementation(async function* (factory: any) {
      return yield* factory();
    });
  });

  const runJob = () =>
    processVerificationJob({
      data: { jobId: 1 },
      updateProgress: vi.fn(),
    } as any);

  const phaseEvents = () =>
    publishEventMock.mock.calls
      .filter((call) => call[1]?.type === 'phase')
      .map((call) => call[1]);
  const terminalEvents = () =>
    publishEventMock.mock.calls
      .filter((call) => ['complete', 'error'].includes(call[1]?.type as string))
      .map((call) => call[1]);
  const terminalStatusCall = () =>
    updateJobStatusMock.mock.calls.find((call) =>
      ['completed', 'failed', 'canceled'].includes(call[1] as string)
    );

  it('publishes checking/generating phases before the processed count increments on a slow successful run', async () => {
    findCandidatesMock.mockReturnValue([
      candidateFor(11, 'The client takes Sertraline every morning.'),
    ]);
    streamLlmMock.mockImplementationOnce(() =>
      fakeStream([{ content: '{"summary_assessment": "ok"}' }], {
        promptTokens: 90,
        completionTokens: 40,
      })
    );
    parseJsonMock.mockReturnValue(validVerdict);

    await runJob();

    const phases = phaseEvents();
    // checking_message (setup) then generating (attempt 1), both while
    // processed is still 0; finishing closes the run.
    expect(phases.map((e) => e.phase)).toEqual([
      'checking_message',
      'generating',
      'finishing',
    ]);
    expect(phases[0]).toMatchObject({
      messageId: 11,
      messageIndex: 1,
      attempt: 1,
      processedMessages: 0,
      totalMessages: 1,
    });
    expect(phases[1]).toMatchObject({
      messageId: 11,
      messageIndex: 1,
      attempt: 1,
      processedMessages: 0,
    });
    expect(typeof phases[1].elapsedMs).toBe('number');
    // The durable snapshot mirrors the transient events for reloads.
    expect(updateJobPhaseMock).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        currentPhase: 'generating',
        currentMessageId: 11,
        currentAttempt: 1,
      })
    );
    // Accurate final result: clean completed with a 1/0 split.
    expect(terminalStatusCall()).toEqual([
      1,
      'completed',
      expect.objectContaining({
        succeededMessages: 1,
        failedMessages: 0,
        skippedMessages: 0,
      }),
    ]);
    expect(terminalEvents()[0]).toMatchObject({
      type: 'complete',
      status: 'completed',
      succeededMessages: 1,
      failedMessages: 0,
    });
    expect(clearJobPhaseMock).toHaveBeenCalledWith(1);
  });

  it('publishes a distinct retrying phase with attempt 2 on the JSON-repair retry', async () => {
    findCandidatesMock.mockReturnValue([
      candidateFor(11, 'The client takes Sertraline every morning.'),
    ]);
    streamLlmMock
      .mockImplementationOnce(() =>
        fakeStream([{ content: 'not json at all' }], {
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
    parseJsonMock.mockReturnValueOnce(null).mockReturnValueOnce(validVerdict);

    await runJob();

    expect(phaseEvents().map((e) => e.phase)).toEqual([
      'checking_message',
      'generating',
      'retrying',
      'finishing',
    ]);
    const retry = phaseEvents().find((e) => e.phase === 'retrying');
    expect(retry).toMatchObject({ attempt: 2, messageId: 11 });
    expect(retry.message).toContain('thinking disabled');
    expect(updateJobPhaseMock).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        currentPhase: 'retrying',
        currentAttempt: 2,
      })
    );
  });

  it('marks an all-failed run failed with a persisted error summary and counts', async () => {
    findCandidatesMock.mockReturnValue([
      candidateFor(11, 'The client takes Sertraline every morning.'),
    ]);
    // Both attempts return blank output: empty_output after retry.
    streamLlmMock.mockImplementation(() =>
      fakeStream([{ content: '   ' }], {
        promptTokens: 100,
        completionTokens: 5,
      })
    );
    parseJsonMock.mockReturnValue(null);

    await runJob();

    expect(saveResultMock.mock.calls[0][0]).toMatchObject({
      messageId: 11,
      status: 'failed',
      errorCode: 'empty_output',
    });
    expect(saveResultMock.mock.calls[0][0].errorMessage).toContain(
      '[empty_output]'
    );
    expect(terminalStatusCall()).toEqual([
      1,
      'failed',
      expect.objectContaining({
        succeededMessages: 0,
        failedMessages: 1,
        skippedMessages: 0,
        errorMessage: expect.stringMatching(
          /^All 1 attempted assessment failed/
        ),
      }),
    ]);
    const terminal = terminalEvents()[0];
    expect(terminal).toMatchObject({
      type: 'error',
      status: 'failed',
      succeededMessages: 0,
      failedMessages: 1,
    });
    expect(terminal.message).toMatch(/^All 1 attempted assessment failed/);
  });

  it('reports a mixed run as completed with errors while retaining successful assessments', async () => {
    findCandidatesMock.mockReturnValue([
      candidateFor(11, 'The client takes Sertraline every morning.'),
      candidateFor(12, 'The client feels better after journaling.'),
    ]);
    // Message 11 succeeds; message 12 fails structurally on both attempts.
    streamLlmMock
      .mockImplementationOnce(() =>
        fakeStream([{ content: '{"summary_assessment": "ok"}' }], {
          promptTokens: 90,
          completionTokens: 40,
        })
      )
      .mockImplementation(() =>
        fakeStream([{ content: '{"error": "nope"}' }], {
          promptTokens: 100,
          completionTokens: 10,
        })
      );
    parseJsonMock
      .mockReturnValueOnce(validVerdict)
      .mockReturnValue({ error: 'unable to assess' });

    await runJob();

    expect(saveResultMock).toHaveBeenCalledTimes(2);
    expect(saveResultMock.mock.calls[0][0].status ?? 'completed').toBe(
      'completed'
    );
    expect(saveResultMock.mock.calls[1][0]).toMatchObject({
      messageId: 12,
      status: 'failed',
      errorCode: 'invalid_structure',
    });
    // Mixed: completed status but an explicit error summary + split counts,
    // never unqualified success.
    expect(terminalStatusCall()).toEqual([
      1,
      'completed',
      expect.objectContaining({
        succeededMessages: 1,
        failedMessages: 1,
        skippedMessages: 0,
        errorMessage: expect.stringMatching(
          /^Completed with errors: 1 of 2 checked, 1 failed/
        ),
      }),
    ]);
    expect(terminalEvents()[0]).toMatchObject({
      type: 'complete',
      status: 'completed',
      succeededMessages: 1,
      failedMessages: 1,
    });
  });

  it('distinguishes malformed JSON from empty output and records usage on failed attempts', async () => {
    findCandidatesMock.mockReturnValue([
      candidateFor(11, 'The client takes Sertraline every morning.'),
    ]);
    streamLlmMock.mockImplementation(() =>
      fakeStream([{ content: 'not json at all {{{' }], {
        promptTokens: 100,
        completionTokens: 25,
      })
    );
    parseJsonMock.mockReturnValue(null);

    await runJob();

    expect(streamLlmMock).toHaveBeenCalledTimes(2);
    expect(insertUsageMock).toHaveBeenCalledTimes(2);
    expect(saveResultMock.mock.calls[0][0]).toMatchObject({
      status: 'failed',
      errorCode: 'malformed_json',
      promptTokens: 200,
      completionTokens: 50,
    });
    expect(saveResultMock.mock.calls[0][0].errorMessage).toContain(
      'Retries exhausted'
    );
  });

  it('records provider_error with bounded detail when the Judge stream throws', async () => {
    findCandidatesMock.mockReturnValue([
      candidateFor(11, 'The client takes Sertraline every morning.'),
    ]);
    // Synchronous throw inside the factory: the transparent streamWithRetry
    // rethrows it out of `next()`, like a transport failure would.
    streamLlmMock.mockImplementation(() => {
      throw new Error('socket hang up');
    });

    await runJob();

    expect(saveResultMock.mock.calls[0][0]).toMatchObject({
      status: 'failed',
      errorCode: 'provider_error',
    });
    expect(saveResultMock.mock.calls[0][0].errorMessage).toContain(
      'socket hang up'
    );
    // Provider failure on the only candidate: the run itself fails.
    expect(terminalStatusCall()?.[1]).toBe('failed');
  });

  it('counts trivial and empty fast paths as succeeded and context-budget failures as failed', async () => {
    findCandidatesMock.mockReturnValue([
      candidateFor(11, 'Hello! How can I help you today?'),
      candidateFor(12, '   '),
      candidateFor(13, 'The client discussed xylophone practice routines.'),
    ]);
    // The job-level allocation (empty question/answer skeleton) stays
    // feasible, but the third candidate's full skeleton overflows: token
    // counting explodes only for text containing the long answer.
    calculateTokenCountMock.mockImplementation((text: string) =>
      text.includes('xylophone') ? 40000 : 10
    );

    await runJob();

    expect(streamLlmMock).not.toHaveBeenCalled();
    expect(saveResultMock).toHaveBeenCalledTimes(3);
    expect(saveResultMock.mock.calls[2][0]).toMatchObject({
      messageId: 13,
      status: 'failed',
      errorCode: 'context_budget',
    });
    expect(terminalStatusCall()).toEqual([
      1,
      'completed',
      expect.objectContaining({
        succeededMessages: 2,
        failedMessages: 1,
        skippedMessages: 0,
      }),
    ]);
  });

  it('counts missing-transcript failures distinctly from successes', async () => {
    findParagraphsMock.mockReturnValue([]);
    findCandidatesMock.mockReturnValue([
      candidateFor(11, 'The client takes Sertraline every morning.'),
      candidateFor(12, 'Hello! How can I help you today?'),
    ]);

    await runJob();

    expect(saveResultMock.mock.calls[0][0]).toMatchObject({
      status: 'failed',
      errorCode: 'missing_transcript',
    });
    expect(terminalStatusCall()).toEqual([
      1,
      'completed',
      expect.objectContaining({ succeededMessages: 1, failedMessages: 1 }),
    ]);
  });

  it('completes a zero-candidate run cleanly without an error summary', async () => {
    findCandidatesMock.mockReturnValue([]);

    await runJob();

    expect(terminalStatusCall()).toEqual([
      1,
      'completed',
      expect.objectContaining({
        succeededMessages: 0,
        failedMessages: 0,
        skippedMessages: 0,
      }),
    ]);
    // No errorMessage field: zero candidates is a clean no-op, not a failure.
    expect(terminalStatusCall()?.[2]).not.toHaveProperty('errorMessage');
    expect(terminalEvents()[0]).toMatchObject({
      type: 'complete',
      status: 'completed',
      totalMessages: 0,
    });
  });

  it('persists skipped counts for unattempted candidates on cancellation', async () => {
    findCandidatesMock.mockReturnValue([
      candidateFor(11, 'The client takes Sertraline every morning.'),
      candidateFor(12, 'The client feels better after journaling.'),
      candidateFor(13, 'Hello! How can I help you today?'),
    ]);
    streamLlmMock.mockImplementation(() =>
      fakeStream([{ content: '{"summary_assessment": "ok"}' }], {
        promptTokens: 90,
        completionTokens: 40,
      })
    );
    parseJsonMock.mockReturnValue(validVerdict);
    // Cancel lands after the first message completes: flip the row on the
    // sixth status read (initial + post-load + iter1 check + post-stream
    // check + progress read, then the iter2 cancel check observes it).
    let statusReads = 0;
    findJobMock.mockImplementation(() => {
      statusReads++;
      return {
        ...baseRecord,
        status: statusReads >= 6 ? 'canceled' : 'processing',
      };
    });

    await runJob();

    expect(saveResultMock).toHaveBeenCalledTimes(1);
    expect(terminalStatusCall()).toEqual([
      1,
      'canceled',
      expect.objectContaining({
        succeededMessages: 1,
        failedMessages: 0,
        skippedMessages: 2,
      }),
    ]);
    expect(clearJobPhaseMock).toHaveBeenCalledWith(1);
  });

  it('continues past failure-persistence errors and keeps terminal counts accurate', async () => {
    findCandidatesMock.mockReturnValue([
      candidateFor(11, 'The client takes Sertraline every morning.'),
      candidateFor(12, 'The client feels better after journaling.'),
    ]);
    streamLlmMock.mockImplementation(() =>
      fakeStream([{ content: '   ' }], {
        promptTokens: 100,
        completionTokens: 5,
      })
    );
    parseJsonMock.mockReturnValue(null);
    // The first failed-row save throws (DB outage); the second succeeds.
    saveResultMock
      .mockImplementationOnce(() => {
        throw new Error('database is locked');
      })
      .mockImplementation(() => ({}));

    await runJob();

    // Both attempts still ran; the run fails with accurate counts even
    // though one failure row never persisted.
    expect(streamLlmMock).toHaveBeenCalledTimes(4);
    expect(terminalStatusCall()).toEqual([
      1,
      'failed',
      expect.objectContaining({ succeededMessages: 0, failedMessages: 2 }),
    ]);
    // The unpersisted attempt repaired `processed_messages` manually.
    expect(incrementJobCountersMock).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ processedMessages: 1, failedMessages: 1 })
    );
  });

  it('unloads the Judge model on all-failed, mixed, and canceled terminal paths', async () => {
    findJobMock.mockReturnValue({ ...baseRecord, model_name: 'judge-model' });
    loadModelMock.mockResolvedValue(undefined);
    unloadModelMock.mockResolvedValue(1);

    // All-failed run.
    findCandidatesMock.mockReturnValue([
      candidateFor(11, 'The client takes Sertraline every morning.'),
    ]);
    streamLlmMock.mockImplementation(() =>
      fakeStream([{ content: '   ' }], {
        promptTokens: 100,
        completionTokens: 5,
      })
    );
    parseJsonMock.mockReturnValue(null);
    await runJob();
    expect(terminalStatusCall()?.[1]).toBe('failed');
    expect(unloadModelMock).toHaveBeenCalledTimes(1);

    // Mixed run.
    vi.resetAllMocks();
    extractVisibleAnswerMock.mockImplementation((text: string) => text);
    calculateTokenCountMock.mockReturnValue(10);
    resolveBudgetStub.mockReturnValue(512);
    findJobMock.mockReturnValue({ ...baseRecord, model_name: 'judge-model' });
    findParagraphsMock.mockReturnValue(paragraphs);
    findTemplateMock.mockReturnValue(null);
    findSessionMock.mockReturnValue({ showSpeakers: 1 });
    updateJobStatusMock.mockReturnValue(true);
    transitionToProcessingMock.mockReturnValue(true);
    saveResultMock.mockReturnValue({});
    streamWithRetryMock.mockImplementation(async function* (factory: any) {
      return yield* factory();
    });
    loadModelMock.mockResolvedValue(undefined);
    unloadModelMock.mockResolvedValue(1);
    findCandidatesMock.mockReturnValue([
      candidateFor(11, 'The client takes Sertraline every morning.'),
      candidateFor(12, 'Hello! How can I help you today?'),
    ]);
    streamLlmMock.mockImplementation(() =>
      fakeStream([{ content: '   ' }], {
        promptTokens: 100,
        completionTokens: 5,
      })
    );
    parseJsonMock.mockReturnValue(null);
    await runJob();
    expect(terminalStatusCall()?.[1]).toBe('completed');
    expect(unloadModelMock).toHaveBeenCalledTimes(1);
  });
});

describe('processVerificationJob — live token-speed telemetry', () => {
  const paragraphs: TranscriptParagraphData[] = [
    {
      id: 0,
      timestamp: 866,
      text: 'I take Sertraline every morning and I feel better.',
      speaker: 'SPEAKER_00',
    },
  ];

  const baseRecord = {
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
    context_size: 32768,
    thinking_budget: -1,
    temperature: 0.3,
    top_p: null,
    repeat_penalty: null,
    num_gpu_layers: null,
    llm_base_url: null,
  };

  const validVerdict = {
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
  };

  // Controllable clock: the Judge stream advances `now` per chunk so tick
  // timing is deterministic without fake timers.
  let now = 1_000_000;

  async function* timedStream(
    texts: string[],
    stepMs: number
  ): AsyncGenerator<{ content?: string; thinking?: string }, unknown> {
    for (const text of texts) {
      now += stepMs;
      yield { content: text };
    }
    return { promptTokens: 90, completionTokens: 40 };
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
    now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    extractVisibleAnswerMock.mockImplementation((text: string) => text);
    calculateTokenCountMock.mockReturnValue(10);
    resolveBudgetStub.mockReturnValue(512);
    findJobMock.mockReturnValue({ ...baseRecord });
    findCandidatesMock.mockReturnValue([
      {
        id: 11,
        chatId: 5,
        sessionId: 2,
        sender: 'ai',
        text: 'The client takes Sertraline every morning.',
        timestamp: Date.now(),
        model: 'author-model',
        userQuestion: 'What did the client say?',
      },
    ]);
    findParagraphsMock.mockReturnValue(paragraphs);
    findTemplateMock.mockReturnValue(null);
    findSessionMock.mockReturnValue({ showSpeakers: 1 });
    updateJobStatusMock.mockReturnValue(true);
    updateJobPhaseMock.mockReturnValue(true);
    clearJobPhaseMock.mockReturnValue(true);
    incrementJobCountersMock.mockReturnValue(true);
    transitionToProcessingMock.mockReturnValue(true);
    saveResultMock.mockReturnValue({});
    parseJsonMock.mockReturnValue(validVerdict);
    streamWithRetryMock.mockImplementation(async function* (factory: any) {
      return yield* factory();
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const runJob = () =>
    processVerificationJob({
      data: { jobId: 1 },
      updateProgress: vi.fn(),
    } as any);

  const phaseEvents = () =>
    publishEventMock.mock.calls
      .filter((call) => call[1]?.type === 'phase')
      .map((call) => call[1]);

  it('publishes throttled generating ticks with live tokens/s and no per-tick SQLite writes', async () => {
    // 4 chunks x 40 chars = 10 estimated tokens each, one tick-eligible
    // step apart: ticks fire on chunks 2-4 with cumulative counts.
    const stepMs = VERIFICATION_TOKEN_TELEMETRY_THROTTLE_MS + 100;
    streamLlmMock.mockImplementation(() =>
      timedStream(
        ['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40), 'd'.repeat(40)],
        stepMs
      )
    );

    await runJob();

    const generating = phaseEvents().filter((e) => e.phase === 'generating');
    // Transition publish (null speed) + 3 throttled ticks.
    expect(generating).toHaveLength(4);
    expect(generating[0]).toMatchObject({
      tokensPerSecond: null,
      generatedTokens: null,
    });
    const ticks = generating.slice(1);
    expect(ticks.map((e) => e.generatedTokens)).toEqual([20, 30, 40]);
    // tokens/s = cumulative tokens / elapsed seconds since the first
    // token, rounded to 1 decimal.
    const elapsed = [stepMs, 2 * stepMs, 3 * stepMs].map((ms) => ms / 1000);
    const expectedTps = [20 / elapsed[0], 30 / elapsed[1], 40 / elapsed[2]].map(
      (tps) => Math.round(tps * 10) / 10
    );
    expect(ticks.map((e) => e.tokensPerSecond)).toEqual(expectedTps);
    for (const tick of ticks) {
      expect(tick).toMatchObject({
        type: 'phase',
        messageId: 11,
        chatId: 5,
        sessionId: 2,
        messageIndex: 1,
        attempt: 1,
        totalMessages: 1,
        processedMessages: 0,
        message: 'Generating assessment for message 11 (attempt 1)…',
      });
      expect(typeof tick.elapsedMs).toBe('number');
    }
    // Ticks are Redis-only: SQLite sees just the phase transitions.
    expect(
      updateJobPhaseMock.mock.calls.map((call) => call[1].currentPhase)
    ).toEqual(['checking_message', 'generating', 'finishing']);
  });

  it('coalesces sub-throttle chunks into fewer ticks', async () => {
    // 6 chunks 100ms apart: only ~every third chunk passes the throttle.
    streamLlmMock.mockImplementation(() =>
      timedStream(
        Array.from({ length: 6 }, (_, i) => `${i}`.repeat(40)),
        100
      )
    );

    await runJob();

    const ticks = phaseEvents().filter(
      (e) => e.phase === 'generating' && e.tokensPerSecond != null
    );
    expect(ticks.length).toBeLessThan(6);
    expect(ticks.length).toBeGreaterThan(0);
    // Cumulative counts stay monotonic across coalesced ticks.
    const counts = ticks.map((e) => e.generatedTokens as number);
    expect([...counts].sort((a, b) => a - b)).toEqual(counts);
    expect(
      updateJobPhaseMock.mock.calls.map((call) => call[1].currentPhase)
    ).toEqual(['checking_message', 'generating', 'finishing']);
  });

  it('resets tokens/s to null once generation ends', async () => {
    const stepMs = VERIFICATION_TOKEN_TELEMETRY_THROTTLE_MS + 100;
    streamLlmMock.mockImplementation(() =>
      timedStream(['a'.repeat(40), 'b'.repeat(40)], stepMs)
    );

    await runJob();

    // At least one live tick fired, then every post-generation event
    // cleared the speed explicitly.
    expect(
      phaseEvents().some(
        (e) => e.phase === 'generating' && e.tokensPerSecond != null
      )
    ).toBe(true);
    const finishing = phaseEvents().find((e) => e.phase === 'finishing');
    expect(finishing).toMatchObject({
      tokensPerSecond: null,
      generatedTokens: null,
    });
    const verified = publishEventMock.mock.calls
      .map((call) => call[1])
      .find((e) => e?.type === 'message_verified');
    expect(verified).toMatchObject({
      tokensPerSecond: null,
      generatedTokens: null,
    });
    const terminal = publishEventMock.mock.calls
      .map((call) => call[1])
      .find((e) => e?.type === 'complete');
    expect(terminal).toMatchObject({
      tokensPerSecond: null,
      generatedTokens: null,
    });
  });
});
