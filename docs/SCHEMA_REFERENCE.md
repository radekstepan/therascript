# Database & Search Schema Reference

This document outlines the data structures used in SQLite (primary storage) and Elasticsearch (search index).

## SQLite Schema (`packages/db`)

Defined in `src/sqliteService.ts`. Migrations are handled programmatically via `user_version` pragma.

**Current Schema Version:** 20

### Core Tables

#### `sessions`
Stores metadata for a therapy session.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PK, AUTOINCREMENT | Unique session identifier |
| `fileName` | TEXT | NOT NULL | Original uploaded filename |
| `clientName` | TEXT | NOT NULL | Client/patient name |
| `sessionName` | TEXT | NOT NULL | Session display name |
| `date` | TEXT | NOT NULL | Session date (ISO format) |
| `sessionType` | TEXT | NOT NULL | Session type category |
| `therapy` | TEXT | NOT NULL | Therapy modality |
| `status` | TEXT | NOT NULL, DEFAULT 'pending' | 'pending' \| 'queued' \| 'transcribing' \| 'completed' \| 'failed' |
| `whisperJobId` | TEXT | NULL | Whisper service job reference |
| `audioPath` | TEXT | NULL | Relative path to stored audio file |
| `transcriptTokenCount` | INTEGER | NULL | Cached token count of full transcript |

#### `transcript_paragraphs`
Stores the actual content of the session, segmented by time.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PK, AUTOINCREMENT | Unique paragraph identifier |
| `sessionId` | INTEGER | NOT NULL, FK → sessions(id) | Parent session |
| `paragraphIndex` | INTEGER | NOT NULL | Ordering index within session |
| `timestampMs` | INTEGER | NOT NULL | Start time in milliseconds |
| `text` | TEXT | NOT NULL | Paragraph content |
| `speaker` | TEXT | NULL | Speaker label (e.g. `SPEAKER_00`) |

**Indices:** `idx_paragraph_session`, `idx_paragraph_session_index`

#### `chats`
Represents a conversation thread.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PK, AUTOINCREMENT | Unique chat identifier |
| `sessionId` | INTEGER | NULL, FK → sessions(id) | Parent session (NULL for standalone chats) |
| `timestamp` | INTEGER | NOT NULL | Creation timestamp |
| `name` | TEXT | NULL | Optional custom name |
| `tags` | TEXT | NULL | JSON string array (for standalone chats) |

**Indices:** `idx_chat_session`, `idx_chat_timestamp`

#### `messages`
Individual messages within a chat.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PK, AUTOINCREMENT | Unique message identifier |
| `chatId` | INTEGER | NOT NULL, FK → chats(id) | Parent chat |
| `sender` | TEXT | NOT NULL, CHECK('user', 'ai', 'system') | Message author type |
| `text` | TEXT | NOT NULL | Message content |
| `timestamp` | INTEGER | NOT NULL | Creation timestamp |
| `promptTokens` | INTEGER | NULL | Input token count |
| `completionTokens` | INTEGER | NULL | Output token count |
| `model` | TEXT | NULL | **Added in V20.** LLM that authored the message (backfilled from `usage_logs` via nearest-timestamp match within 5s) |

**Indices:** `idx_message_chat`, `idx_message_timestamp`, `idx_messages_model`

#### `templates`
Saved message templates for quick reuse.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PK, AUTOINCREMENT | Unique template identifier |
| `title` | TEXT | NOT NULL, UNIQUE | Template title |
| `text` | TEXT | NOT NULL | Template content |
| `createdAt` | INTEGER | NOT NULL | Creation timestamp |

**Indices:** `idx_template_created_at`

#### `app_settings`
Single-row table (id=1) that holds the global LLM configuration. There
is only ever one row — any other id violates the `CHECK (id = 1)`
constraint.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PK, CHECK (id = 1) | Singleton identifier |
| `llm_base_url` | TEXT | NULL | Active LLM base URL override; `NULL` = use `config.llm.baseURL` |
| `llm_model_name` | TEXT | NULL | Currently active model key (e.g. `qwen2.5-7b-instruct`) |
| `llm_context_size` | INTEGER | NULL | Configured context window size; `NULL` = use the model default |
| `llm_temperature` | REAL | NOT NULL, DEFAULT 0.7 | Sampling temperature |
| `llm_top_p` | REAL | NOT NULL, DEFAULT 0.9 | Nucleus sampling threshold |
| `llm_repeat_penalty` | REAL | NOT NULL, DEFAULT 1.1 | Repeat penalty |
| `llm_num_gpu_layers` | INTEGER | NULL | Number of GPU layers; `NULL` = auto |
| `llm_thinking_budget` | INTEGER | NULL | Reasoning budget; `NULL` = unrestricted |
| `llm_api_token` | TEXT | NULL | **Added in V19.** Optional API token (e.g. `Authorization: Bearer …`) sent only when the resolved base URL is non-local. The value is never returned to the UI; the API surfaces its presence as `hasRemoteApiToken` on `LlmStatus`. |

### Analysis Tables

#### `analysis_jobs`
Tracks multi-session analysis requests.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PK, AUTOINCREMENT | Unique job identifier |
| `original_prompt` | TEXT | NOT NULL | User's high-level question |
| `short_prompt` | TEXT | NOT NULL, DEFAULT 'Analysis Job' | Condensed title (max 5 words) |
| `strategy_json` | TEXT | NULL | JSON MapReduce strategy |
| `status` | TEXT | NOT NULL, DEFAULT 'pending' | Job state |
| `final_result` | TEXT | NULL | Synthesized output |
| `error_message` | TEXT | NULL | Error details if failed |
| `model_name` | TEXT | NULL | LLM model used |
| `context_size` | INTEGER | NULL | Context window size used to load the model |
| `thinking_budget` | INTEGER | NULL | Snapshotted `reasoning_budget` for thinking models (v15) |
| `temperature` | REAL | NULL | Snapshotted sampling temperature (v15) |
| `top_p` | REAL | NULL | Snapshotted nucleus sampling threshold (v15) |
| `repeat_penalty` | REAL | NULL | Snapshotted repeat/presence penalty (v15) |
| `num_gpu_layers` | INTEGER | NULL | Snapshotted GPU offload layer count (v15) |
| `map_phase_system_prompt` | TEXT | NULL | Optional system prompt prepended to every Map-phase LLM call (v16) |
| `created_at` | INTEGER | NOT NULL | Creation timestamp |
| `completed_at` | INTEGER | NULL | Completion timestamp |

> **Why snapshot LLM params?** The worker is a separate process with its own empty in-memory state. Persisting these values at job-creation time (from `activeModelService` in the API process) ensures the worker honours the user's "Set Model" configuration for both the Map and Reduce phases. See `analysisHandler.ts` → `llmParams` and `DATA_FLOWS.md §4`.

**Indices:** `idx_analysis_jobs_status`, `idx_analysis_jobs_created_at`

#### `analysis_job_sessions`
Junction table linking analysis jobs to sessions.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `analysis_job_id` | INTEGER | PK, FK → analysis_jobs(id) | Parent analysis job |
| `session_id` | INTEGER | PK, FK → sessions(id) | Linked session |

#### `intermediate_summaries`
Stores the result of the "Map" phase for each session.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PK, AUTOINCREMENT | Unique summary identifier |
| `analysis_job_id` | INTEGER | NOT NULL, FK → analysis_jobs(id) | Parent job |
| `session_id` | INTEGER | NOT NULL, FK → sessions(id) | Source session |
| `summary_text` | TEXT | NULL | LLM extraction/summary |
| `status` | TEXT | NOT NULL, DEFAULT 'pending' | Summary state |
| `error_message` | TEXT | NULL | Error details if failed |

**Indices:** `idx_intermediate_summaries_job_id`

### Verification Tables (Added in V20)

Migration V20 adds the LLM Fact-Verification & Hallucination Audit ("LLM Judge") system: audit-run tracking (`verification_jobs`), per-message audit summaries (`message_verifications`), and atomic claim/omission verdicts (`verified_statements`), plus the `messages.model` authoring-model column above.

#### `verification_jobs`
Tracks fact-verification audit runs. The Judge LLM config is snapshotted into the row at creation time so the worker (a separate process) honours the user's Judge settings without touching the global chat model.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PK, AUTOINCREMENT | Unique job identifier |
| `status` | TEXT | NOT NULL, DEFAULT 'pending' | 'pending' \| 'processing' \| 'completed' \| 'failed' \| 'canceled' (CHECK) |
| `scope` | TEXT | NOT NULL, DEFAULT 'all_unverified' | 'all_unverified' \| 'all_force' \| 'selected_sessions' \| 'single_chat' (CHECK) |
| `session_ids_json` | TEXT | NULL | JSON array of session IDs (for `selected_sessions` scope) |
| `chat_id` | INTEGER | NULL | Target chat (for `single_chat` scope) |
| `skip_verified` | INTEGER | NOT NULL, DEFAULT 1 | 1 = skip already-verified messages |
| `total_messages` | INTEGER | NOT NULL, DEFAULT 0 | Candidate AI messages at job start |
| `processed_messages` | INTEGER | NOT NULL, DEFAULT 0 | Messages audited so far |
| `total_statements` | INTEGER | NOT NULL, DEFAULT 0 | Claims extracted so far |
| `flagged_statements` | INTEGER | NOT NULL, DEFAULT 0 | Claims with a non-clean verdict so far |
| `omissions_count` | INTEGER | NOT NULL, DEFAULT 0 | Omissions detected so far |
| `created_at` | INTEGER | NOT NULL | Creation timestamp |
| `completed_at` | INTEGER | NULL | Completion timestamp |
| `error_message` | TEXT | NULL | Error details if failed |
| `model_name` | TEXT | NULL | Snapshotted Judge model |
| `context_size` | INTEGER | NULL | Snapshotted context window size |
| `thinking_budget` | INTEGER | NULL | Snapshotted `reasoning_budget` (capped at 2048 by the worker) |
| `temperature` | REAL | NULL | Snapshotted sampling temperature (default 0.3) |
| `top_p` | REAL | NULL | Snapshotted nucleus sampling threshold |
| `repeat_penalty` | REAL | NULL | Snapshotted repeat/presence penalty |
| `num_gpu_layers` | INTEGER | NULL | Snapshotted GPU offload layer count |
| `llm_base_url` | TEXT | NULL | Snapshotted LLM endpoint URL |

**Indices:** `idx_verification_jobs_status`, `idx_verification_jobs_created_at`

#### `message_verifications`
Per-message audit summary: one row per audited AI message (`message_id` is UNIQUE, so re-verifying a message replaces its row).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PK, AUTOINCREMENT | Unique verification identifier |
| `message_id` | INTEGER | NOT NULL, UNIQUE, FK → messages(id) ON DELETE CASCADE | Audited AI message |
| `chat_id` | INTEGER | NOT NULL, FK → chats(id) ON DELETE CASCADE | Parent chat |
| `session_id` | INTEGER | NOT NULL, FK → sessions(id) ON DELETE CASCADE | Parent session |
| `verification_job_id` | INTEGER | NULL, FK → verification_jobs(id) ON DELETE SET NULL | Audit run that produced this verdict |
| `authored_model` | TEXT | NULL | LLM that wrote the message (from `messages.model`) |
| `judge_model` | TEXT | NOT NULL | Judge LLM that produced the verdict |
| `status` | TEXT | NOT NULL, DEFAULT 'completed' | 'completed' \| 'failed' \| 'skipped' (CHECK) |
| `total_claims` | INTEGER | NOT NULL, DEFAULT 0 | Atomic claims extracted |
| `supported_claims` | INTEGER | NOT NULL, DEFAULT 0 | Claims verified against the transcript |
| `partial_claims` | INTEGER | NOT NULL, DEFAULT 0 | Partially supported claims |
| `contradicted_claims` | INTEGER | NOT NULL, DEFAULT 0 | Claims contradicting the transcript |
| `fabricated_claims` | INTEGER | NOT NULL, DEFAULT 0 | Claims with no transcript basis |
| `omissions_count` | INTEGER | NOT NULL, DEFAULT 0 | Key facts the answer omitted |
| `accuracy_score` | REAL | NOT NULL, DEFAULT 1.0 | Weighted accuracy (supported + 0.5·partial) / (claims + omissions) |
| `summary_assessment` | TEXT | NULL | Judge's overall assessment text |
| `prompt_tokens` | INTEGER | NULL | Judge input tokens (accumulated across retry) |
| `completion_tokens` | INTEGER | NULL | Judge output tokens (accumulated across retry) |
| `duration_ms` | INTEGER | NULL | Judge wall-clock time in ms |
| `verified_at` | INTEGER | NOT NULL | Verification timestamp |
| `error_message` | TEXT | NULL | Error details when `status = 'failed'` |

**Indices:** `idx_msg_verifications_session`, `idx_msg_verifications_chat`, `idx_msg_verifications_authored_model`, `idx_msg_verifications_verified_at`

#### `verified_statements`
Atomic claims and omissions extracted from an audited message, each with a verdict, severity, character span (for inline UI highlighting), and transcript evidence.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PK, AUTOINCREMENT | Unique statement identifier |
| `message_verification_id` | INTEGER | NOT NULL, FK → message_verifications(id) ON DELETE CASCADE | Parent verification |
| `message_id` | INTEGER | NOT NULL, FK → messages(id) ON DELETE CASCADE | Source AI message |
| `session_id` | INTEGER | NOT NULL, FK → sessions(id) ON DELETE CASCADE | Parent session |
| `statement_index` | INTEGER | NOT NULL | Ordering index within the message |
| `kind` | TEXT | NOT NULL, DEFAULT 'claim' | 'claim' \| 'omission' (CHECK) |
| `exact_quote` | TEXT | NOT NULL | Verbatim quote from the AI message (empty for omissions) |
| `normalized_claim` | TEXT | NOT NULL | Judge-normalized claim text |
| `start_char` | INTEGER | NULL | Quote start offset in the message (inline highlight) |
| `end_char` | INTEGER | NULL | Quote end offset in the message (inline highlight) |
| `verdict` | TEXT | NOT NULL | 'supported' \| 'partially_supported' \| 'contradicted' \| 'fabricated' \| 'omission' (CHECK) |
| `severity` | TEXT | NOT NULL, DEFAULT 'none' | 'none' \| 'low' \| 'medium' \| 'high' \| 'critical' (CHECK) |
| `confidence` | REAL | NOT NULL, DEFAULT 1.0 | Judge confidence 0–1 |
| `reasoning` | TEXT | NOT NULL | Judge's justification |
| `transcript_evidence_json` | TEXT | NULL | JSON array of `{ paragraphIndex, timestampMs, speaker, quote }`, hydrated against ground-truth paragraphs |
| `created_at` | INTEGER | NOT NULL | Creation timestamp |

**Indices:** `idx_verified_statements_msg`, `idx_verified_statements_verdict`, `idx_verified_statements_session`

```
┌──────────────────┐     ┌───────────────────┐     ┌──────────────────┐
│ verification_    │     │ message_          │     │ verified_        │
│ jobs             │     │ verifications     │     │ statements       │
├──────────────────┤     ├───────────────────┤     ├──────────────────┤
│ id (PK)          │◄────│ verification_     │◄────│ message_         │
│ status / scope   │     │  job_id (FK,      │     │  verification_   │
│ counters         │     │  SET NULL)        │     │  id (FK)         │
│ Judge LLM config │     │ message_id (FK,   │     │ message_id (FK)  │
│ snapshot         │     │  UNIQUE)          │     │ verdict/severity │
└──────────────────┘     │ chat_id (FK)      │     │ start/end_char   │
                         │ session_id (FK)   │     │ evidence JSON    │
                         │ accuracy_score    │     └──────────────────┘
                         └───────────────────┘
```

---

## Elasticsearch Indices (`packages/elasticsearch-client`)

Defined in `src/mappings.ts`.

### `therascript_transcripts`
Stores transcript paragraphs for full-text search.

| Field | ES Type | Description |
|-------|---------|-------------|
| `text` | text (+ `text.stem` with English analyzer) | Paragraph content |
| `session_id` | keyword | Session identifier for filtering |
| `paragraph_index` | integer | Ordering within session |
| `speaker` | keyword | Speaker label (optional) |
| `timestamp_ms` | long | Start time in milliseconds |
| `client_name` | keyword | Client name for filtering |
| `session_name` | keyword | Session name for filtering |
| `session_date` | date | Session date for sorting |

### `therascript_messages`
Stores chat messages for full-text search.

| Field | ES Type | Description |
|-------|---------|-------------|
| `text` | text (+ `text.stem` with English analyzer) | Message content |
| `chat_id` | keyword | Chat identifier |
| `message_id` | keyword | Message identifier |
| `sender` | keyword | 'user' \| 'ai' \| 'system' |
| `timestamp` | date | Message timestamp |
| `chat_name` | keyword | Chat name for display |
| `session_id` | keyword | Parent session (NULL for standalone) |
| `client_name` | keyword | Client name for filtering |
| `tags` | keyword (array) | Tags for standalone chats |

---

## Entity Relationship Diagram

```
┌──────────────────┐
│     sessions     │
├──────────────────┤
│ id (PK)          │◄─────────────────────────────────────────────┐
│ fileName         │                                               │
│ clientName       │                                               │
│ sessionName      │                                               │
│ status           │                                               │
└────────┬─────────┘                                               │
         │ 1:N                                                     │
         ▼                                                         │
┌──────────────────┐       ┌──────────────────┐       ┌───────────┴───────┐
│ transcript_      │       │      chats       │       │ analysis_job_     │
│ paragraphs       │       ├──────────────────┤       │ sessions          │
├──────────────────┤       │ id (PK)          │       ├───────────────────┤
│ id (PK)          │       │ sessionId (FK)───┼──────►│ analysis_job_id   │
│ sessionId (FK)───┼──────►│ timestamp        │       │ session_id (FK)───┼──►
│ paragraphIndex   │       │ name             │       └───────────────────┘
│ timestampMs      │       │ tags             │                │
│ text             │       └────────┬─────────┘                │
└──────────────────┘                │ 1:N                      │
                                    ▼                          ▼
                           ┌──────────────────┐       ┌───────────────────┐
                           │     messages     │       │   analysis_jobs   │
                           ├──────────────────┤       ├───────────────────┤
                           │ id (PK)          │       │ id (PK)           │◄──┐
                           │ chatId (FK)──────┼──────►│ original_prompt   │   │
                           │ sender           │       │ strategy_json     │   │
                           │ text             │       │ status            │   │
                           │ timestamp        │       │ final_result      │   │
                           │ promptTokens     │       └───────────────────┘   │
                           │ completionTokens │                │ 1:N          │
                           └──────────────────┘                ▼              │
                                                      ┌───────────────────┐   │
                                                      │  intermediate_    │   │
                           ┌──────────────────┐       │  summaries        │   │
                           │    templates     │       ├───────────────────┤   │
                           ├──────────────────┤       │ id (PK)           │   │
                           │ id (PK)          │       │ analysis_job_id───┼───┘
                           │ title (UNIQUE)   │       │ session_id (FK)   │
                           │ text             │       │ summary_text      │
                           │ createdAt        │       │ status            │
                           └──────────────────┘       └───────────────────┘
```
