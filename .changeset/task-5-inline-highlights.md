---
'@therascript/ui': patch
---

# Task 5: inline statement highlights across Markdown

- Worker-resolved spans survive case, quote-style, and Markdown differences via normalized equality/anchor matching, with normalized substring, ellipsis-clause, and anchor fallbacks.
- Markdown rendering matches statements across split `<code>`/`<strong>`/`<em>` nodes (excluding `<pre>`), so every part of a highlighted statement opens its verdict.
