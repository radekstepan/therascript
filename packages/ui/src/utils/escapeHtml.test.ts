// packages/ui/src/utils/escapeHtml.test.ts
import { describe, it, expect } from 'vitest';
import { escapeHtml, escapeFtsSnippet } from './escapeHtml';

describe('escapeHtml', () => {
  it('escapes markup characters', () => {
    expect(escapeHtml('<b>&"\'</b>')).toBe(
      '&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;'
    );
    expect(escapeHtml('plain text')).toBe('plain text');
  });
});

describe('escapeFtsSnippet', () => {
  it('preserves mark highlights while escaping text', () => {
    expect(escapeFtsSnippet('feeling <mark>anxious</mark> today')).toBe(
      'feeling <mark>anxious</mark> today'
    );
  });

  it('neutralizes injected markup inside and outside highlights', () => {
    expect(
      escapeFtsSnippet('<img src=x onerror=alert(1)> <mark>a</mark>')
    ).toBe('&lt;img src=x onerror=alert(1)&gt; <mark>a</mark>');
    expect(escapeFtsSnippet('<mark><script>alert(1)</script></mark>')).toBe(
      '<mark>&lt;script&gt;alert(1)&lt;/script&gt;</mark>'
    );
  });

  it('does not restore non-mark tags', () => {
    expect(escapeFtsSnippet('<b>bold</b>')).toBe('&lt;b&gt;bold&lt;/b&gt;');
  });
});
