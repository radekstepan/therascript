---
'@therascript/domain': patch
'@therascript/data': patch
'@therascript/api': patch
'@therascript/ui': patch
---

# Transcripts coverage shows the predominant chat LLM

- `getGlobalVerificationAnalytics` now resolves `predominantModel` per session: the most common `messages.model` across the session's verifiable AI messages (count desc, nulls last, alphabetical tie-break; null when no model was recorded). It flows through the domain `SessionVerificationSummary`, the zod schema, and the Elysia `SessionVerificationSummarySchema` response shape.
- The Transcripts coverage table gains a `Chat LLM` column (after Date) rendering the model (ellipsis-truncated with a full-name tooltip) or a gray `—` when unrecorded; the table min-width grows 760px → 880px to fit.
