---
'@therascript/worker': patch
---

# Task 9 (prod-readiness): missing transcripts no longer verify as successful

- **Missing ground truth fails instead of succeeding:** a substantive answer in a session with no transcript paragraphs was saved as completed with accuracy 1.0, counted toward coverage, and skipped by subsequent default audits. It is now saved as a failed verification (zero tokens, explanatory error, no success event), so coverage ignores it and default audits retry it once the transcript exists.
- **Empty/trivial fast paths preserved:** genuinely empty answers and trivial conversational greetings keep their existing completed 1.0 handling without a judge call, even when the transcript is missing.
