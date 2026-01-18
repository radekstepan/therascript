# API Reference

All endpoints are prefixed with `/api/`.

---

## Sessions (`sessionRoutes.ts`)

Session CRUD operations, audio file upload, and transcript access.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/sessions` | List all sessions (metadata only) |
| `POST` | `/api/sessions/upload` | Upload audio file with metadata, start transcription job |
| `GET` | `/api/sessions/:sessionId` | Get session metadata and associated chat list |
| `PUT` | `/api/sessions/:sessionId/metadata` | Update session metadata (clientName, date, etc.) |
| `DELETE` | `/api/sessions/:sessionId` | Delete session, audio files, chats, paragraphs, and ES docs |
| `GET` | `/api/sessions/:sessionId/transcript` | Get structured transcript content (paragraphs) |
| `PATCH` | `/api/sessions/:sessionId/transcript` | Update a specific transcript paragraph |
| `DELETE` | `/api/sessions/:sessionId/transcript/:paragraphIndex` | Delete a single transcript paragraph |
| `GET` | `/api/sessions/:sessionId/audio` | Stream the original session audio file (supports range requests) |
| `DELETE` | `/api/sessions/:sessionId/audio` | Delete only the original audio file |

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

## Ollama (`ollamaRoutes.ts`)

Model listing, pulling, loading, and unloading.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/ollama/available-models` | List locally available Ollama models |
| `POST` | `/api/ollama/set-model` | Set active model and context size, trigger load |
| `POST` | `/api/ollama/unload` | Unload the currently active model from memory |
| `POST` | `/api/ollama/pull-model` | Initiate downloading a new Ollama model |
| `GET` | `/api/ollama/pull-status/:jobId` | Get status/progress of an ongoing model pull job |
| `POST` | `/api/ollama/cancel-pull/:jobId` | Attempt to cancel an ongoing model pull job |
| `POST` | `/api/ollama/delete-model` | Delete a locally downloaded Ollama model |
| `GET` | `/api/ollama/status` | Check loaded status and context sizes for active/specific model |

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
| `GET` | `/api/jobs/active-count` | Get count of active and waiting background jobs |

---

## Meta (`metaRoutes.ts`)

Health check and readiness status.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/health` | Check API, Database, and Elasticsearch health |
| `GET` | `/api/status/readiness` | Check if all dependent backend services are ready |
| `GET` | `/api/schema` | API schema info (redirects to Swagger UI at `/api/docs`) |

---

## SSE Streaming Endpoints

The following endpoints return Server-Sent Events (SSE) streams:

- `POST /api/sessions/:sessionId/chats/:chatId/messages` - Chat message streaming
- `POST /api/chats/:chatId/messages` - Standalone chat message streaming
- `GET /api/analysis-jobs/:jobId/stream` - Analysis progress streaming
