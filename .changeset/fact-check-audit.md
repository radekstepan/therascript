---
'@therascript/api': minor
'@therascript/data': minor
'@therascript/db': minor
'@therascript/domain': minor
'@therascript/queue': minor
'@therascript/ui': minor
'@therascript/worker': minor
---

# Fact Check: LLM verification & hallucination audit ("LLM Judge")

## Database (V20 migration)

- **`messages.model` column with backfill.** AI chat messages now record which
  LLM authored them; existing rows are backfilled from `usage_logs` via
  nearest-timestamp match within a 5s window.
- **New tables:** `verification_jobs` (audit runs with snapshotted Judge LLM
  config), `message_verifications` (per-message audit summaries and accuracy
  scores), and `verified_statements` (atomic claims/omissions with character
  spans, verdicts, severity, and transcript evidence).
- **New `system_verification_judge` prompt template** seeded for the Judge LLM.

## Background worker

- **New `verification-jobs` BullMQ queue** (`concurrency: 1`) auditing
  session-bound AI responses newest-first against ground-truth transcripts.
- Extracts atomic claims, assigns `supported` / `partially_supported` /
  `contradicted` / `fabricated` verdicts, detects omissions relative to the
  therapist's question, and streams live progress over Redis Pub/Sub SSE.
- Skips already-verified messages by default; reuses the shared worker LLM
  lifecycle with transcript caching and context budgeting.

## API

- **`/api/verification/*` endpoints:** launch/list/inspect/cancel jobs, SSE
  progress stream, global analytics (KPIs, per-model accuracy, trends, session
  coverage), filterable statements feed, and per-message/all reset.
- **Per-chat endpoints** to fetch verifications and trigger single-chat audits;
  verification counts included in active job counts.

## UI

- **New `/verification` "Fact Check" hub:** live audit banner, launch modal
  with scope picker and Judge LLM settings, accuracy analytics, and
  Issues / Coverage / Job History tabs with deep links into session chats.
- **In-context chat highlighting:** fabricated/contradicted statements get red
  overlays, partial claims amber, plus verification footer badges, an omissions
  pill, and an interactive Judge Verdict modal with transcript evidence.
