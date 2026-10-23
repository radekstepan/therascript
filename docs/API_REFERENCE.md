# API Reference

All endpoints are prefixed with `/api/`.

---

## Sessions (`sessionRoutes.ts`)

Session CRUD operations, audio file upload, and transcript access.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/sessions` | List all sessions (metadata + `chatCount`) |
| `POST` | `/api/sessions/upload` | Upload audio file with metadata, run diarization readiness gate, start transcription job |
| `GET` | `/api/sessions/:sessionId` | Get session metadata and associated chat list |
| `PUT` | `/api/sessions/:sessionId/metadata` | Update session metadata (clientName, date, etc.) |
| `DELETE` | `/api/sessions/:sessionId` | Delete session, audio files, chats, paragraphs, and ES docs |
| `GET` | `/api/sessions/:sessionId/transcript` | Get structured transcript content (paragraphs, including optional `speaker`) |
| `PATCH` | `/api/sessions/:sessionId/speakers` | Rename one or more transcript speaker labels (`[{ from, to }]`) |
| `PATCH` | `/api/sessions/:sessionId/transcript` | Update a specific transcript paragraph |
| `DELETE` | `/api/sessions/:sessionId/transcript/:paragraphIndex` | Delete a single transcript paragraph |
| `GET` | `/api/sessions/:sessionId/audio` | Stream the original session audio file (supports range requests) |
| `GET` | `/api/sessions/:sessionId/audio/status` | Lightweight `{ available }` probe: does the referenced audio file exist on disk |
| `DELETE` | `/api/sessions/:sessionId/audio` | Delete only the original audio file |

**Upload Body Notes (`POST /api/sessions/upload`):**
- Accepts optional `numSpeakers` (numeric, clamped to `1..10`, default `2`).
- Before creating/enqueuing, API checks Whisper readiness via `GET /diarization/check`.
- If diarization is not ready, API returns `503` and may trigger background prefetch.

---

## Session Chats (`chatRoutes.ts`)

Session-bound chat operations. All routes are nested under `/api/sessions/:sessionId/chats`.

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/sessions/:sessionId/chats` | Create a new chat within a session |
| `GET` | `/api/sessions/:sessionId/chats/:chatId` | Get full details for a specific session chat |
| `GET` | `/api/sessions/:sessionId/chats/:chatId/context-usage` | Estimate context usage for this session chat |
| `POST` | `/api/sessions/:sessionId/chats/:chatId/messages` | Add user message and get AI response (**SSE stream**) |
| `PATCH` | `/api/sessions/:sessionId/chats/:chatId/name` | Rename a session chat |
| `DELETE` | `/api/sessions/:sessionId/chats/:chatId` | Delete a session chat and its messages |
| `GET` | `/api/sessions/:sessionId/chats/:chatId/verifications` | Get fact-verification verdicts (with nested statements) for all AI messages in a chat |
| `POST` | `/api/sessions/:sessionId/chats/:chatId/verify` | Trigger a single-chat (`single_chat` scope) fact-verification job; returns `{ jobId }` (`202`, `409` if a job is already active) |

---

## Standalone Chats (`standaloneChatRoutes.ts`)

Standalone chat CRUD and message streaming (not bound to a session).

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/chats` | Create a new standalone chat |
| `GET` | `/api/chats` | List all standalone chats (metadata only) |
| `GET` | `/api/chats/:chatId` | Get full details for a standalone chat |
| `GET` | `/api/chats/:chatId/context-usage` | Estimate context usage for this standalone chat |
| `POST` | `/api/chats/:chatId/messages` | Add message and get AI response (**SSE stream**) |
| `PATCH` | `/api/chats/:chatId/details` | Update name and tags for a standalone chat |
| `DELETE` | `/api/chats/:chatId` | Delete a standalone chat |

---

## Analysis (`analysisRoutes.ts`)

Multi-session analysis job creation and streaming progress.

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/analysis-jobs` | Create a new multi-session analysis job |
| `GET` | `/api/analysis-jobs` | List all analysis jobs |
| `GET` | `/api/analysis-jobs/:jobId` | Get status and result of a single analysis job |
| `GET` | `/api/analysis-jobs/:jobId/stream` | Stream analysis logs and tokens (**SSE stream**) |
| `POST` | `/api/analysis-jobs/:jobId/cancel` | Request to cancel a running analysis job |
| `DELETE` | `/api/analysis-jobs/:jobId` | Delete an analysis job and its data |

---

## Verification (`verificationRoutes.ts`)

LLM Fact-Verification & Hallucination Audit ("LLM Judge") job management, analytics, and verdict lookup. Only one verification job may be active at a time — creating a job (or resetting) while another is `pending`/`processing`/`canceling` returns `409 Conflict`.

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/verification/jobs` | Create and enqueue a fact-verification job; returns `{ jobId }` (`202`) |
| `GET` | `/api/verification/jobs` | List recent verification jobs (newest first) |
| `GET` | `/api/verification/jobs/:jobId` | Get status and counters of a single verification job |
| `GET` | `/api/verification/jobs/:jobId/stream` | Stream job progress events (**SSE stream**) |
| `GET` | `/api/verification/jobs/:jobId/failures` | List failed message assessments attributable to one job run (`{ jobId, failures[] }`, `404` if the job does not exist) |
| `POST` | `/api/verification/jobs/:jobId/cancel` | Request cancellation of a pending/processing job (`202`; `409` if already terminal) |
| `GET` | `/api/verification/stats` | Global verification analytics (KPIs, per-model accuracy, trends, session coverage) |
| `GET` | `/api/verification/statements` | List paginated/filterable flagged statements (human-confirmed findings excluded) |
| `POST` | `/api/verification/statements/:statementId/dismiss` | Confirm one finding as not-an-issue; returns the finding plus authoritative parent (`200`; `400` / `404` / `409`, see below) |
| `DELETE` | `/api/verification/messages/:messageId` | Clear the verification (and its statements) for a specific chat message (human confirmations preserved for re-audit) |
| `DELETE` | `/api/verification/reset` | Clear all verifications, statements, jobs, and human confirmations (`409` while a job is active) |

**Create Job Body (`POST /api/verification/jobs`):**
- `scope` (required) — `all_unverified` | `all_force` | `selected_sessions` | `single_chat`.
- `sessionIds` — Required non-empty array when `scope` is `selected_sessions` (each session must exist).
- `chatId` — Required when `scope` is `single_chat` (must be a session-bound chat).
- `skipVerified` — Skip already-verified messages (default `true`).
- Optional Judge LLM overrides — `modelName`, `contextSize`, `thinkingBudget`, `temperature`, `topP`, `repeatPenalty`, `numGpuLayers`, `baseUrl`. Omitted fields fall back to global config, except `temperature` which defaults to `0.3` for deterministic verdict JSON. The resolved config is snapshotted into the job row; job creation never mutates the user's global chat model.

**Stats Query Parameters (`GET /api/verification/stats`):**
- `sessionId`, `model`, `startDate`, `endDate` — Optional filters.
- Response includes `failedMessagesCount` (messages whose latest attempt ended `failed`) and per-session `failedAiMessages` alongside verified counts, plus per-session `predominantModel` (most common chat LLM across the session's verifiable AI messages, `null` when unrecorded).

**Statements Query Parameters (`GET /api/verification/statements`):**
- `verdict`, `severity`, `authoredModel`, `sessionId`, `search`, `limit`, `offset` — Optional filters (`verdict`/`severity` accept comma-separated lists).

**Dismiss Body (`POST /api/verification/statements/:statementId/dismiss`):**

- Body: `{ expectedReviewToken }` — the opaque token from the statement read. Only the statement id + token are client-supplied; verdicts, scores, and parent ids never are.
- Returns `{ statement, verification }`: the original Judge finding plus `review_status: 'confirmed'` / `confirmed_at` / `review_id`, and the full authoritative parent assessment with review-aware effective counts.
- Statuses: `200` (repeats idempotent — same review, original `confirmed_at`); `400` for malformed ids/tokens (fractional/zero/negative/`12abc`, missing/blank token); `404` when the statement id is gone (replaced by a rerun/clear — never applies to a replacement row); `409` for stale tokens, changed answer/question/transcript, non-completed parents, or `supported` statements. `404`/`409` carry an explanation and the client refreshes to the current assessment.
- Every statement read carries `review_status` / `confirmed_at` / `review_id` / `review_token`. Confirmed partial/contradicted/fabricated claims count as supported (claim total unchanged); confirmed omissions leave the active omission count. Raw Judge verdicts are always preserved on the rows.

**Job Outcome Fields (`verification_jobs` rows):**
- `succeeded_messages` / `failed_messages` / `skipped_messages` — Finished-attempt outcome split. `processed_messages` counts finished attempts only (successes + failures).
- `current_phase` (`waiting_for_lock` | `loading_judge` | `checking_message` | `generating` | `retrying` | `finishing`), `current_message_id`, `current_attempt`, `phase_updated_at` — Live phase snapshot for active jobs; cleared on terminal transitions. Reconnects and reloads read these from the SSE snapshot / `GET` endpoints.
- A run where every attempted assessment fails lands on `failed`; a mixed run stays `completed` with an `error_message` starting "Completed with errors: …" and `failed_messages > 0` (clients must render the mixed label, never unqualified success).
- Failed `message_verifications` rows carry a bounded `error_message` plus a machine-readable `error_code` (`empty_output` | `malformed_json` | `truncated_output` | `invalid_structure` | `provider_error` | `context_budget` | `missing_transcript`). `truncated_output` means the Judge demonstrably stopped at its completion cap (cap numbers in the detail); `malformed_json` is unparseable output under the cap.

---

## Search (`searchRoutes.ts`)

Full-text search across transcripts and chat messages via Elasticsearch.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/search` | Search chat messages and transcript paragraphs |

**Query Parameters:**
- `q` - Search query string
- `limit` - Max results (1-100, default: 20)
- `from` - Offset for pagination (default: 0)
- `clientName` - Filter by client name
- `searchType` - Filter by type: `chat`, `transcript`, or `all`

---

## LLM (`llmRoutes.ts`)

Model listing, pulling, loading, and unloading.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/llm/available-models` | List locally available LLM models |
| `POST` | `/api/llm/set-model` | Set active model and context size, trigger load |
| `POST` | `/api/llm/unload` | Unload the currently active model from memory |
| `POST` | `/api/llm/pull-model` | Initiate downloading a new LLM model |
| `GET` | `/api/llm/pull-status/:jobId` | Get status/progress of an ongoing model pull job |
| `POST` | `/api/llm/cancel-pull/:jobId` | Attempt to cancel an ongoing model pull job |
| `POST` | `/api/llm/delete-model` | Delete a locally downloaded LLM model |
| `POST` | `/api/llm/api-token` | Set or clear the global API token used to authenticate against remote LLM endpoints |
| `GET` | `/api/llm/status` | Check loaded status and context sizes for active/specific model |

### Remote LLM API token

A single, globally-stored, optional API token is automatically attached as
`Authorization: Bearer <token>` to every request targeting a non-local
LLM base URL — and to no request targeting the local default. One value
applies to all remote URLs; the user sets/clears it once via the
"Configure AI Model" dialog (or the "Analyze Multiple Sessions" dialog).

**`POST /api/llm/api-token`**

Body:

```json
{ "token": "sk-abc-123" }
```

Pass a non-empty string to set or replace; pass an empty string or
`null` to clear. The response only exposes the new presence state —
the token value itself is never returned:

```json
{ "message": "Remote LLM API token saved.", "hasRemoteApiToken": true }
```

The presence boolean is also surfaced on `GET /api/llm/status` as
`hasRemoteApiToken` so the UI can render the right placeholder
("Token is set — type a new value to replace" vs
"Enter API token (optional)") without ever pulling the credential back
to the client.

### Load attempt state

`POST /api/llm/set-model` returns immediately while the model load runs
in the background, so `GET /api/llm/status` also returns the last load
attempt as `loadState` — the only channel through which a background
load failure reaches the UI:

```json
{
  "status": "failed",
  "modelName": "qwen3.5-2b",
  "error": "Failed to load model 'qwen3.5-2b' via LM Studio API: ...",
  "attemptedAt": "2026-10-18T21:14:09.000Z"
}
```

`status` is `idle` (no attempt yet, or the last attempt succeeded —
loaded truth comes from LM Studio itself), `loading` (attempt in
flight), or `failed` with a human-readable `error` (usually LM Studio's
own message, e.g. `No LM Runtime found for model format 'gguf'`). A new
attempt overwrites the previous record. The state is process-local: a
server restart resets it to idle.

Behaviour:

- The token is persisted in `app_settings.llm_api_token` and survives
  the server's boot-time `clearModelAndContext()` — it is global state,
  not model-derived state.
- The token is read fresh on every API call, so rotation takes effect
  immediately without restarting the API or the worker.
- The local LM Studio daemon is never asked for credentials it cannot
  validate; the `isRemoteLlmBaseUrl(url)` gate is the single source of
  truth.

---

## Transcription (`transcriptionRoutes.ts`)

Whisper service transcription job status.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/transcription/status/:jobId` | Get status of a specific transcription job |

---

## Docker (`dockerRoutes.ts`)

Container status monitoring for project-related services.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/docker/status` | Get status of project-related Docker containers |
| `GET` | `/api/docker/logs/:containerName` | Get recent logs from a specific project container |

---

## Admin (`adminRoutes.ts`)

Database export/import, re-index search, and system reset.

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/admin/reindex-elasticsearch` | Delete and re-index all Elasticsearch data from SQLite |
| `POST` | `/api/admin/reset-all-data` | Reset all application data (destructive) |
| `GET` | `/api/admin/export-data` | Export all application data as a TAR archive |
| `POST` | `/api/admin/import-data` | Import data from a TAR archive (overwrites existing) |

---

## System (`systemRoutes.ts`)

System-level utilities.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/system/gpu-stats` | Get NVIDIA GPU statistics via `nvidia-smi` |

---

## Templates (`templateRoutes.ts`)

Message template CRUD operations.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/templates` | Get all saved templates |
| `POST` | `/api/templates` | Create a new template |
| `PUT` | `/api/templates/:id` | Update an existing template |
| `DELETE` | `/api/templates/:id` | Delete a template |

---

## Jobs (`jobsRoutes.ts`)

Background job queue status.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/jobs/active-count` | Get count of active and waiting background jobs (`{ total, transcription, analysis, verification }`) |
| `POST` | `/api/jobs/reset-transcription` | Force-clear all queued/active transcription jobs (queue obliterate) |

---

## Meta (`metaRoutes.ts`)

Health check and readiness status.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/health` | Check API, Database, and Elasticsearch health |
| `GET` | `/api/status/readiness` | Check if all dependent backend services are ready (returns `200` when ready, `503` when degraded but with structured body) |
| `GET` | `/api/schema` | API schema info (redirects to Swagger UI at `/api/docs`) |

---

## SSE Streaming Endpoints

The following endpoints return Server-Sent Events (SSE) streams:

- `POST /api/sessions/:sessionId/chats/:chatId/messages` - Chat message streaming
- `POST /api/chats/:chatId/messages` - Standalone chat message streaming
- `GET /api/analysis-jobs/:jobId/stream` - Analysis progress streaming
- `GET /api/verification/jobs/:jobId/stream` - Verification job progress streaming (`snapshot` / `status` / `progress` / `phase` / `message_verified` / `complete` / `error` events; `phase` carries the worker lifecycle phase with current message identity, attempt, outcome split, and elapsed ms)
