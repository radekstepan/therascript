# Database & Search Schema Reference

This document outlines the data structures used in SQLite (primary storage) and Elasticsearch (search index).

## SQLite Schema (`packages/db`)

Defined in `src/sqliteService.ts`. Migrations are handled programmatically via `user_version` pragma.

**Current Schema Version:** 7

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

**Indices:** `idx_message_chat`, `idx_message_timestamp`

#### `templates`
Saved message templates for quick reuse.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PK, AUTOINCREMENT | Unique template identifier |
| `title` | TEXT | NOT NULL, UNIQUE | Template title |
| `text` | TEXT | NOT NULL | Template content |
| `createdAt` | INTEGER | NOT NULL | Creation timestamp |

**Indices:** `idx_template_created_at`

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
| `context_size` | INTEGER | NULL | Context window size |
| `created_at` | INTEGER | NOT NULL | Creation timestamp |
| `completed_at` | INTEGER | NULL | Completion timestamp |

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
