---
'@therascript/ui': patch
---

# Fact Check panel step flash and remembered position

- Prev/Next (and arrow-key) stepping in the Fact Check panel now flashes the matching inline highlight in the chat note: `StatementVerdictModal` reports the shown statement via a new `onSelectionChange` callback, `ChatMessages` forwards the active statement id to the owning `ChatMessageBubble`, and the matching `<mark>` (Markdown and plain-text paths) gains a verdict-colored `verified-statement-mark-active` flash plus a persistent tinted ring while selected, scrolling into view with `block: nearest`.
- The panel remembers its last drag position in `localStorage` (`therascript.fact-check-panel-pos`) and reappears there immediately on open instead of resetting to the left dock; the global `dialogSlideIn` entrance animation is disabled for the panel so it no longer slides up from the bottom-left corner.
- `resolveStatementSpans` gains a trailing-punctuation-tolerant quote-search retry (e.g. the Judge's `daily.` vs the note's `daily and has ...`), so mid-sentence fabricated quotes that previously produced no mark in Markdown mode now highlight — without it the new step flash had nothing to target for the most severe findings. Verbatim matches still win over the stripped retry.
