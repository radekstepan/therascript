// packages/ui/src/utils/escapeHtml.ts

/** Escapes text for HTML rendering (no markup passes through). */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escapes a raw FTS5 search excerpt while preserving the highlighter's
 * own `<mark>` tags (unlike the old Elasticsearch path with encoder: html,
 * FTS5 snippets are unescaped transcript text).
 */
export function escapeFtsSnippet(snippet: string): string {
  return escapeHtml(snippet).replace(/&lt;(\/?mark)&gt;/g, '<$1>');
}
