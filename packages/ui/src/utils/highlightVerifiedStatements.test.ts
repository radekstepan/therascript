// packages/ui/src/utils/highlightVerifiedStatements.test.ts
import { describe, it, expect } from 'vitest';
import type { Element, Root, Text } from 'hast';
import {
  splitTextByStatementSpans,
  resolveStatementSpans,
  rehypeHighlightStatements,
  parseStatementEvidence,
  formatEvidenceTimestamp,
  getVerdictMarkStyle,
  type HighlightableStatement,
} from './highlightVerifiedStatements';

const stmt = (
  overrides: Partial<HighlightableStatement> & { id: number }
): HighlightableStatement => ({
  exact_quote: '',
  start_char: null,
  end_char: null,
  verdict: 'fabricated',
  ...overrides,
});

const textNode = (value: string): Text => ({ type: 'text', value });

describe('resolveStatementSpans', () => {
  it('trusts worker spans when the slice matches the quote', () => {
    const text = 'The client takes aspirin daily.';
    const spans = resolveStatementSpans(text, [
      stmt({
        id: 1,
        exact_quote: 'takes aspirin',
        start_char: 11,
        end_char: 24,
      }),
    ]);
    expect(spans).toEqual([
      { statementId: 1, start: 11, end: 24, verdict: 'fabricated' },
    ]);
  });

  it('falls back to a quote search when the worker span is stale', () => {
    const text = 'Intro. The client takes aspirin daily.';
    const spans = resolveStatementSpans(text, [
      stmt({
        id: 1,
        exact_quote: 'takes aspirin',
        start_char: 0, // stale: points at "Intro. The c"
        end_char: 13,
      }),
    ]);
    expect(spans).toHaveLength(1);
    expect(text.slice(spans[0]!.start, spans[0]!.end)).toBe('takes aspirin');
  });

  it('locates quotes with null spans and skips overlapping duplicates', () => {
    const text = 'aspirin helps. aspirin helps.';
    const spans = resolveStatementSpans(text, [
      stmt({ id: 1, exact_quote: 'aspirin helps' }),
      stmt({ id: 2, exact_quote: 'aspirin helps' }),
      stmt({ id: 3, exact_quote: 'aspirin helps' }),
    ]);
    expect(spans.map((s) => s.statementId).sort()).toEqual([1, 2]);
    expect(spans[0]).toMatchObject({ start: 0, end: 13 });
    expect(spans[1]).toMatchObject({ start: 15, end: 28 });
  });

  it('matches across whitespace differences', () => {
    const text = 'The client\ntakes   aspirin daily.';
    const spans = resolveStatementSpans(text, [
      stmt({ id: 1, exact_quote: 'client takes aspirin' }),
    ]);
    expect(spans).toHaveLength(1);
    expect(text.slice(spans[0]!.start, spans[0]!.end)).toBe(
      'client\ntakes   aspirin'
    );
  });

  it('returns no spans for missing or empty quotes', () => {
    expect(
      resolveStatementSpans('hello world', [stmt({ id: 1, exact_quote: '' })])
    ).toEqual([]);
    expect(
      resolveStatementSpans('hello world', [
        stmt({ id: 1, exact_quote: 'not present' }),
      ])
    ).toEqual([]);
  });
});

describe('splitTextByStatementSpans', () => {
  it('splits text into plain and highlighted segments', () => {
    const text = 'Alpha beta gamma.';
    const segments = splitTextByStatementSpans(text, [
      stmt({ id: 7, exact_quote: 'beta', verdict: 'contradicted' }),
    ]);
    expect(segments).toEqual([
      { text: 'Alpha ', statementId: null, verdict: null },
      { text: 'beta', statementId: 7, verdict: 'contradicted' },
      { text: ' gamma.', statementId: null, verdict: null },
    ]);
  });

  it('returns a single plain segment when nothing matches', () => {
    expect(splitTextByStatementSpans('hello', [])).toEqual([
      { text: 'hello', statementId: null, verdict: null },
    ]);
  });
});

describe('rehypeHighlightStatements', () => {
  const paragraph = (...children: Array<Text | Element>): Element => ({
    type: 'element',
    tagName: 'p',
    properties: {},
    children,
  });

  it('wraps matching text in a mark with the statement id', () => {
    const tree: Root = {
      type: 'root',
      children: [paragraph(textNode('The client takes aspirin daily.'))],
    };
    rehypeHighlightStatements([stmt({ id: 3, exact_quote: 'takes aspirin' })])(
      tree
    );
    const p = tree.children[0] as Element;
    expect(p.children).toHaveLength(3);
    const mark = p.children[1] as Element;
    expect(mark.tagName).toBe('mark');
    expect(mark.properties).toMatchObject({
      dataStatementId: '3',
      className: ['verified-statement-mark'],
    });
    expect((mark.children[0] as Text).value).toBe('takes aspirin');
  });

  it('matches quotes spanning inline tags', () => {
    const tree: Root = {
      type: 'root',
      children: [
        paragraph(
          textNode('The client '),
          {
            type: 'element',
            tagName: 'strong',
            properties: {},
            children: [textNode('takes aspirin')],
          },
          textNode(' daily.')
        ),
      ],
    };
    rehypeHighlightStatements([
      stmt({ id: 5, exact_quote: 'client takes aspirin' }),
    ])(tree);
    const p = tree.children[0] as Element;
    // First text node split: "The " + mark("client "), then <strong>, then " daily."
    expect(p.children).toHaveLength(4);
    const firstMark = p.children[1] as Element;
    expect(firstMark.tagName).toBe('mark');
    expect((firstMark.children[0] as Text).value).toBe('client ');
    // Strong child fully wrapped in a mark.
    const strong = p.children[2] as Element;
    expect(strong.tagName).toBe('strong');
    const innerMark = strong.children[0] as Element;
    expect(innerMark.tagName).toBe('mark');
    expect(innerMark.properties).toMatchObject({ dataStatementId: '5' });
    expect((innerMark.children[0] as Text).value).toBe('takes aspirin');
  });

  it('does not match across block boundaries', () => {
    const tree: Root = {
      type: 'root',
      children: [
        paragraph(textNode('end of first')),
        paragraph(textNode('start of second')),
      ],
    };
    rehypeHighlightStatements([stmt({ id: 1, exact_quote: 'first start' })])(
      tree
    );
    for (const block of tree.children as Element[]) {
      expect((block.children[0] as Text).value).not.toContain('mark');
      expect(block.children).toHaveLength(1);
      expect((block.children[0] as Element).tagName).toBeUndefined();
    }
  });

  it('is a no-op without statements', () => {
    const tree: Root = {
      type: 'root',
      children: [paragraph(textNode('hello'))],
    };
    rehypeHighlightStatements([])(tree);
    expect((tree.children[0] as Element).children).toHaveLength(1);
  });
});

describe('parseStatementEvidence', () => {
  it('prefers the parsed evidence array', () => {
    const evidence = [
      {
        paragraphIndex: 1,
        timestampMs: 1000,
        speaker: 'SPEAKER_00',
        quote: 'q',
      },
    ];
    expect(
      parseStatementEvidence({ evidence, transcript_evidence_json: null })
    ).toBe(evidence);
  });

  it('parses the raw JSON string and tolerates garbage', () => {
    expect(
      parseStatementEvidence({
        evidence: undefined,
        transcript_evidence_json: JSON.stringify([
          {
            paragraphIndex: null,
            timestampMs: null,
            speaker: null,
            quote: 'q',
          },
        ]),
      })
    ).toHaveLength(1);
    expect(
      parseStatementEvidence({
        evidence: undefined,
        transcript_evidence_json: 'not-json{{{',
      })
    ).toEqual([]);
    expect(
      parseStatementEvidence({
        evidence: undefined,
        transcript_evidence_json: null,
      })
    ).toEqual([]);
  });
});

describe('formatEvidenceTimestamp', () => {
  it('formats milliseconds as M:SS and H:MM:SS', () => {
    expect(formatEvidenceTimestamp(84000)).toBe('1:24');
    expect(formatEvidenceTimestamp(3723000)).toBe('1:02:03');
    expect(formatEvidenceTimestamp(0)).toBe('0:00');
  });

  it('falls back for null timestamps', () => {
    expect(formatEvidenceTimestamp(null)).toBe('--:--');
  });
});

describe('resolveStatementSpans worker-span preservation', () => {
  it('preserves worker spans when the quote differs by case', () => {
    const text = 'The client has been Using coping strategies daily.';
    const start = text.indexOf('Using coping strategies');
    const end = start + 'Using coping strategies'.length;
    const spans = resolveStatementSpans(text, [
      stmt({
        id: 1,
        exact_quote: 'using coping strategies',
        start_char: start,
        end_char: end,
      }),
    ]);
    expect(spans).toEqual([
      { statementId: 1, start, end, verdict: 'fabricated' },
    ]);
  });

  it('preserves worker spans when quotes use single vs double quotes', () => {
    const text = 'The therapist said "Inspect" the area daily.';
    const slice = '"Inspect" the area';
    const start = text.indexOf(slice);
    const spans = resolveStatementSpans(text, [
      stmt({
        id: 1,
        exact_quote: "'Inspect' the area",
        start_char: start,
        end_char: start + slice.length,
      }),
    ]);
    expect(spans).toEqual([
      {
        statementId: 1,
        start,
        end: start + slice.length,
        verdict: 'fabricated',
      },
    ]);
  });

  it('preserves worker Pass 3 anchor spans carrying slack over skipped text', () => {
    const sentence =
      'The client takes aspirin every morning with breakfast and reports no side effects at all.';
    const text = `Intro. ${sentence} Outro.`;
    const start = text.indexOf(sentence);
    const end = start + sentence.length;
    const spans = resolveStatementSpans(text, [
      stmt({
        id: 1,
        // Worker skipped the "with breakfast" middle clause.
        exact_quote:
          'The client takes aspirin every morning and reports no side effects at all.',
        start_char: start,
        end_char: end,
      }),
    ]);
    expect(spans).toEqual([
      { statementId: 1, start, end, verdict: 'fabricated' },
    ]);
  });

  it('rejects overlapping worker spans and falls back to a free occurrence', () => {
    const text = 'takes aspirin daily. takes aspirin daily.';
    const both = [
      stmt({
        id: 1,
        exact_quote: 'takes aspirin',
        start_char: 0,
        end_char: 13,
      }),
      stmt({
        id: 2,
        exact_quote: 'takes aspirin',
        start_char: 0,
        end_char: 13,
      }),
    ];
    const spans = resolveStatementSpans(text, both);
    expect(spans).toHaveLength(2);
    expect(spans[0]).toMatchObject({ statementId: 1, start: 0, end: 13 });
    expect(spans[1]).toMatchObject({ statementId: 2, start: 21, end: 34 });
  });
});

describe('resolveStatementSpans fallback normalization', () => {
  it('matches quotes wrapped in outer quotes', () => {
    const text = 'The client takes aspirin daily.';
    for (const quote of [
      '"takes aspirin"',
      "'takes aspirin'",
      '\u201Ctakes aspirin\u201D',
    ]) {
      const spans = resolveStatementSpans(text, [
        stmt({ id: 1, exact_quote: quote }),
      ]);
      expect(spans).toHaveLength(1);
      expect(text.slice(spans[0]!.start, spans[0]!.end)).toBe('takes aspirin');
    }
  });

  it('matches quotes with leading/trailing ellipses', () => {
    const text = 'The client takes aspirin daily.';
    for (const quote of [
      '...takes aspirin...',
      '\u2026takes aspirin\u2026',
      '..."takes aspirin"...',
    ]) {
      const spans = resolveStatementSpans(text, [
        stmt({ id: 1, exact_quote: quote }),
      ]);
      expect(spans).toHaveLength(1);
      expect(text.slice(spans[0]!.start, spans[0]!.end)).toBe('takes aspirin');
    }
  });

  it('matches across inline Markdown in text or quote', () => {
    const mdText = 'The client **takes aspirin** daily.';
    const spans = resolveStatementSpans(mdText, [
      stmt({ id: 1, exact_quote: 'takes aspirin' }),
    ]);
    expect(spans).toHaveLength(1);
    expect(mdText.slice(spans[0]!.start, spans[0]!.end)).toBe('takes aspirin');

    const plainText = 'The client takes aspirin daily.';
    const mdQuote = resolveStatementSpans(plainText, [
      stmt({ id: 2, exact_quote: '**takes aspirin**' }),
    ]);
    expect(mdQuote).toHaveLength(1);
    expect(plainText.slice(mdQuote[0]!.start, mdQuote[0]!.end)).toBe(
      'takes aspirin'
    );

    const codeText = 'Use padding-top for spacing.';
    const codeQuote = resolveStatementSpans(codeText, [
      stmt({ id: 3, exact_quote: '`padding-top`' }),
    ]);
    expect(codeQuote).toHaveLength(1);
    expect(codeText.slice(codeQuote[0]!.start, codeQuote[0]!.end)).toBe(
      'padding-top'
    );
  });

  it('matches case-insensitively with quote-style differences', () => {
    const text = 'She said "Inspect" the wound.';
    const spans = resolveStatementSpans(text, [
      stmt({ id: 1, exact_quote: "she said 'inspect' the wound" }),
    ]);
    expect(spans).toHaveLength(1);
    expect(text.slice(spans[0]!.start, spans[0]!.end)).toBe(
      'She said "Inspect" the wound'
    );
  });

  it('resolves mid-quote ellipsis splices across a short gap', () => {
    const text =
      'The client takes aspirin every morning and reports no side effects at all.';
    const spans = resolveStatementSpans(text, [
      stmt({
        id: 1,
        exact_quote: 'takes aspirin every morning ... reports no side effects',
      }),
    ]);
    expect(spans).toHaveLength(1);
    expect(text.slice(spans[0]!.start, spans[0]!.end)).toBe(
      'takes aspirin every morning and reports no side effects'
    );
  });

  it('resolves long truncated quotes via the prefix+suffix anchor fallback', () => {
    const text =
      'The client takes aspirin every morning with breakfast and reports no side effects at all.';
    const spans = resolveStatementSpans(text, [
      stmt({
        id: 1,
        exact_quote:
          'The client takes aspirin every morning and reports no side effects at all.',
      }),
    ]);
    expect(spans).toHaveLength(1);
    expect(text.slice(spans[0]!.start, spans[0]!.end)).toBe(text);
  });
});

describe('rehypeHighlightStatements cross-node matching', () => {
  const paragraph = (...children: Array<Text | Element>): Element => ({
    type: 'element',
    tagName: 'p',
    properties: {},
    children,
  });
  const inline = (tagName: string, value: string): Element => ({
    type: 'element',
    tagName,
    properties: {},
    children: [textNode(value)],
  });

  const collectMarks = (node: Element | Text | Root): Element[] => {
    const marks: Element[] = [];
    const kids =
      node.type === 'text' ? [] : ((node as Element | Root).children ?? []);
    for (const child of kids) {
      if (child.type === 'element') {
        if ((child as Element).tagName === 'mark') marks.push(child as Element);
        marks.push(...collectMarks(child as Element));
      }
    }
    return marks;
  };

  it('highlights a sentence spanning code, em, and strong nodes', () => {
    // As parsed from: Set `padding-top` now and *review* the **Summary** below.
    const code = inline('code', 'padding-top');
    const em = inline('em', 'review');
    const strong = inline('strong', 'Summary');
    const tree: Root = {
      type: 'root',
      children: [
        paragraph(
          textNode('Set '),
          code,
          textNode(' now and '),
          em,
          textNode(' the '),
          strong,
          textNode(' below.')
        ),
      ],
    };
    rehypeHighlightStatements([
      stmt({
        id: 9,
        exact_quote: 'Set padding-top now and review the Summary below.',
        verdict: 'contradicted',
      }),
    ])(tree);

    const marks = collectMarks(tree);
    expect(marks.length).toBeGreaterThanOrEqual(5);
    for (const mark of marks) {
      expect(mark.properties).toMatchObject({
        dataStatementId: '9',
        dataVerdict: 'contradicted',
        className: ['verified-statement-mark'],
      });
    }
    // Inline elements keep their tags with marked children.
    expect(code.children).toHaveLength(1);
    expect((code.children[0] as Element).tagName).toBe('mark');
    expect(((code.children[0] as Element).children[0] as Text).value).toBe(
      'padding-top'
    );
    expect(em.children).toHaveLength(1);
    expect((em.children[0] as Element).tagName).toBe('mark');
    expect(strong.children).toHaveLength(1);
    expect((strong.children[0] as Element).tagName).toBe('mark');
    expect(((strong.children[0] as Element).children[0] as Text).value).toBe(
      'Summary'
    );
  });

  it('matches quotes containing Markdown tokens against rendered text nodes', () => {
    // Quote kept raw Markdown while HAST holds rendered text.
    const tree: Root = {
      type: 'root',
      children: [
        paragraph(
          textNode('Set '),
          inline('code', 'padding-top'),
          textNode(' now.')
        ),
      ],
    };
    rehypeHighlightStatements([
      stmt({ id: 4, exact_quote: 'Set `padding-top` now.' }),
    ])(tree);
    const marks = collectMarks(tree);
    expect(marks.length).toBeGreaterThanOrEqual(3);
    for (const mark of marks) {
      expect(mark.properties).toMatchObject({ dataStatementId: '4' });
    }
  });

  it('never highlights inside pre code blocks', () => {
    const tree: Root = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'pre',
          properties: {},
          children: [
            {
              type: 'element',
              tagName: 'code',
              properties: {},
              children: [textNode('secret padding-top value')],
            },
          ],
        },
      ],
    };
    rehypeHighlightStatements([stmt({ id: 1, exact_quote: 'secret padding' })])(
      tree
    );
    expect(collectMarks(tree)).toHaveLength(0);
  });

  it('does not match across nested list items', () => {
    const li = (value: string): Element => ({
      type: 'element',
      tagName: 'li',
      properties: {},
      children: [textNode(value)],
    });
    const tree: Root = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'ul',
          properties: {},
          children: [li('end of first'), li('start of second')],
        },
      ],
    };
    rehypeHighlightStatements([stmt({ id: 1, exact_quote: 'first start' })])(
      tree
    );
    expect(collectMarks(tree)).toHaveLength(0);
  });
});

describe('getVerdictMarkStyle', () => {
  it('rests one alpha step below full so fills stay subtle', () => {
    expect(getVerdictMarkStyle('fabricated').background).toBe(
      'var(--verified-mark-bg, var(--red-a2))'
    );
    expect(getVerdictMarkStyle('contradicted').background).toBe(
      'var(--verified-mark-bg, var(--red-a2))'
    );
    expect(getVerdictMarkStyle('partially_supported').background).toBe(
      'var(--verified-mark-bg, var(--amber-a2))'
    );
    expect(getVerdictMarkStyle('omission').background).toBe(
      'var(--verified-mark-bg, var(--amber-a2))'
    );
    // Supported marks carry no fill at all.
    expect(getVerdictMarkStyle('supported').background).toBe('transparent');
  });

  it('leaves underlines, borders, and radius untouched', () => {
    expect(getVerdictMarkStyle('fabricated').borderBottom).toBe(
      '2px solid var(--red-8)'
    );
    expect(getVerdictMarkStyle('partially_supported').borderBottom).toBe(
      '1.5px dashed var(--amber-8)'
    );
    expect(getVerdictMarkStyle('supported').borderBottom).toBe(
      '1px dotted var(--green-7)'
    );
  });
});
