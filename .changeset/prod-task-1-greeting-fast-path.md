---
'@therascript/worker': patch
---

# Task 1 (prod-readiness): greeting fast-path requires fully nonfactual answers

- **Fixed silent approval of factual answers:** the trivial-greeting fast path previously bypassed the Judge whenever a short answer merely contained a greeting substring, so `Hello! The patient reported suicidal thoughts.` was saved as a perfect audit (accuracy 1.0, zero claims) and skipped by future audits.
- **Per-clause recognition:** every clause must now be a complete, explicitly recognized nonfactual utterance (a known greeting/offer lead followed only by filler words). Any substantive clause — greeting-prefixed claims, factual answers ending with "let me know", or single-clause blends — is routed through the Judge and can receive negative verdicts.
- Pure greetings (`Hello!`, `Hello, how are you?`, `How can I help you today?`, …) still bypass inference with zero LLM calls.
