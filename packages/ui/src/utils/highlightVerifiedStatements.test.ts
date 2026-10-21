// packages/ui/src/utils/highlightVerifiedStatements.test.ts
import { describe, it, expect } from 'vitest';
import type { Element, Root, Text } from 'hast';
import {
  splitTextByStatementSpans,
  resolveStatementSpans,
  rehypeHighlightStatements,
  parseStatementEvidence,
  formatEvidenceTimestamp,
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
