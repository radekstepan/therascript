---
'@therascript/queue': patch
'@therascript/worker': patch
'@therascript/ui': patch
---

# Task 3: live token generation speed during fact-check audits

- While the Judge LLM streams `<think>` or content chunks, the audit banner now shows `~X.X tokens/s` (tabular numerals), matching the Session Chat / Cross-Session Analysis format — previously the phase string sat static with no sign the model was generating.
- The worker tracks speed with the same len/4 token heuristic, publishes throttled `phase` ticks (300 ms, Redis/SSE only, never SQLite), and resets the speed to `null` on every non-generating transition so stale values never linger.
- Queue `VerificationStreamEvent` gains optional `tokensPerSecond` / `generatedTokens`; the UI stream hook carries them and clears them on `message_verified` / terminal events.
