---
'@therascript/domain': patch
'@therascript/queue': patch
'@therascript/data': patch
'@therascript/api': patch
'@therascript/worker': patch
'@therascript/ui': patch
---

# Task 4: human-readable message previews replace raw DB ids in audit phases

- Live phase text no longer says `Generating assessment for message 1914`; it shows the audited message's first words with its 1-based position, e.g. `Generating assessment (1 of 3): "SOAP Note S – Subjective ..."`.
- New `formatMessagePreview` helper (strips `<think>` blocks and markdown, collapses whitespace, ~9 words / 60 chars + ellipsis). Job snapshots resolve the preview server-side via a scalar subquery — no migration — so page reloads mid-audit show `Working on "<preview>"...` immediately, with `message #<id>` as the fallback when text is unavailable.
- The preview flows through queue stream events, the worker's phase publisher, and the UI stream hook / fallback text (including a dedicated `retrying` branch).
