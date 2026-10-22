/**
 * Human-readable preview of an AI chat message for audit progress UI.
 *
 * The verification worker and the job-snapshot repository share this
 * helper so live SSE `phase` text and reloaded `/verification` banners
 * describe the same message the same way.
 *
 * Behavior:
 * - Strips `<think>...</think>` reasoning blocks (multiline, repeated,
 *   case-insensitive), an unclosed `<think>...` prefix through the end
 *   of the text, and stray closing `</think>` tags.
 * - Strips common markdown formatting (`#`, `*`, `_`, `` ` ``, `>`,
 *   `~`) and list bullets (`-`, `*`, `+`, `1.`/`1)`) at line starts.
 * - Collapses all whitespace to single spaces.
 * - Keeps the first `maxWords` words (default 9), capped at `maxChars`
 *   characters (default 60); appends `…` when truncated.
 */
export function formatMessagePreview(
  text: string,
  maxWords: number = 9,
  maxChars: number = 60
): string {
  if (!text) return '';
  const withoutThinking = text
    .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
    .replace(/<think>[\s\S]*$/i, ' ')
    .replace(/<\/think>/gi, ' ');
  const withoutBullets = withoutThinking.replace(
    /^\s*(?:[-*+]|\d+[.)])\s+/gm,
    ''
  );
  const withoutMarkdown = withoutBullets.replace(/[#*_`>~]+/g, '');
  const collapsed = withoutMarkdown.replace(/\s+/g, ' ').trim();
  if (!collapsed) return '';
  const words = collapsed.split(' ');
  let preview =
    words.length > maxWords ? words.slice(0, maxWords).join(' ') : collapsed;
  const truncatedByWords = words.length > maxWords;
  if (preview.length > maxChars) {
    preview = preview.slice(0, maxChars).trimEnd();
    return `${preview}…`;
  }
  return truncatedByWords ? `${preview}…` : preview;
}
