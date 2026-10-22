---
'@therascript/api': minor
'@therascript/data': minor
'@therascript/db': minor
'@therascript/domain': minor
'@therascript/queue': minor
'@therascript/ui': minor
'@therascript/worker': minor
---

# Verification progress phases and debuggable failures

## Progress you can watch

- The audit banner now shows the worker's live phase (waiting for the LLM lock, loading the Judge, checking message N of M, generating the assessment, retrying with thinking disabled, finishing) alongside the processed counter. `processed` still counts finished attempts only, so `0 / 1` during generation is explained instead of looking stuck.
- Phase, current message identity, attempt number, outcome split, and elapsed timing flow through the queue event, SSE stream, and `useVerificationStream` hook. The phase is also snapshotted onto the job row, so reconnects and page reloads stay understandable.
- Socket trouble renders as "Live updates interrupted — reconnecting" and reconciles through polling; it is never confused with a Judge failure.

## Honest outcomes

- Every finished attempt is tallied as succeeded or failed. A run where every assessment fails is marked `failed`; a mixed run stays `completed` but persists a "Completed with errors: X of Y checked, Z failed" summary, and the UI renders the mixed label with counts instead of unqualified success. Canceled runs report skipped candidates; zero-candidate runs complete cleanly.
- Per-message failures persist a bounded reason (job/message IDs, Judge model, phase/attempt, duration, token usage — never transcripts or raw reasoning) plus a machine-readable category: empty output, malformed JSON, invalid structure, provider error, context budget, or missing transcript.
- Failure details survive reloads: the audit page shows a persistent terminal result for the last failed/mixed run, Job History rows show the outcome split with a "View details" dialog (per-message reasons plus session/chat/note links), and chat notes show the specific failure category.

## API and schema

- New endpoint `GET /api/verification/jobs/:jobId/failures` returning `{ jobId, failures[] }` for one run.
- SSE adds `phase` events with the fields above.
- Migration V21 adds `succeeded_messages` / `failed_messages` / `skipped_messages` and the `current_phase*` snapshot columns to `verification_jobs` (backfilled from message rows), plus `error_code` on `message_verifications`. Backup restore preserves the new columns.
