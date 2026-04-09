# System Operational Flows

This document details the step-by-step data flows for the core operations of the application. It maps logical steps to specific files and functions.

## 1. Transcription Pipeline
**Goal:** Convert uploaded audio into searchable text and initialize a chat session.

1.  **Upload Request (UI -> API)**
    *   User uploads file via `UploadModal.tsx`.
    *   `POST /api/sessions/upload` handles the file.
    *   **File:** `packages/api/src/routes/sessionRoutes.ts`
    *   **Action 1:** API checks Whisper diarization readiness (`GET /diarization/check`). If not ready, returns `503` and may trigger a background prefetch (`POST /diarization/prefetch`).
    *   **Action 2:** Audio saved to disk (`fileService.ts`), Session record created in SQLite with status `pending`.

2.  **Job Enqueue (API -> Redis)**
    *   API calls `startTranscriptionJob` service.
    *   Adds a job to `transcription-jobs` queue via BullMQ, including the requested `numSpeakers`.
    *   **File:** `packages/api/src/services/jobQueueService.ts`

3.  **Job Processing (Worker)**
    *   Worker consumes job in `transcriptionProcessor.ts`.
    *   **Action 1:** Worker sends audio path and `numSpeakers` to WhisperX Service via HTTP POST.
    *   **Action 2:** Worker polls WhisperX status endpoint until completion.
    *   **Action 3:** On success, parses JSON segments into `TranscriptParagraphData`.
    *   **Pipeline Details:** The service runs 4 stages: **ASR** (Transcription) -> **Alignment** (Phoneme-level timestamps) -> **Diarization** (Speaker ID) -> **Assignment** (Mapping speakers to text).

4.  **Persistence (Worker -> DB/ES)**
    *   **SQLite:** Paragraphs inserted into `transcript_paragraphs` table (including the `speaker` column) via `transcriptRepository.ts`.
    *   **Elasticsearch:** Paragraphs indexed into `therascript_transcripts` index (including the `speaker` field) via `bulkIndexDocuments`.
    *   **Status:** Session status updated to `completed`.
    *   **Initialization:** An initial "AI" message is created in the `messages` table and indexed to ES to start the chat history.

## 2. Speaker Rename Flow
**Goal:** Replace auto-detected speaker labels (for example `SPEAKER_00`) with user-defined names.

1.  **Rename Request (UI -> API)**
    *   User opens `RenameSpeakersModal.tsx` from session transcription actions.
    *   UI sends `PATCH /api/sessions/:sessionId/speakers` with `[{ from, to }]` pairs.

2.  **Write Through (API -> SQLite/ES)**
    *   API validates entries and skips no-op renames.
    *   SQLite update via `transcriptRepository.renameSpeaker`.
    *   Elasticsearch update via `updateByQuery` on `therascript_transcripts`.

3.  **UI Refresh**
    *   On success, transcript/session queries are invalidated and reloaded.

## 3. Interactive Chat Pipeline (RAG)
**Goal:** Answer user questions based on the session transcript.

1.  **User Message (UI -> API)**
    *   User types in `ChatInput.tsx`.
    *   `POST /api/sessions/:id/chats/:id/messages` called.
    *   **File:** `packages/api/src/api/sessionChatHandler.ts`

2.  **Context Assembly (API)**
    *   User message saved to SQLite and indexed to ES (`messageRepository.ts`).
    *   Full transcript text fetched from SQLite (`transcriptRepository.ts`).
    *   Chat history fetched from SQLite.
    *   **Context Calculation:** `contextUsageService.ts` checks if content fits the model's window.

3.  **LLM Inference (API -> LM Studio)**
    *   API streams the assembled context (System Prompt + Transcript + History + User Msg) to LM Studio.
    *   **File:** `packages/api/src/services/llamaCppService.ts` -> `streamChatResponse`.

4.  **Response Streaming (API -> UI)**
    *   API pipes LM Studio's SSE stream back to the UI.
    *   UI updates the message bubble in real-time (`useMessageStream.ts`).

5.  **Finalization**
    *   Once stream completes, the full AI response is saved to SQLite and indexed to Elasticsearch.

## 4. Multi-Session Analysis (MapReduce)
**Goal:** Answer a high-level question across multiple selected sessions.

1.  **Job Creation (UI -> API)**
    *   User selects sessions and provides a prompt in `CreateAnalysisJobModal.tsx`.
    *   `POST /api/analysis-jobs` creates a job record (`analysis_jobs` table).
    *   **Strategy Generation:** The API asks the LLM to generate a JSON strategy (Intermediate Question + Final Instructions).
    *   **File:** `packages/api/src/api/analysisHandler.ts`.

2.  **Map Phase (Worker)**
    *   Worker picks up the job (`analysisProcessor.ts`).
    *   Iterates through every selected session.
    *   **Input:** Session Transcript + Intermediate Question (from Strategy).
    *   **Output:** Generates an `IntermediateSummary` using the LLM.
    *   **Storage:** Saves summary to `intermediate_summaries` table.

3.  **Reduce Phase (Worker)**
    *   Worker aggregates all successful intermediate summaries.
    *   **Input:** All Summaries + Final Synthesis Instructions (from Strategy).
    *   **Output:** Generates final answer using the LLM.
    *   **Storage:** Updates `analysis_jobs` with `final_result` and `status: completed`.

4.  **Real-time Updates (Redis Pub/Sub)**
    *   Throughout Map and Reduce, the worker publishes token chunks to a Redis channel.
    *   The UI listens via SSE (`/api/analysis-jobs/:id/stream`) to display live progress.

## 5. Transcription Queue Reset
**Goal:** Recover quickly from stuck or corrupted transcription queue states.

1.  **Admin Action (UI -> API)**
    *   User confirms reset action from `SettingsPage.tsx`.
    *   UI calls `POST /api/jobs/reset-transcription`.

2.  **Queue Obliterate (API -> Redis/BullMQ)**
    *   API handler calls `resetTranscriptionQueue` in `jobQueueService.ts`.
    *   BullMQ executes `transcriptionQueue.obliterate({ force: true })`.

3.  **Aftermath**
    *   Queued and active transcription jobs are removed.
    *   Sessions that were in-flight remain in pending/transcribing metadata state until manually re-queued.
