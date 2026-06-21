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
    - **Action 1:** Worker sends audio path and `numSpeakers` to WhisperX Service via HTTP POST.
    - **Action 2:** Worker polls WhisperX status endpoint until completion.
    - **Action 3:** On success, parses JSON segments into `TranscriptParagraphData`.
    - **Pipeline Details:** The service runs 4 stages: **ASR** (Transcription) -> **Alignment** (Phoneme-level timestamps) -> **Diarization** (Speaker ID) -> **Assignment** (Mapping speakers to text).

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
