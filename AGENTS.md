# Therascript Agents & Workflows

This document outlines the autonomous and semi-autonomous agents operating within the Therascript ecosystem. The system utilizes a combination of background workers (BullMQ), specialized API handlers, and LLM-driven strategies to process therapy sessions.

## 0. Prerequisites

- **Node 23.10.0 exactly** (see `.nvmrc`). `better-sqlite3@11.x` does not publish prebuilt binaries for Node 24+, so running on a newer Node will silently leave the native binding unbuilt and the API will fail to start with `Could not connect or initialize database`. Run `nvm use` before `yarn install`.
- `yarn install` runs `scripts/check-native-bindings.mjs` via the `postinstall` hook. If it exits non-zero, your environment is wrong — do **not** bypass it with `--ignore-scripts`.

## 📖 System Documentation

For detailed implementation references, please see:

- **[Architecture](docs/ARCHITECTURE.md)**: High-level system architecture, package organization, and infrastructure.
- **[Component Map](docs/COMPONENT_MAP.md)**: Breakdown of packages, libraries, and entry points.
- **[Navigation Guide](docs/NAVIGATION.md)**: "Where to change what" – directory structure and common tasks.
- **[API Reference](docs/API_REFERENCE.md)**: Complete REST API endpoint documentation.
- **[Operational Flows](docs/DATA_FLOWS.md)**: Step-by-step data flow for Vault, Transcription, Chat, Analysis, and Fact Verification.
- **[Schema Reference](docs/SCHEMA_REFERENCE.md)**: SQLite tables, FTS5 indexes, and Elasticsearch indices.
- **[Vault README](packages/vault/README.md)**: Vault formats, worker supervision, migration, and security notes.

## 1. Background Workers

Located in `packages/worker`, these agents run asynchronously to handle heavy computational tasks.

### Vault Runtime & Worker Supervision

- **Boot:** the API boots in **vault mode** whenever the cipher-capable SQLite binding is available. HTTP starts with the vault `locked`; the database is not attached until the user enters the password (or completes first-run setup). The password is also the encryption key and is never stored on disk, in env files, logs, or Redis.
- **Worker handoff:** after setup/unlock, the API supervises the real worker process and sends the data keys over an inherited private pipe (fd 3), never argv/env. A standalone `yarn dev:worker` / `yarn start:worker:prod` is legacy-only: it exits 0 with a notice when a vault exists or vault support is available, because only the API can supply keys.
- **Search/storage:** vault mode stores the database and recordings encrypted and serves search from in-database SQLite FTS5 tables; Elasticsearch is skipped entirely. Legacy-fallback boots (no cipher support, no vault) keep the plaintext database and Elasticsearch path.
- **Sessions:** browser tokens are memory-only and compared in constant time. The `HttpOnly` cookie persists for 30 days so a reload/reopen does not re-prompt while the API keeps running; every API restart revokes all tokens, so the password is required again.
- **Shutdown:** `server.close()` starts, `VaultManager.prepareShutdown()` drains in-flight requests and aborts SSE streams, model unload runs while the DB is still open (it reads LLM settings), then `VaultManager.shutdown()` stops the supervised worker, closes the database, clears keys, and revokes all sessions. The wrapper allows 25s before `SIGKILL` (the API has its own 25s backstop).

### Transcription Agent

- **Type:** BullMQ Worker (`transcription-jobs`)
- **Source:** `packages/worker/src/jobs/transcriptionProcessor.ts`
- **Responsibility:** "The Ears" (Now with Diarization)
- **Workflow:**
  1.  Receives `sessionId` and `numSpeakers` from the API after file upload. The API refuses (409) while analysis/verification jobs are queued/running, evicts the local LLM (active URL + stale local model), and verifies zero loaded instances before enqueueing; the worker re-checks all three at job start (GPU exclusion: local LLM xor transcription).
  2.  Fetches audio path from SQLite.
  3.  Submits audio to the **Transcription Service** (`packages/whisper`: Parakeet ASR + Community-1 diarization) and polls for completion. The container unloads the LLM at job start (`LLM_UNLOAD_URL`, loud WARNING when unconfirmed) and OOM errors carry an actionable hint.
  4.  **Post-Processing:**
      - The pipeline runs 3 stages: **Transcribe** (Parakeet ASR fp16 on CUDA with native word timestamps — no alignment stage), **Diarize** (speaker identification via pyannote Community-1 chunked windows with overlap label alignment, exclusive stream; Parakeet unloads first so peaks are sequential), and **Attribute** (mapping words to speakers via `packages/whisper/pipeline/attribution.py`).
      - Parses enriched segments into time-stamped paragraphs, splitting on speaker changes.
      - Calculates token counts.
      - Indexes paragraphs into **Elasticsearch** (`therascript_transcripts`) in legacy mode, or the in-database SQLite FTS5 index in vault mode, including the `speaker` label.
      - Creates the initial "AI" chat message in the database.
- **Infrastructure:** Depends on GPU availability (via transcription Docker container/CUDA) or CPU (slower). Requires `HF_TOKEN` with accepted Community-1 conditions for diarization model weights.

### Analysis Agent (The Researcher)

- **Type:** BullMQ Worker (`analysis-jobs`)
- **Source:** `packages/worker/src/jobs/analysisProcessor.ts`
- **Responsibility:** "The Analyst" (MapReduce Engine)
- **Workflow:**
  1.  Receives a `jobId` and a defined **Strategy** (JSON plan).
  2.  **Map Phase:** Iterates through every selected session transcript.
      - Context: The specific session transcript.
      - Prompt: The `intermediate_question` defined by the Strategy Agent.
      - Output: Stores an `IntermediateSummary` for that session.
  3.  **Reduce Phase:** Aggregates all intermediate summaries chronologically.
      - Context: The collection of summaries.
      - Prompt: The `final_synthesis_instructions` defined by the Strategy Agent.
      - Output: Generates the final answer to the user's high-level query.

### Verification Agent (The Fact-Checker / Judge)

- **Type:** BullMQ Worker (`verification-jobs`)
- **Source:** `packages/worker/src/jobs/verificationProcessor.ts`
- **Prompt Template:** `system_verification_judge` (in `packages/db/src/sqliteService.ts`, with a `DEFAULT_VERIFICATION_JUDGE_PROMPT` fallback in the processor)
- **Responsibility:** "The Judge" — audits session-bound AI chat responses against the ground-truth session transcript and records per-claim verdicts for the Hallucination Audit (`/verification` UI hub).
- **Workflow:**
  1.  Receives a `jobId` from the API (`POST /api/verification/jobs` or single-chat verify). The job row snapshots the Judge LLM config (model, context size, temperature default `0.3`, thinking budget passed through uncapped, default `-1` = unrestricted) so the worker loads exactly the configured Judge; job _creation_ never touches the user's global chat model.
  2.  Loads the Judge model via `loadLlmModelForWorker` under the cross-worker LLM mutex (`packages/worker/src/llmWorkerMutex.ts`), so analysis and verification jobs never load/unload models concurrently. Local loads refuse while a transcription job is queued/running (GPU exclusion; remote/CPU-only targets exempt).
  3.  For each candidate AI message (newest-first, skipping already-verified unless forced):
      - **Fast-path:** trivial conversational greetings (`isTrivialConversationalMessage`) complete immediately with zero LLM calls.
      - **Claims extraction:** sends the ground-truth transcript (budgeted via `selectJudgeTranscriptContext`, speaker labels honoring `session.showSpeakers`) + therapist question + visible AI answer to the Judge LLM, which returns atomic claims with verdicts (`supported` / `partially_supported` / `contradicted` / `fabricated`), omissions, severity, and transcript evidence.
      - **JSON hardening:** sanitizes control characters/trailing commas (`sanitizeJsonForParse`); on unparseable output performs one retry at `temperature: 0.1` with thinking unchanged (reasoning models must think before emitting JSON). Runaway first attempts (filled the completion cap, or ≥16k unparseable completion tokens) get a compact-verdict reminder under a fail-fast cap (`min(original, 8k)`); cap-truncated failures persist as `truncated_output` with cap numbers instead of `malformed_json`. Usage logs and token counts are recorded even on failure.
      - **Quote span resolution:** maps each `exact_quote` back to `start_char`/`end_char` in the message (`locateQuoteSpan`, quote/dash normalization, ellipsis-clause handling) for inline UI highlighting.
      - **Evidence hydration:** overwrites LLM-guessed `timestampMs`/`speaker` with ground-truth `transcript_paragraphs` values (`hydrateEvidenceItem`); unresolvable citations are nulled.
      - **Accuracy scoring:** persists a `message_verifications` row (review-aware effective counts via the shared `@therascript/domain` reduction core; accuracy via `computeVerificationAccuracyScore`, which `computeVerificationAccuracy` delegates to) plus `verified_statements` rows with stored finding identity, and updates the job counters with effective results. The save fingerprints the evaluated material (`computeJudgeMaterialRevision`: visible answer + therapist question + full transcript content) and discards stale results whose material changed mid-audit (`StaleVerificationMaterialError`, reported as skipped); durable human confirmations are reconciled inside the same transaction before aggregates are calculated.
  4.  **Progress streaming:** publishes `status` / `progress` / `message_verified` / `complete` / `error` events to Redis channel `verification-stream:<jobId>` (`@therascript/queue`), consumed by `GET /api/verification/jobs/:jobId/stream` (SSE) and the `useVerificationStream` UI hook. `message_verified` carries the persisted effective accuracy/counts from the returned save result.
  5.  Keeps the Judge model loaded when the job finishes and marks the job `completed` / `failed` / `canceled` (cancellation is cooperative: the worker polls job status before each message). There is no `finally` unload: once the Judge model is confirmed loaded, the worker adopts its snapshotted config into the global `app_settings` (best-effort, via `buildJudgeActiveSettingsUpdate`), so Session/Standalone chat and the next Fact Check start with settings preset and reuse the warm model. Starting a job with a different model still evicts the previous one at load time, like Session Chat; only worker shutdown or an explicit unload evicts the retained model.
- **Human confirmation (V22):** `POST /api/verification/statements/:statementId/dismiss` (`dismissStatementHandler` → `verificationRepository.dismissStatementAsConfirmed`) records a message-owned `verification_statement_reviews` snapshot for one finding. Confirmed findings keep their raw Judge verdicts but leave highlights, the Active Issues feed, and active counts; matching rerun findings stay confirmed while changed material requires fresh review. Per-response clears preserve confirmations; Reset All Verifications deletes them.
- **Storage:** `verification_jobs`, `message_verifications`, `verified_statements` (Migration V20), `verification_statement_reviews` + `material_revision`/`finding_key`/`context_revision` (Migration V22); per-message authoring model in `messages.model`. Raw model ids stay verbatim in the DB; the `/verification` hub and Settings usage logs render human names through the shared UI override `formatModelDisplayName` (`packages/ui/src/utils/modelDisplay.ts`: `gemma3:12b-it-qat` → `gemma3-12b`, `qwen/qwen3.5-9b` → `qwen3.5-9b`, missing → `Unknown Model`).

## 2. System & Utility Agents

Located in `packages/api`, these "meta-agents" configure or summarize data to facilitate the main workflows.

### Vault Manager (The Gatekeeper)

- **Type:** API Service + supervised worker launcher
- **Source:** `packages/api/src/services/vaultManager.ts`; primitives in `packages/vault`
- **Responsibility:**
  - Selects the boot mode: **vault** when the cipher-capable SQLite binding is present, otherwise **legacy-fallback** (fail-closed if a vault exists but cipher support is missing).
  - Owns first-run setup (migrates the legacy install into a staged generation, verifies it, then atomically cuts `CURRENT` over) and unlock/lock transitions under an exclusive transition mutex.
  - Opens the encrypted database and starts the supervised worker after unlock; on lock it drains requests, aborts streams, stops the worker, closes the database, clears keys, and revokes sessions.
  - Serves encrypted audio ranges (`vaultAudioService.ts`), FTS5 search (`ftsSearchService.ts`), and `.tvbak` backup export/import.
- **Control path:** `POST /api/vault/setup`, `/unlock`, `/lock`, `/change-password`; every other route is gated by `middleware/vaultGuard.ts` while protection is active.

### Strategy Generator (The Planner)

- **Type:** API Service / LLM Chain
- **Source:** `packages/api/src/api/analysisHandler.ts`
- **Prompt Template:** `system_analysis_strategist` (in `packages/db/src/sqliteService.ts`)
- **Responsibility:**
  - Takes a complex user query (e.g., "How has the patient's anxiety evolved over the last 4 sessions?").
  - Generates a **JSON Plan** containing:
    - `intermediate_question`: Instructions for the Analysis Agent to run on _individual_ documents.
    - `final_synthesis_instructions`: Instructions on how to combine those results.
- **Trigger:** Called immediately before queuing an Advanced Analysis Job.

### Short Prompt Generator (The Summarizer)

- **Type:** API Background Task
- **Source:** `packages/api/src/api/analysisHandler.ts`
- **Prompt Template:** `system_short_prompt_generator`
- **Responsibility:**
  - Takes a long, complex user prompt.
  - Compresses it into a short (max 5 words) title for the UI list view.
  - _Example:_ "Analyze the recurring themes of abandonment..." -> "Abandonment Themes Analysis".

## 3. Interactive Agents

These operate in real-time via the API (`packages/api`) to facilitate user interaction.

### Session Chat Agent

- **Type:** RAG / Context-Aware Chatbot
- **Source:** `packages/api/src/api/sessionChatHandler.ts` & active model manager.
- **Prompt Template:** `system_prompt`
- **Context:**
  - Full transcript of the specific session (up to context window limit).
  - Recent chat history.
- **Capabilities:** Can quote the patient/therapist, identify CBT techniques used in the specific text, and clarify transcript ambiguities.
- **GPU exclusion:** Local model loads refuse (409) while a transcription job is queued/running; remote/CPU-only targets are exempt.
- **Memory:** Context is re-injected on every turn; state is stored in SQLite (`messages` table).
- **Cancellation:** Model unload on STOP is triggered client-side due to an Elysia 1.2.25 bug; see `docs/DATA_FLOWS.md` §6.

### Standalone Chat Agent

- **Type:** General Purpose Assistant
- **Source:** `packages/api/src/api/standaloneChatHandler.ts`
- **Prompt Template:** `system_standalone_prompt`
- **Context:** No transcript context. Pure chat history.
- **Capabilities:** General questions, brainstorming, or drafting emails/notes without specific session grounding.
- **Cancellation:** Model unload on STOP is triggered client-side due to an Elysia 1.2.25 bug; see `docs/DATA_FLOWS.md` §6.

## 4. Service Agents (External)

### Whisper Service

- **Location:** `packages/whisper` (Python/FastAPI)
- **Role:** Audio-to-Text inference engine.
- **Tech:** Parakeet TDT 0.6B v2 via NeMo (running on PyTorch/CUDA, fp32 CPU fallback with automatic device detection).

### LM Studio Service

- **Location:** Native System (`lms` process)
- **Role:** LLM Inference Provider.
- **Models:** Llama 3, Mistral, Gemma (configurable).
- **API:** `packages/api/src/services/llamaCppService.ts` or related active model services manage the context lifecycle.
