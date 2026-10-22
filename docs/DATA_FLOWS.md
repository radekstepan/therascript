# System Operational Flows

This document details the step-by-step data flows for the core operations of the application. It maps logical steps to specific files and functions.

## 1. Transcription Pipeline

**Goal:** Convert uploaded audio into searchable text and initialize a chat session.

1.  **Upload Request (UI -> API)**

    - User uploads file via `UploadModal.tsx`.
    - `POST /api/sessions/upload` handles the file.
    - **File:** `packages/api/src/routes/sessionRoutes.ts`
    - **Action 1:** API checks Whisper diarization readiness (`GET /diarization/check`). If not ready, returns `503` and may trigger a background prefetch (`POST /diarization/prefetch`).
    - **Action 2:** Audio saved to disk (`fileService.ts`), Session record created in SQLite with status `pending`.

2.  **Job Enqueue (API -> Redis)**

    - API calls `startTranscriptionJob` service.
    - Adds a job to `transcription-jobs` queue via BullMQ, including the requested `numSpeakers`.
    - **File:** `packages/api/src/services/jobQueueService.ts`

3.  **Job Processing (Worker)**

    - Worker consumes job in `transcriptionProcessor.ts`.
    - **Action 1:** Worker sends audio path and `numSpeakers` to the Transcription Service via HTTP POST.
    - **Action 2:** Worker polls the transcription status endpoint until completion.
    - **Action 3:** On success, parses JSON segments into `TranscriptParagraphData`.
    - **Pipeline Details:** The service runs 3 stages: **ASR** (Parakeet transcription with native word timestamps — no alignment stage) -> **Diarization** (Community-1, exclusive speaker stream) -> **Attribution** (mapping words to speakers). See `docs/TRANSCRIPTION_BACKENDS.md`.

4.  **Persistence (Worker -> DB/ES)**
    - **SQLite:** Paragraphs inserted into `transcript_paragraphs` table (including the `speaker` column) via `transcriptRepository.ts`.
    - **Elasticsearch:** Paragraphs indexed into `therascript_transcripts` index (including the `speaker` field) via `bulkIndexDocuments`.
    - **Status:** Session status updated to `completed`.
    - **Initialization:** An initial "AI" message is created in the `messages` table and indexed to ES to start the chat history.

## 2. Speaker Rename Flow

**Goal:** Replace auto-detected speaker labels (for example `SPEAKER_00`) with user-defined names.

1.  **Rename Request (UI -> API)**

    - User opens `RenameSpeakersModal.tsx` from session transcription actions.
    - UI sends `PATCH /api/sessions/:sessionId/speakers` with `[{ from, to }]` pairs.

2.  **Write Through (API -> SQLite/ES)**

    - API validates entries and skips no-op renames.
    - SQLite update via `transcriptRepository.renameSpeaker`.
    - Elasticsearch update via `updateByQuery` on `therascript_transcripts`.

3.  **UI Refresh**
    - On success, transcript/session queries are invalidated and reloaded.

## 3. Interactive Chat Pipeline (RAG)

**Goal:** Answer user questions based on the session transcript.

1.  **User Message (UI -> API)**

    - User types in `ChatInput.tsx`.
    - `POST /api/sessions/:id/chats/:id/messages` called.
    - **File:** `packages/api/src/api/sessionChatHandler.ts`

2.  **Context Assembly (API)**

    - User message saved to SQLite and indexed to ES (`messageRepository.ts`).
    - Full transcript text fetched from SQLite (`transcriptRepository.ts`).
    - Chat history fetched from SQLite.
    - **Context Calculation:** `contextUsageService.ts` checks if content fits the model's window.

3.  **LLM Inference (API -> LM Studio)**

    - API streams the assembled context (System Prompt + Transcript + History + User Msg) to LM Studio.
    - **File:** `packages/api/src/services/llamaCppService.ts` -> `streamChatResponse`.
    - **Stored-reasoning isolation:** before sending, chat history is passed through `prepareLlmChatMessages` (`packages/services/src/thinking.ts`), which extracts visible answers from assistant turns via `extractVisibleAnswer`, drops reasoning-only turns, and merges adjacent user turns. The same safeguard runs again inside `streamLlmChatDetailed` so every caller (chat, analysis, future flows) is covered. Stored `<think>…</think>` reasoning is for display/debugging only; only visible answers may be reused as prompt context. User/system text (transcripts, questions) always passes through verbatim.

4.  **Response Streaming (API -> UI)**

    - API pipes LM Studio's SSE stream back to the UI.
    - UI updates the message bubble in real-time (`useMessageStream.ts`).

5.  **Finalization**
    - Once stream completes, the full AI response is saved to SQLite and indexed to Elasticsearch.

## 4. Multi-Session Analysis (MapReduce)

**Goal:** Answer a high-level question across multiple selected sessions.

1.  **Job Creation (UI -> API)**

    - User selects sessions and provides a prompt in `CreateAnalysisJobModal.tsx`.
    - `POST /api/analysis-jobs` creates a job record (`analysis_jobs` table).
    - **Strategy Generation:** The API asks the LLM to generate a JSON strategy (Intermediate Question + Final Instructions).
    - **LLM Param Snapshot:** At job-creation time the API reads the current "Set Model" configuration (`temperature`, `top_p`, `repeat_penalty`, `num_gpu_layers`, `thinking_budget`) from `activeModelService` and persists them onto the `analysis_jobs` row. This is necessary because the worker runs as a separate process with its own empty in-memory state and cannot read the API's live config.
    - **File:** `packages/api/src/api/analysisHandler.ts`.

2.  **Map Phase (Worker)**

    - Worker picks up the job (`analysisProcessor.ts`).
    - Iterates through every selected session.
    - **Input:** Session Transcript + Intermediate Question (from Strategy).
    - **Output:** Generates an `IntermediateSummary` using the LLM, honouring the snapshotted params from the job record.
    - **Completion Token Cap:** Capped at **25% of `context_size`** (e.g. 8,192 tokens on a 32k context). This gives thinking models enough headroom for their reasoning chain while preventing runaway generation across many sessions. Falls back to 25% of 8,192 if `context_size` is null.
    - **Storage:** Saves summary to `intermediate_summaries` table.

3.  **Reduce Phase (Worker)**

    - Worker aggregates all successful intermediate summaries.
    - **Input:** All Summaries + Final Synthesis Instructions (from Strategy).
    - **Output:** Generates final answer using the LLM.
    - **Completion Token Cap:** Capped at **40% of `context_size`** — more headroom than Map since the synthesis answer is expected to be longer (e.g. 13,107 tokens on a 32k context).
    - **Storage:** Updates `analysis_jobs` with `final_result` and `status: completed`.
    - **Stored-reasoning isolation:** `assembleReducePrompt` extracts the visible answer from every stored summary via the shared `extractVisibleAnswer` helper before embedding it, so legacy/imported rows with `<think>` reasoning need no migration. Reasoning-only summaries are excluded (their sessions are not claimed); if none remain usable the job fails with the existing failure semantics instead of synthesizing from reasoning.

4.  **Thinking Token Streaming**

    - Both Map and Reduce phases detect `thinking` chunks from the LLM (native `reasoning_content` field or inline `<think>…</think>` tags).
    - Thinking content is published to Redis as separate `type: 'thinking'` stream events, distinct from `type: 'token'` content events.
    - The UI hook `useAnalysisStream.ts` accumulates thinking tokens in `mapThinkingLogs` / `reduceThinkingLog` state, separate from the main text logs.
    - The `<think>…</think>` envelope is stripped before the emptiness guard so a thinking-only LLM output does not cause a false "empty result" error.

5.  **Real-time Updates (Redis Pub/Sub)**
    - Throughout Map and Reduce, the worker publishes token and thinking chunks to a Redis channel.
    - The UI listens via SSE (`/api/analysis-jobs/:id/stream`) to display live progress.

## 5. Transcription Queue Reset

**Goal:** Recover quickly from stuck or corrupted transcription queue states.

1.  **Admin Action (UI -> API)**

    - User confirms reset action from `SettingsPage.tsx`.
    - UI calls `POST /api/jobs/reset-transcription`.

2.  **Queue Obliterate (API -> Redis/BullMQ)**

    - API handler calls `resetTranscriptionQueue` in `jobQueueService.ts`.
    - BullMQ executes `transcriptionQueue.obliterate({ force: true })`.

3.  **Aftermath**
    - Queued and active transcription jobs are removed.
    - Sessions that were in-flight remain in pending/transcribing metadata state until manually re-queued.

## 6. Chat Cancellation & Model Unload (UI-Triggered)

**Goal:** Free the LM Studio model's VRAM/RAM as soon as the user clicks **STOP** mid-generation.

1.  **User Clicks STOP (UI)**

    - `ChatInput.tsx` swaps the send button for a red `StopIcon` while `isAiResponding` is true.
    - Click invokes `handleCancelStream` in `ChatInterface.tsx`.
    - **File:** `packages/ui/src/components/SessionView/Chat/ChatInterface.tsx`.

2.  **Abort the In-Flight Browser Fetch**

    - `currentJob.controller.abort()` — the AbortController was attached to the `fetch` signal in `addSessionChatMessageStream` / `addStandaloneChatMessageStream`.
    - The browser closes the SSE connection to the API. The local AI-message bubble is marked `canceling`.

3.  **Trigger Model Unload from the UI**

    - **CRITICAL:** Because of a bug in Elysia 1.2.25's web-standard adapter (`node_modules/elysia/dist/adapter/web-standard/handler.mjs` line 262), the abort listener condition `!request?.signal?.aborted` is inverted. The listener never cancels the handler's `ReadableStream`, so the server-side `ReadableStream.cancel()` callback does **not** fire on SSE disconnect. Server-side abort hooks (in `sessionChatHandler.ts` / `standaloneChatHandler.ts`) therefore cannot detect the cancellation through the normal channel.
    - **Workaround:** 500ms after the abort, the UI calls `POST /api/llm/unload` directly via `unloadLlmModel()` from `packages/ui/src/api/llm.ts`. The 500ms gives the LM Studio compute thread time to release the model lock after the upstream TCP socket closes.
    - **File:** `packages/api/src/routes/llmRoutes.ts` — the existing `/api/llm/unload` endpoint.

4.  **Server Unload**
    - `unloadActiveModel()` (`llamaCppService.ts`) lists loaded instances via `GET /api/v1/models`, then `POST`s to `/api/v1/models/unload` for each.
    - On success, the model is freed from LM Studio memory.

### Server-Side Safety Net (currently inert)

`sessionChatHandler.ts` and `standaloneChatHandler.ts` also wire three abort hooks that all call a guarded `triggerUnload()`:

1.  `request.signal?.addEventListener('abort', …)`
2.  `ReadableStream.cancel()` callback
3.  `processStream` `finally` block (checks `llmAbortController.signal.aborted`)

## 7. Local vs. Remote LLM Streaming

**Goal:** Ensure token-by-token streaming parity between a local LM Studio (loopback) and a remote LM Studio (LAN/WAN).

**Observation:** Streaming appears to work fine against a local LM Studio but appears buffered (single "loading… then full response") against a remote one.

**Root cause:** The Therascript code path is **identical** for local and remote — both flow through `streamLlmChatDetailed` (`packages/services/src/llamaCppClient.ts`) → `addStandaloneChatMessage` / `addSessionChatMessage` → `server.ts` `for await` + `res.write`. The buffering observed against a remote model happens at one of these layers, not in Therascript:

1. **LM Studio's HTTP server** — its loopback writer flushes per-token; its network writer coalesces small SSE writes until the kernel send buffer fills. This is a well-known llama.cpp server behavior.
2. **A network device or proxy on the path between API and remote LM Studio** (less common, but possible).

**Therascript-side hardening (already in place):**

- `server.ts:127-138` calls `res.flushHeaders()` immediately after `res.writeHead`, so the response status + headers go out on the first event-loop tick and any proxy in front of the API sees the response begin right away.
- `server.ts:142-145` calls `res.flush?.()` (no-op on plain `http.ServerResponse`, present on compression wrappers) after each chunk write.
- The SSE handlers (`standaloneChatHandler.ts`, `sessionChatHandler.ts`) send `X-Accel-Buffering: no` and `Cache-Control: no-cache, no-transform` so nginx / Tailscale Funnel / Cloudflare do not buffer the response.
- `streamLlmChatDetailed` and the SSE handlers each `await new Promise(setImmediate)` between chunks. This yields the event loop so the consumer's socket write is drained immediately rather than being coalesced with the next write in the same microtask. On a loopback socket this is invisible; on a non-loopback socket it is the change that turns "all chunks at once" into token-by-token delivery.

**Diagnostic logging:**

Every chat stream now logs chunk cadence to the API console:

```
[API SSE 5] chunk #1 +0.04s
[API SSE 5] chunk #20 +1.18s
[API SSE 5] chunk #40 +2.31s
[API SSE 5] LLM done +8.4s total, 142 content chunks, 0 thinking chunks
```

- If the log shows chunks arriving in real time, the API is forwarding correctly and any remaining buffering is in LM Studio or the network.
- If the log shows a single burst of chunks near the end (e.g. `chunk #1 +0.04s` then `chunk #400 +12s`), the buffering is upstream of the API and cannot be fixed from Therascript. The next step in that case is to look at LM Studio's own HTTP server flush behavior.

These do not fire under Elysia 1.2.25 (the bug above). They are kept so that if Elysia is upgraded to a fixed version, the unload starts working on the server side without further code changes. `triggerUnload` has a `modelUnloaded` guard, so the UI-driven call and any future server-side call are mutually safe.

## 8. Process Shutdown & Model Unload

**Goal:** Free LM Studio VRAM/RAM on both the local daemon and any remote LM Studio host whenever the user stops the app — via the UI **Shutdown App** button, a terminal **Ctrl+C** in the wrapper script, or a direct signal to the API/worker process.

### 8.1 Loaded-Model Tracker

Every successful `POST /api/v1/models/load` (in either the API process or the analysis-worker process) records `baseUrl + instance_id` in a process-local registry:

- `packages/api/src/services/loadedModelsTracker.ts` — used by the API.
- `packages/worker/src/jobs/loadedModelsTracker.ts` — used by the worker.

Successful unloads remove the entry. The registry is the source of truth for "which URLs is this process keeping models loaded on right now?" — needed because a remote URL used for a per-request analysis job is not the "active" base URL the API normally tracks, so the active-URL unload alone would miss it.

### 8.2 API Shutdown (`server.ts:242`)

On `SIGINT` / `SIGTERM` the API runs `shutdown(signal)`:

1. Close the HTTP listener (`server.close`).
2. `unloadActiveModel()` — unloads the active base URL.
3. For each remaining URL in the loaded-models tracker, call `unloadModelAtUrl(url)`. This catches per-request remote URLs.
4. `runtime.stop()` — only meaningful for the local `lms` daemon (remote hosts are intentionally not killed).
5. Close BullMQ queues, SQLite, Elasticsearch client.
6. `process.exit(...)`.

For a remote URL the unload path is identical to local: `GET /api/v1/models` to enumerate, then `POST /api/v1/models/unload { instance_id }` per instance. The LM Studio REST API is symmetric for local and remote.

### 8.3 Worker Shutdown (`packages/worker/src/index.ts:90`)

On `SIGINT` / `SIGTERM` the worker:

1. Closes all three BullMQ workers (`transcriptionWorker.close()`, `analysisWorker.close()`, `verificationWorker.close()`).
2. For each URL in its own loaded-models tracker, calls `unloadModelAtUrlForWorker(url)`. This is what unloads a per-job remote URL the API process never knew about.
3. Closes the SQLite, Elasticsearch, and Redis-publisher connections.
4. `process.exit(0)`.

### 8.4 Wrapper Scripts (`scripts/run-dev.js`, `scripts/run-prod.js`)

The wrapper scripts (which spawn `concurrently` for the API, UI, worker, whisper-manager, and ES-manager) used to `SIGKILL` the entire process group on shutdown, which bypassed the graceful handlers above. The current behavior is:

1. **SIGTERM** the concurrently process group (negative PID, so all children receive the signal).
2. **Wait up to 5 seconds** for the group to exit (`waitForProcessExit` polls the `exit` event).
3. If still alive, escalate to **SIGKILL** as a hard fallback.
4. Run the local-only `cleanupLmsDaemon()` (`lms daemon down`) and Docker/UI cleanup as belt-and-suspenders.

The 5-second grace period is the window in which the API and worker run their `unloadActiveModel` / `unloadModelAtUrl` / `runtime.stop` calls. On the UI **Shutdown App** path (which posts to the wrapper's port-9999 service) and on terminal **Ctrl+C** (which concurrently forwards), both paths now produce the same outcome: local + remote models get freed, the `lms` daemon is taken down, and the process tree exits cleanly.

The Windows path (`taskkill /T /F`) is unchanged — Windows does not have a graceful signal equivalent and the wrapper falls back to force kill there.

### 8.5 Restart (`/restart` proxy endpoint)

The wrapper exposes a sibling `/restart` endpoint on the same port-9999 service that `/shutdown` uses. It is plumbed through the same shutdown pipeline but, instead of exiting the wrapper script, re-enters `main()` to spawn a fresh `concurrently` group.

Flow:

1. The UI's sidebar split-button posts to `/restart` (proxied to the wrapper by webpack during dev, or by the production front-end server).
2. The wrapper's request handler calls `handleShutdown('API_RESTART_REQUEST', isRestart=true)`.
3. `handleShutdown` runs the **exact same teardown** as a shutdown: SIGTERM the concurrently group, wait 5s, SIGKILL fallback, `cleanupLmsDaemon`, Docker container stop+remove, UI-port cleanup. This is the same code path that gives `/shutdown` a clean exit, so all model-unload and connection-close guarantees from §8.1–§8.4 carry over.
4. Instead of `process.exit(0)`, the handler then sets `devProcess = null`, flips `isShuttingDown` back to `false`, and invokes `main()` again. The new `main()` first closes any leftover `shutdownHttpServer` from the previous lifecycle (avoids `EADDRINUSE` on port 9999), then re-runs Redis health, respawns the concurrently group, and re-registers the shutdown service.
5. The UI's `ReadinessOverlay` (`App.tsx:50`) appears the moment `/api/status/readiness` starts failing, and disappears once the new API comes back healthy. There is no separate "Restarting" screen — the existing "System Initializing" overlay is reused.

The `currentProcess !== devProcess` guard in the concurrently event handlers is the safety net that prevents a stale `close` event from the old process from triggering cleanup during the restart window.

## 9. Fact Verification / Hallucination Audit (LLM Judge)

**Goal:** Audit session-bound AI chat responses against the ground-truth session transcript, record per-claim verdicts, and surface them in the `/verification` hub and inline in chat bubbles.

1.  **Job Creation (UI -> API)**

    - User launches an audit from `StartVerificationModal.tsx` (scope picker + Judge LLM settings). The session chat header shows only a passive all-verified status icon (`ChatVerifiedStatusIcon.tsx`); it never starts verification.
    - `POST /api/verification/jobs` (or `POST /api/sessions/:id/chats/:chatId/verify`) creates a `verification_jobs` row (`verification_jobs` table).
    - **Single-job guard:** `createVerificationJobRecord` refuses with `409 Conflict` when `verificationRepository.hasActiveVerificationJobs()` is true (a job is `pending`/`processing`/`canceling`).
    - **LLM Param Snapshot:** like analysis jobs, the API snapshots the Judge config (`model_name`, `context_size`, `thinking_budget`, `temperature` defaulting to `0.3`, `top_p`, `repeat_penalty`, `num_gpu_layers`, `llm_base_url`) into the job row. Job creation never mutates the user's global chat model — the worker loads the Judge model itself when it picks the job up, then adopts it as the active settings (see step 3).
    - **File:** `packages/api/src/api/verificationHandler.ts`.

2.  **Job Enqueue (API -> Redis)**

    - API calls `addVerificationJob({ jobId })`.
    - Adds a job to the `verification-jobs` queue via BullMQ (`VERIFICATION_QUEUE_NAME` in `@therascript/queue`).
    - **File:** `packages/api/src/services/jobQueueService.ts`

3.  **Per-Message Audit (Worker)**

    - Worker picks up the job in `processVerificationJob` (`packages/worker/src/jobs/verificationProcessor.ts`), wrapped in `runWithLlmWorkerLock` (`llmWorkerMutex.ts`) so it never loads/unloads models concurrently with an analysis job.
    - Loads the snapshotted Judge model via `loadLlmModelForWorker` (thinking budget passed through uncapped via `resolveJudgeThinkingBudget`, default `-1` = unrestricted; a previous/differing model is evicted at load time, like Session Chat). Once the model is confirmed loaded, the worker adopts its config into the global `app_settings` (best-effort, range-guarded via `buildJudgeActiveSettingsUpdate`), so chat and the next Fact Check start with settings preset and reuse the warm model instead of evicting it — including mid-audit.
    - Iterates candidate AI messages newest-first (skipping already-verified unless `skipVerified` is false), polling job status before each message for cooperative cancellation:
        - **Greeting fast-path:** trivial conversational messages (`isTrivialConversationalMessage`) complete with zero LLM calls.
        - **Judge call:** transcript context is budgeted per message (`selectJudgeTranscriptContext`, `showSpeakers`-aware `[P#<index> MM:SS]` formatting) and sent with the therapist question + visible AI answer to the Judge LLM under the `system_verification_judge` prompt. The Judge returns atomic claims (`supported` / `partially_supported` / `contradicted` / `fabricated`), omissions, severity, and transcript evidence.
        - **JSON repair:** raw output is parsed with control-character/trailing-comma sanitization (`sanitizeJsonForParse`); on failure the worker retries once at `temperature: 0.1` with thinking unchanged. Runaway first attempts (filled the completion cap, or ≥16k unparseable completion tokens per `detectJudgeRunaway`) get a compact-verdict reminder under a fail-fast cap (`resolveJudgeRetryCompletionBudget` = `min(original, 8k)`); attempts that demonstrably stopped at the cap persist as `truncated_output` with cap numbers instead of `malformed_json`. Usage logs and token counts are persisted even when parsing fails.
        - **Span resolution:** each `exact_quote` is mapped to `start_char`/`end_char` in the message (`locateQuoteSpan`) for inline highlighting.
        - **Evidence hydration:** LLM-guessed `timestampMs`/`speaker` are overwritten with ground-truth `transcript_paragraphs` values (`hydrateEvidenceItem`); unresolvable citations are nulled.
        - **Persistence:** a `message_verifications` row (accuracy score via `computeVerificationAccuracy`) plus `verified_statements` rows; job counters (`processed_messages`, `flagged_statements`, ...) advance.
    - **Outcome semantics:** every finished attempt is tallied as `succeeded` or `failed` (`succeeded_messages` / `failed_messages` / `skipped_messages` on the job row, migration V21). A run where every attempted assessment fails lands on `failed`; a mixed run stays `completed` but persists a "Completed with errors: X of Y checked, Z failed" summary plus the split counts (the UI renders the mixed label from `failed_messages > 0`, never unqualified success); canceled runs persist `skipped_messages` for unattempted candidates; zero-candidate runs complete cleanly with no error summary. Per-message failures persist a bounded `error_message` (job/message IDs, Judge model, phase/attempt, duration, token usage — never transcripts or raw reasoning) plus a machine-readable `error_code` (`empty_output` / `malformed_json` / `truncated_output` / `invalid_structure` / `provider_error` / `context_budget` / `missing_transcript`).
    - Keeps the Judge model loaded with its context on every terminal path (no `finally` unload); marks the job `completed` / `failed` / `canceled`. The retained model is evicted only by worker shutdown (`loadedModelsTracker`), an explicit unload, or a later job/chat that loads a different model.

4.  **Real-time Updates (Redis Pub/Sub -> SSE)**

    - The worker publishes `status` / `progress` / `phase` / `message_verified` / `complete` / `error` events to Redis channel `verification-stream:<jobId>` (`@therascript/queue` `VerificationStreamEvent`). `processed_messages` counts finished attempts only; the separate `phase` events (`waiting_for_lock` / `loading_judge` / `checking_message` / `generating` / `retrying` / `finishing`, with current message identity, 1-based message index, attempt, outcome split, and elapsed ms) show truthful indeterminate activity while generation legitimately holds the counter flat. The live phase is also snapshotted onto the job row (`current_phase`, `current_message_id`, `current_attempt`, `phase_updated_at`; cleared on terminal transitions) so SSE snapshots and refetches stay understandable across reconnects and reloads.
    - The UI consumes them via `GET /api/verification/jobs/:jobId/stream` (SSE, `streamVerificationJobHandler` -> `subscribeToVerificationStream`) using the `useVerificationStream.ts` hook, which invalidates the `verificationStats` / `verificationJobs` / `chatVerifications` / `verificationStatements` queries as messages finish. Only `message_verified` and terminal events invalidate — the high-frequency `progress` / `phase` telemetry ticks (~3/sec during generation) merge into local banner state without refetching, so dashboard queries never strobe mid-audit. Socket trouble (`connectionLost`) reconciles through the existing polling/refetch path and is reported separately from Judge failures (`streamError`).

5.  **Verdict Display (UI)**

    - **Audit hub:** `/verification` (`VerificationAuditPage.tsx`) shows the live job banner (progress + live phase + checked/failed counts), a persistent terminal result for the last failed/mixed run, analytics (KPIs, per-model accuracy, trends), and Issues / Coverage / Job History tabs with deep links into session chats.
    - **Inline highlights:** `highlightVerifiedStatements.ts` resolves worker `start_char`/`end_char` spans (falling back to normalized quote search) and wraps matches in `<mark>` elements in both plain-text and Markdown (`rehypeHighlightStatements`) rendering paths; clicking a highlight opens `StatementVerdictModal.tsx` with transcript evidence whose `¶N` references link to `#paragraph-N` in the session transcript (same-page hash, so chat context is preserved; small screens auto-switch to the Transcript tab).
    - **Failed states:** messages with `status = 'failed'` render a failure badge with the specific persisted category (e.g. "Invalid Judge JSON", falling back to "Fact-check failed" for legacy rows), the full bounded error in the tooltip, and a Clear action; coverage/stats surfaces expose `failedAiMessages` / `failedMessagesCount` with one-click retry (`skipVerified: true`). Job History renders mixed runs as "Completed with errors" and offers "View details" (`GET /api/verification/jobs/:jobId/failures` via `JobFailuresDialog.tsx`) with per-message reasons and session/chat/note links.
