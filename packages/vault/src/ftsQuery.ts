// packages/vault/src/ftsQuery.ts
//
// Safe translation of user search input into an FTS5 MATCH query.
// Every term is emitted as a double-quoted literal with
// embedded quotes doubled, so FTS5 syntax in the input (`OR`, `*`, `NEAR`,
// column filters, unbalanced parens) can never change the query shape —
// it is searched as literal text or dropped as a non-term character.
//
// Supported input: bare words (ANDed) and "quoted phrases" (phrase match).
// Returns null when the input contains no searchable terms.
import { VaultFormatError } from './errors.js';

export const MAX_FTS_QUERY_CHARS = 500;
export const MAX_FTS_TERMS = 32;

/** Matches a word-ish run (unicode letters/digits, incl. CJK). */
const WORD_PATTERN = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;

export function escapeFts5Literal(term: string): string {
  return `"${term.replace(/"/g, '""')}"`;
}

function extractQuotedPhrases(input: string): {
  phrases: string[];
  remainder: string;
} {
  const phrases: string[] = [];
  // Non-greedy double-quoted spans; a lone trailing quote is ignored.
  const remainder = input.replace(/"([^"]*)"/g, (_match, inner: string) => {
    const words = inner.match(WORD_PATTERN);
    if (words && words.length > 0) {
      phrases.push(words.join(' '));
    }
    return ' ';
  });
  return { phrases, remainder };
}

export function toFts5Query(input: string): string | null {
  if (typeof input !== 'string') {
    throw new VaultFormatError('Search input must be a string');
  }
  const bounded = input.slice(0, MAX_FTS_QUERY_CHARS);
  const { phrases, remainder } = extractQuotedPhrases(bounded);
  const words = remainder.match(WORD_PATTERN) ?? [];
  const literals: string[] = [];
  for (const word of words.slice(0, MAX_FTS_TERMS)) {
    literals.push(escapeFts5Literal(word));
  }
  for (const phrase of phrases.slice(
    0,
    Math.max(0, MAX_FTS_TERMS - literals.length)
  )) {
    literals.push(escapeFts5Literal(phrase));
  }
  if (literals.length === 0) return null;
  return literals.join(' AND ');
}
