---
'@therascript/db': patch
'@therascript/worker': patch
---

# Task 2: quote-span resolution and ground-truth evidence hydration

- **Quote spans resolve reliably:** outer-quote and ellipsis stripping, single/double/curly quote and dash normalization, mid-quote ellipsis clause matching, and a tighter anchor window so wide matches no longer starve inner statements.
- **Evidence uses ground-truth transcript data.** The worker overwrites Judge-supplied `timestampMs`/`speaker` with the matched paragraph's timestamp and speaker (nulled when unresolvable), and speaker labels honor the session's `showSpeakers` setting instead of rendering `UNKNOWN`.
- Judge prompt clarifies `paragraphIndex` citation (`[P#<index>]`) and null-speaker rules (worker fallback and seeded `system_verification_judge` template).
