# Therascript Production-Readiness Task Plan

This document is structured as a sequential execution plan for an LLM orchestrator delegating work to **subagents in series** (one task at a time).

## Orchestrator Execution Protocol

1. **Run Strictly in Series**: Invoke **one subagent per task** (`Task 1` $\rightarrow$ `Task 2` $\rightarrow$ ... $\rightarrow$ `Task N`) using `Workspace: 'inherit'`. Wait for the active subagent to finish and report back before starting the next task so file edits and builds never collide.
2. **Environment Requirement**: Always ensure Node `23.10.0` (see `.nvmrc` and `AGENTS.md`) is active before running `yarn` commands.
3. **Subagent Handoff Prompt Template**:
   When invoking a subagent for `Task N`, pass:
   - The full section for `Task N` from this file.
   - Instructions to read the listed **Target Files** first, implement the changes, add/update unit tests where specified, run the **Verification** commands, and update `tasks.md` to mark `- [x] Task N` upon completion.
4. **Gatekeeping**: Do not advance to `Task N+1` until `Task N`'s verification commands (`yarn test` and package builds) exit `0`.
5. **Record Changes with Changesets**: Every user-facing change must ship with a changeset. Run `yarn changeset` (or add a Markdown file under `.changeset/` by hand) listing the bumped packages plus release-note prose. Cut releases with `yarn version-packages`, which consumes pending changesets and updates `CHANGELOG.md` files. See `.changeset/README.md`.

---

## Task Checklist

- [x] **Task 1**: Fix Verification Repository Accounting, Failed-Row Persistence, & Admin Backup/Reset Integrity (`@therascript/domain`, `@therascript/data`, `@therascript/api`)
- [x] **Task 2**: Fix Worker Quote Span Locator (`locateQuoteSpan`) & Ground-Truth Transcript Evidence Hydration (`@therascript/db`, `@therascript/worker`)
- [x] **Task 3**: Harden Judge LLM Execution: Temperature Default, Thinking Budget Cap, JSON Sanitization/Retry, Greeting Fast-Path, & Cross-Worker Mutex (`@therascript/worker`, `@therascript/api`, `@therascript/ui`)
- [x] **Task 4**: Fix API Global Active-Model Clobbering, Concurrent Job Guards, & Jobs Queue Modal Parity (`@therascript/api`, `@therascript/ui`)
- [x] **Task 5**: Fix Frontend Inline Statement Highlighting Across Markdown & Normalized Spans (`@therascript/ui`)
- [x] **Task 6**: Surface Failed Verifications, Wire Single-Chat & Single-Message Verification Actions, and Polish Audit UX (`@therascript/ui`)
- [x] **Task 7**: Update System Documentation & Add Release Changeset (`docs/*`, `AGENTS.md`, `.changeset/*`)

---

## Task 1: Fix Verification Repository Accounting, Failed-Row Persistence, & Admin Backup/Reset Integrity

### Background & Problem
1. **Inconsistent `status = 'failed'` accounting in `verificationRepository.ts`**:
   - In `findVerificationsBySessionId` (`packages/data/src/repositories/verificationRepository.ts:672`), `_verifiedCountBySessionIdStmt` runs `SELECT COUNT(*) AS verified FROM message_verifications WHERE session_id = ?`, which counts `status = 'failed'` rows as verified AI messages! Meanwhile, `getGlobalVerificationAnalytics` (`line 843`) counts `WHERE mv.session_id = s.id AND mv.status = 'completed'`, and `findCandidateMessagesForVerification` (`line 440`) treats `status = 'failed'` messages as unverified when `skipVerified = true`. In the dev DB (`job_id = 1`, where 5 of 26 messages failed), `getGlobalVerificationAnalytics` reports `5 unverified messages across 1 transcript`, while `findVerificationsBySessionId` reports `26/26 verified`.
   - Furthermore, `SessionVerificationSummary` does not expose `failedAiMessages`, leaving the UI unable to distinguish unverified messages from failed verification attempts.
2. **Active job check & incomplete reset**:
   - `resetVerificationsHandler` (`packages/api/src/api/verificationHandler.ts:561`) calls `findAllVerificationJobs(50)` to check for running jobs (which misses active jobs if >50 jobs exist and wastes query overhead).
   - `resetAllVerifications` (`packages/data/src/repositories/verificationRepository.ts:1066`) deletes `verified_statements` and `message_verifications`, but leaves `verification_jobs` rows untouched.
3. **Broken Admin Full Reset & Backup Export/Import (`packages/api/src/api/adminHandler.ts`)**:
   - `resetAllDataService()` (`adminHandler.ts:179-242`) drops `messages`, `chats`, and `sessions` without dropping `verified_statements`, `message_verifications`, or `verification_jobs`, and manually re-creates only schema versions 1–3 (`user_version = 3`), leaving the database in a broken hybrid state without verification tables or migrations 4–10.
   - `exportDataService()` and `importDataService()` (`adminHandler.ts:259-568`) completely omit `verification_jobs`, `message_verifications`, and `verified_statements`.

### Target Files
- `packages/domain/src/schemas/db/verification.ts`
- `packages/data/src/repositories/verificationRepository.ts`
- `packages/data/src/repositories/verificationRepository.test.ts`
- `packages/api/src/api/adminHandler.ts`
- `packages/api/src/api/adminHandler.test.ts`

### Implementation Instructions
1. **Update `sessionVerificationSummarySchema` in `packages/domain/src/schemas/db/verification.ts`**:
   - Add `failedAiMessages: z.number().int().nonnegative().optional().default(0)` to `sessionVerificationSummarySchema` (and `globalVerificationAnalyticsSchema.totals` if helpful, e.g., `failedMessagesCount: z.number().int().nonnegative().optional().default(0)`).
2. **Fix `verificationRepository.ts`**:
   - Update `_verifiedCountBySessionIdStmt` to only count completed verifications:
     ```sql
     SELECT COUNT(*) AS verified FROM message_verifications WHERE session_id = ? AND status = 'completed'
     ```
   - Add a query in `findVerificationsBySessionId` and `getGlobalVerificationAnalytics` to count failed verifications (`WHERE session_id = ? AND status = 'failed'`) and populate `failedAiMessages` on each `SessionVerificationSummary` and `failedMessagesCount` on `GlobalVerificationAnalytics['totals']`.
   - Add `hasActiveVerificationJobs(): boolean` to `verificationRepository`:
     ```sql
     SELECT 1 FROM verification_jobs WHERE status IN ('pending', 'processing', 'canceling') LIMIT 1
     ```
   - Update `resetAllVerifications()` so its transaction deletes from `verified_statements`, `message_verifications`, **and** `verification_jobs` (`DELETE FROM verification_jobs`), returning `{ deletedVerifications, deletedStatements, deletedJobs }`.
   - Add bulk export helper methods on `verificationRepository` if needed for admin backup (`findAllJobsForBackup()`, `findAllMessageVerificationsForBackup()`, `findAllVerifiedStatementsForBackup()`).
3. **Fix `adminHandler.ts` (`resetAllDataService`, `exportDataService`, `importDataService`)**:
   - In `resetAllDataService()`: instead of dropping a hardcoded subset of tables and manually running only V1–V3 SQL, clear/reset all user data tables (`verified_statements`, `message_verifications`, `verification_jobs`, `intermediate_summaries`, `analysis_job_sessions`, `analysis_jobs`, `messages`, `chats`, `transcript_paragraphs`, `sessions`, `usage_logs`, and non-system `templates`) or re-run the full `sqliteService` migration suite so all V1–V10 tables (`verification_jobs`, `message_verifications`, `verified_statements`, `app_settings`, `usage_logs`, `sessions.showSpeakers`, `sessions.numSpeakers`, etc.) and system templates (`system_verification_judge`, etc.) remain intact after a reset.
   - In `exportDataService()` and `importDataService()`: include `verification_jobs.json`, `message_verifications.json`, and `verified_statements.json` in the tarball export, and restore them in `importDataService()` (using `.optional().default([])` when parsing from the archive so backups created before v10 still import cleanly, mapping `session_id`, `chat_id`, `message_id`, `verification_job_id`, and `message_verification_id` through `oldToNew*` ID maps).

### Unit Tests
- In `packages/data/src/repositories/verificationRepository.test.ts`:
  - Verify `findVerificationsBySessionId` and `getGlobalVerificationAnalytics` do **not** count `status = 'failed'` rows in `verifiedAiMessages`, and accurately report `failedAiMessages` / `failedMessagesCount`.
  - Verify `hasActiveVerificationJobs()` returns `true` when a job is `pending`, `processing`, or `canceling`, and `false` when all jobs are `completed`, `failed`, or `canceled`.
  - Verify `resetAllVerifications()` deletes `verification_jobs` as well as `message_verifications` and `verified_statements`.
- In `packages/api/src/api/adminHandler.test.ts`:
  - Verify `resetAllDataService()` leaves `verification_jobs`, `message_verifications`, and `verified_statements` tables intact and queryable.

### Verification Commands
```bash
yarn --cwd packages/domain build
yarn --cwd packages/data build
yarn --cwd packages/data test
yarn --cwd packages/api test
```

---

## Task 2: Fix Worker Quote Span Locator (`locateQuoteSpan`) & Ground-Truth Transcript Evidence Hydration

### Background & Problem
1. **`locateQuoteSpan` fails on 69.3% (61 of 88) of real claims in `therapy-analyzer-dev.sqlite`**:
   - Judge LLMs frequently wrap `exact_quote` in outer quotation marks (`"\"The transcript describes...\""`), substitute single quotes `'Inspect'` for double quotes `"Inspect"` inside JSON strings, or include leading/trailing/mid-sentence ellipses (`...` or `…`).
   - `normalizeTextWithMap` (`packages/worker/src/jobs/verificationProcessor.ts:276`) only strips `['*', '_', '`', '~']`. It does not normalize quote characters (`'` vs `"` vs curly quotes), nor strip outer quotes or leading/trailing ellipses.
   - When the Judge LLM splices two clauses with `...` or omits a parenthetical middle clause (as in `message_id=65` statement 3), Pass 3 (`ANCHOR_WINDOW_SLACK = 150`) spans across the skipped middle text (`[235, 469]`) and records the entire `[235, 469]` range in `usedRanges`, which **blocks subsequent statement 4 (`[319, 404]`) from resolving** because `isSpanFree` rejects overlapping ranges.
2. **100% of transcript evidence items in dev DB have hallucinated `timestampMs` and `speaker`**:
   - `formatTranscriptParagraph` (`verificationProcessor.ts:384`) formats paragraphs as `[P#0 00:00] UNKNOWN: ...` (in `MM:SS`), while `DEFAULT_VERIFICATION_JUDGE_PROMPT` asks the Judge LLM for `"timestampMs": 84000, "speaker": "SPEAKER_01"`.
   - As a result, the Judge LLM fabricates millisecond values (e.g., `80000`, `76800` instead of `866`, `18850`) and copies `"SPEAKER_01"` from the prompt example even on transcripts with no speaker diarization (or outputs `"UNKNOWN"`).
   - `verificationProcessor.ts` already loads the ground-truth `paragraphs: TranscriptParagraphData[]` from SQLite, but never hydrates or validates `evidence` items against `paragraphs`, and never checks `session.showSpeakers !== 0`.

### Target Files
- `packages/db/src/sqliteService.ts`
- `packages/worker/src/jobs/verificationProcessor.ts`
- `packages/worker/src/jobs/verificationProcessor.test.ts`

### Implementation Instructions
1. **Upgrade `locateQuoteSpan` and `normalizeTextWithMap` in `packages/worker/src/jobs/verificationProcessor.ts`**:
   - Add a quote-cleaning pre-processor for `exactQuote`:
     - Trim whitespace, strip matching outer quotation marks (`"..."`, `'...'`, `“...”`, `‘...’`), and strip leading/trailing ellipses (`^\.{2,}\s*`, `\s*\.{2,}$`, `^…+\s*`, `\s*…+$`).
   - In `normalizeTextWithMap`:
     - Normalize all single/double/curly quote characters (`"`, `'`, `“`, `”`, `‘`, `’`) to `'` (1-to-1 character mapping in `normChars` / `normToOrigMap`).
     - Normalize typographic dashes (`–`, `—`) to `-`.
     - Continue stripping inline Markdown tokens (`*`, `_`, `` ` ``, `~`) while preserving `normToOrigMap`.
   - Handle mid-quote ellipses (`...` or `…`):
     - If the cleaned quote contains `...` or `…` and Pass 1/Pass 2 do not match the literal `...`, split the quote on `(?:\.{3,}|…+)` into non-empty clauses. Match the first substantive clause (>= 12 chars) and, if the subsequent clause appears within a single sentence/clause window (`<= 80` chars gap), span them; otherwise return the span of the longest substantive clause so `usedRanges` does not swallow unrelated intermediate sentences.
   - Prevent wide Pass 3 anchor matches from starving inner statements:
     - Reduce `ANCHOR_WINDOW_SLACK` (e.g., to `80` chars) or, when Pass 3 matches `[startOrig, endOrig]` with slack > 20 chars over the quote length, only reserve the prefix and suffix anchor sub-ranges in `usedRanges` rather than blocking the entire middle gap.
2. **Respect `session.showSpeakers` in `formatTranscriptForJudge` / `formatTranscriptParagraph`**:
   - Update `formatTranscriptParagraph(p: TranscriptParagraphData, showSpeakers = true)`:
     - Only include the speaker label if `showSpeakers` is `true` AND `p.speaker` is non-empty AND `p.speaker.trim().toUpperCase() !== 'UNKNOWN'`.
     - Otherwise format as `[P#${p.id} ${timeLabel}] ${text}` with no `UNKNOWN:` prefix.
   - In `processVerificationJob`, fetch the session record (`sessionRepository.findById(sessionId)`) and pass `session?.showSpeakers !== 0` into `formatTranscriptForJudge`.
3. **Hydrate `evidence` against Ground-Truth `paragraphs` in `verificationProcessor.ts`**:
   - Build a `Map<number, TranscriptParagraphData>` keyed by `p.id` (paragraph index) for the session's transcript paragraphs.
   - In `normalizeEvidenceItem` / `normalizeStatement` (passing the `paragraphsById` map and `showSpeakers: boolean`):
     - If `paragraphIndex !== null` and `paragraphsById.has(paragraphIndex)` (or if `evidence.quote` matches a paragraph when `paragraphIndex` is missing/out-of-bounds):
       - Resolve the matched `TranscriptParagraphData` `para`.
       - Set `paragraphIndex = para.id`.
       - Overwrite `timestampMs = para.timestamp` (always using the ground-truth DB millisecond timestamp!).
       - Overwrite `speaker = (showSpeakers && para.speaker && para.speaker.trim().toUpperCase() !== 'UNKNOWN') ? para.speaker.trim() : null`.
     - If `paragraphIndex` does not match any paragraph in the session and `quote` cannot be located in any paragraph, set `paragraphIndex = null`, `timestampMs = null`, and `speaker = null`.
4. **Update `DEFAULT_VERIFICATION_JUDGE_PROMPT` (`verificationProcessor.ts` & `packages/db/src/sqliteService.ts`)**:
   - Clarify in the prompt schema instructions that `paragraphIndex` must be the integer `<index>` from `[P#<index> MM:SS]`, and that `speaker` should be `null` when no speaker label is shown on the paragraph.

### Unit Tests
- Add comprehensive unit tests in `packages/worker/src/jobs/verificationProcessor.test.ts`:
  - `locateQuoteSpan` resolves quotes wrapped in outer `"..."` or `'...'`.
  - `locateQuoteSpan` resolves quotes where inner `"` was replaced with `'` by the LLM (e.g. `'Inspect'` vs `"Inspect"`).
  - `locateQuoteSpan` resolves quotes with leading/trailing `...` or `…` and inline Markdown (`**bold**`, `` `code` ``).
  - `locateQuoteSpan` resolves two statements where one has a skipped parenthetical clause without blocking the statement inside the parenthetical.
  - Evidence hydration overwrites hallucinated LLM `timestampMs` (`80000`) and `speaker` (`"SPEAKER_01"` / `"UNKNOWN"`) with ground-truth `paragraph.timestamp` (`866`) and `null` when `showSpeakers === 0` or speaker is `'UNKNOWN'`.

### Verification Commands
```bash
yarn --cwd packages/db build
yarn --cwd packages/worker build
yarn --cwd packages/worker test
```

---

## Task 3: Harden Judge LLM Execution: Temperature Default, Thinking Budget Cap, JSON Sanitization/Retry, Greeting Fast-Path, & Cross-Worker Mutex

### Background & Problem
1. **Dead `0.3` temperature default**:
   - `verificationProcessor.ts:720` has `const temperature = jobRecord.temperature ?? 0.3;`, intending `0.3` for deterministic JSON evaluation. However, `verificationHandler.ts:190` sets `temperature: temperature ?? getConfiguredTemperature()` (`0.7`) and `StartVerificationModal.tsx:154` initializes `temperature: llmStatus.configuredTemperature ?? 0.7`, so `jobRecord.temperature` is always `0.7` and `0.3` is dead code.
2. **Unrestricted `<think>` budget causes 85s/msg latency and 19.2% message failure rate**:
   - With `thinking_budget = -1` on `qwen3.5-2b`, LM Studio ignores `reasoning_budget` and generates 7,000–9,000 tokens of `<think>` before emitting JSON, hitting `maxCompletionTokens` (9,000) and failing with `Judge LLM did not return valid JSON (empty or unparseable output)` on 3 of 26 messages (`message_id` 63, 35, 29).
3. **Unescaped control characters / inner quotes in LLM JSON & no retry fallback**:
   - `message_id=33` failed with `Bad control character in string literal` and `message_id=23` failed with `Expected ',' or '}' after property value`. `extractJsonObject` / `parseJsonObjectFromLlm` does not sanitize raw control characters inside JSON string literals, and `verificationProcessor.ts` never retries with thinking disabled (`thinkingBudget: 0`, `temperature: 0.1`) on parse failure.
4. **Lost `usage_logs` and token metrics on failed Judge calls**:
   - When `parseJsonObjectFromLlm` throws, execution jumps over `usageRepository.insertUsageLog` to the `catch` block, which saves `message_verifications` with `null` `promptTokens`, `completionTokens`, and `durationMs`.
5. **Trivial conversational greetings waste 75s of Judge compute**:
   - Short assistant greetings (`"Hello! How can I help you with the information provided in this transcript?"`, messages 53, 55, 57) each triggered a 75s, 7,500-token Judge call to return `0 claims`.
6. **Cross-worker concurrency race (`analysisWorker` vs `verificationWorker`)**:
   - `packages/worker/src/index.ts` runs `analysisWorker` and `verificationWorker` in parallel (`concurrency: 1` per queue). If both queues have a job, both workers simultaneously call `loadLlmModelForWorker` and `unloadModelAtUrlForWorker`, unloading each other's active model mid-stream.

### Target Files
- `packages/worker/src/jobs/verificationProcessor.ts`
- `packages/worker/src/jobs/verificationProcessor.test.ts`
- `packages/worker/src/llmWorkerMutex.ts` (new shared helper)
- `packages/worker/src/jobs/analysisProcessor.ts`
- `packages/worker/src/index.ts`
- `packages/api/src/api/verificationHandler.ts`
- `packages/ui/src/components/Verification/StartVerificationModal.tsx`

### Implementation Instructions
1. **Fix Judge Default Temperature (`0.3`) & Default Thinking Budget**:
   - In `packages/api/src/api/verificationHandler.ts` (`createVerificationJobRecord`): default `effectiveTemperature` to `temperature ?? 0.3` (not `getConfiguredTemperature()`).
   - In `packages/ui/src/components/Verification/StartVerificationModal.tsx`: initialize `temperature` state to `0.3` (instead of `llmStatus.configuredTemperature ?? 0.7`) and initialize `thinkingBudget` for Judge runs to a sensible bounded default (e.g., `1024` or `0` instead of unrestricted `-1` when `configuredThinkingBudget` is `-1` or unset).
   - In `packages/worker/src/jobs/verificationProcessor.ts`: when `jobRecord.thinkingBudget === -1`, cap the effective Judge `thinkingBudget` passed to `getLlmCompletionForWorker` (e.g., `2048`) so reasoning models cannot consume all 9,000 completion tokens inside `<think>` before starting the JSON output.
2. **Sanitize JSON String Control Characters & Add 1-Step Retry Fallback in `verificationProcessor.ts`**:
   - In `extractJsonObject` / `parseJsonObjectFromLlm`: if initial `JSON.parse(extracted)` throws, sanitize raw control characters (`0x00`–`0x1F`, such as unescaped `\n`, `\r`, `\t`) inside JSON string literals and strip trailing commas before `}` or `]`, then re-attempt `JSON.parse`.
   - In `processVerificationJob`: if `parseJsonObjectFromLlm` still returns `null` (empty/truncated output or unrecoverable syntax error) and job cancellation has not been requested, log a warning and perform **one retry** call with `thinkingBudget: 0` (`enable_thinking: false`) and `temperature: 0.1`, appending a concise reminder to output strictly valid JSON with properly escaped quotes.
3. **Always Record Usage Logs & Token Counts (Even on Parse Failure)**:
   - Record `usageRepository.insertUsageLog` immediately after each `getLlmCompletionForWorker` call completes (before JSON parsing), and accumulate `promptTokens`, `completionTokens`, and `durationMs` across initial + retry attempts so that if a message still fails verification, `saveMessageVerificationResult` persists the actual `promptTokens`, `completionTokens`, and `durationMs` in `message_verifications`.
4. **Add Short Conversational Greeting Fast-Path**:
   - Add a helper `isTrivialConversationalMessage(text: string): boolean` in `verificationProcessor.ts`:
     - Strip `<think>...</think>` blocks and trim.
     - If the remaining text is short (e.g., `<= 120` chars and `<= 20` words), contains no digits (`\d`), no quotes (`"`, `'`, `“`, `”`), no bullet points/markdown lists, and matches common greeting/prompt patterns (e.g., `"Hello! How can I help you..."`, `"Hi there! What would you like to know..."`), skip the LLM call and immediately save a `completed` verification with `overallVerdict: 'clean'`, `accuracyScore: 1.0`, `statements: []`, `promptTokens: 0`, `completionTokens: 0`, `durationMs: 0`.
5. **Serialize LLM Worker Jobs Across Queues (`llmWorkerMutex.ts`)**:
   - Create `packages/worker/src/llmWorkerMutex.ts` exporting an async mutex (`runWithLlmWorkerLock<T>(fn: () => Promise<T>): Promise<T>`) and wrap both `processAnalysisJob` (`analysisProcessor.ts`) and `processVerificationJob` (`verificationProcessor.ts`) in `runWithLlmWorkerLock` so an analysis job and a verification job never load/unload models on LM Studio concurrently.

### Unit Tests
- In `packages/worker/src/jobs/verificationProcessor.test.ts`:
  - Verify `parseJsonObjectFromLlm` recovers from unescaped newlines/tabs inside JSON string literals and trailing commas.
  - Verify retry fallback triggers with `thinkingBudget: 0` and `temperature: 0.1` when the first LLM response is truncated inside `<think>`, and succeeds when the retry returns valid JSON.
  - Verify that when both attempts fail JSON parsing, `usageRepository.insertUsageLog` is still called and `saveMessageVerificationResult` receives `status: 'failed'` **with** accumulated `promptTokens`, `completionTokens`, and `durationMs`.
  - Verify `isTrivialConversationalMessage` short-circuits `"Hello! How can I help you with the information provided in this transcript?"` with `0` LLM calls and `overallVerdict: 'clean'`, while still sending short factual answers (e.g., `"The client reported 3 panic attacks."`) to the Judge LLM.

### Verification Commands
```bash
yarn --cwd packages/worker build
yarn --cwd packages/worker test
yarn --cwd packages/api test
```

---

## Task 4: Fix API Global Active-Model Clobbering, Concurrent Job Guards, & Jobs Queue Modal Parity

### Background & Problem
1. **`createVerificationJobRecord` clobbers the user's global chat model and unloads active models mid-use**:
   - In `packages/api/src/api/verificationHandler.ts:212-238`, creating a verification job calls `unloadModelAtUrl(previousBaseUrl)` and `setActiveModelAndContextAndParams(targetModel, targetContextSize, effectiveTemperature, effectiveTopP, effectiveRepeatPenalty, effectiveThinkingBudget)`.
   - This overwrites the user's global Session/Standalone Chat model settings with the Judge's parameters (`temperature: 0.3`, Judge model name, Judge thinking budget) and unloads whatever model is currently serving an active chat or worker job!
   - Note: `verificationProcessor.ts` already loads `jobRecord.modelName` and `jobRecord.contextSize` via `loadLlmModelForWorker` when the worker starts the job and unloads it in `finally`.
2. **No guard against starting duplicate concurrent verification jobs**:
   - Clicking "Run Fact Check" twice (or triggering single-chat verify while a batch job is running) creates multiple concurrent jobs, causing model thrashing and redundant LLM calls.
3. **`resetVerificationsHandler` uses `findAllVerificationJobs(50)`**:
   - Should use `verificationRepository.hasActiveVerificationJobs()` from Task 1.
4. **`JobsQueueModal.tsx` does not display or manage `verification` jobs**:
   - `GET /api/jobs` (`packages/api/src/routes/jobsRoutes.ts`) now returns `verification: VerificationJobSummary[]`, and `PersistentSidebar.tsx` counts `verificationJobs` in the badge, but `packages/ui/src/components/Jobs/JobsQueueModal.tsx` only renders `transcription` and `analysis` jobs! If a verification job is running, the sidebar badge shows `1` active job, yet opening the Jobs Queue Modal shows nothing for Verification.

### Target Files
- `packages/api/src/api/verificationHandler.ts`
- `packages/api/src/api/verificationHandler.test.ts`
- `packages/ui/src/components/Jobs/JobsQueueModal.tsx`
- `packages/ui/src/types.ts`

### Implementation Instructions
1. **Update `createVerificationJobRecord` in `packages/api/src/api/verificationHandler.ts`**:
   - Check `verificationRepository.hasActiveVerificationJobs()` before creating a new job. If an active job (`pending`, `processing`, or `canceling`) already exists, throw `new ConflictError('A verification job is already in progress. Please wait for it to finish or cancel it before starting a new one.')` (HTTP `409`).
   - Remove the `unloadModelAtUrl(previousBaseUrl)` and `setActiveModelAndContextAndParams(...)` side effects from `createVerificationJobRecord` so starting a background verification job does not mutate the user's global chat model configuration or rip the model out from under an active chat stream.
2. **Update `resetVerificationsHandler` in `packages/api/src/api/verificationHandler.ts`**:
   - Replace `findAllVerificationJobs(50).some(...)` with `verificationRepository.hasActiveVerificationJobs()`.
3. **Add Verification Jobs Section to `packages/ui/src/components/Jobs/JobsQueueModal.tsx`**:
   - Update `AllJobsStatus` in `packages/ui/src/types.ts` (or local type in `JobsQueueModal.tsx`) to include `verification?: VerificationJobSummary[]`.
   - Render active and recent `verification` jobs in `JobsQueueModal.tsx` with status badge (`pending`, `processing`, `canceling`, `completed`, `failed`, `canceled`), progress (`processed_messages / total_messages` and `flagged_messages` count), link to `/audit`, and a "Cancel" button for active jobs wired to `cancelVerificationJob`.

### Unit Tests
- Update `packages/api/src/api/verificationHandler.test.ts`:
  - Verify `createVerificationJobHandler` returns `409 Conflict` when `hasActiveVerificationJobs()` is `true`.
  - Verify `createVerificationJobHandler` does **not** mutate global active chat model settings (`setActiveModelAndContextAndParams` is not called).
  - Verify `resetVerificationsHandler` uses `hasActiveVerificationJobs()` and returns `409 Conflict` when a job is active.

### Verification Commands
```bash
yarn --cwd packages/api build
yarn --cwd packages/api test
yarn --cwd packages/ui build
```

---

## Task 5: Fix Frontend Inline Statement Highlighting Across Markdown & Normalized Spans

### Background & Problem
1. **Why 0 inline highlights rendered on `message_id=65` (despite `1 Hallucination / Contradiction` in the footer)**:
   - In `packages/ui/src/utils/highlightVerifiedStatements.ts`, `normalizeForMatch` (`line 52`) only collapses whitespace (`value.replace(/\s+/g, ' ').trim()`). It is **case-sensitive**, does **not** strip inline Markdown characters (`*`, `_`, `` ` ``, `~`), does **not** normalize quote variants (`'` vs `"`), and does **not** strip outer quotes or ellipses (`...`).
   - In `resolveStatementSpans` (`line 127`), even when the worker already resolved `start_char` and `end_char` (e.g., via case-insensitive Pass 2 or anchor Pass 3 in `verificationProcessor.ts`), `resolveStatementSpans` rejects the worker span because `normalizeForMatch(slice) === normalizeForMatch(quote)` fails when case (`Using` vs `using`), quotes (`'Inspect'` vs `"Inspect"`), or Markdown (`**bold**`) differ!
   - Worse, in Markdown mode (`renderMd = true`, the default in `ChatMessageBubble.tsx`), `rehypeHighlightStatements` (`line 277`) completely ignores `start_char`/`end_char` and searches each HAST text node individually using `normalizeForMatch`. Because `ReactMarkdown` parses `` `padding-top` `` and `**Summary:**` into separate `<code>` and `<strong>` HAST element nodes, HAST text nodes never contain backticks or asterisks and a single sentence is split across multiple text nodes. Consequently, **any statement containing inline Markdown formatting (`code`, `bold`, `italic`) never highlights in Markdown view!**

### Target Files
- `packages/ui/src/utils/highlightVerifiedStatements.ts`
- `packages/ui/src/utils/highlightVerifiedStatements.test.ts`

### Implementation Instructions
1. **Upgrade Text Normalization in `packages/ui/src/utils/highlightVerifiedStatements.ts`**:
   - Create a unified normalization function `normalizeForMatchWithMap(input: string): { norm: string; map: number[] }` and `cleanQuoteForMatch(quote: string): string` matching the worker's normalization rules:
     - Strip outer wrapping quotes (`"..."`, `'...'`, `“...”`, `‘...’`) and leading/trailing ellipses (`...`, `…`).
     - Strip inline Markdown formatting characters (`*`, `_`, `` ` ``, `~`).
     - Normalize all single/double/curly quotes (`"`, `'`, `“`, `”`, `‘`, `’`) to `'` and typographic dashes (`–`, `—`) to `-`.
     - Lowercase characters (`toLowerCase()`) and collapse whitespace runs to a single `' '` while maintaining the index map back to the source string.
2. **Fix `resolveStatementSpans` (Plain-Text Span Resolver)**:
   - When `stmt.start_char` and `stmt.end_char` are valid integer indices (`0 <= start < end <= messageText.length`) and do not overlap an already-claimed range, verify that the slice matches `stmt.exact_quote` either via normalized equality OR normalized prefix/suffix anchor match (so Pass 2 case-insensitive/markdown-stripped and Pass 3 anchor spans from the worker are preserved!).
   - For fallback substring search, use `normalizeForMatchWithMap` (plus mid-quote `...` clause fallback and prefix+suffix anchor fallback) so quotes with altered casing, single vs double quotes, or outer quotes still resolve cleanly.
3. **Refactor `rehypeHighlightStatements` to Match Across Split HAST Text Nodes**:
   - Instead of only matching within a single HAST `textNode.value`:
     1. Collect all HAST text nodes (excluding descendants of `<pre>`) in document order and build a concatenated virtual plain-text string (inserting virtual block separators `\n` between block elements if needed) where each text node records its `[virtualStart, virtualEnd]` offset range.
     2. Run statement span resolution against this concatenated virtual plain-text string using `normalizeForMatchWithMap` (which strips `*`, `_`, `` ` ``, `~`, normalizes quotes, and compares case-insensitively, with mid-quote `...` and prefix+suffix anchor fallback).
     3. Map each resolved `[virtualStart, virtualEnd]` statement span back onto every intersecting HAST text node (slicing each intersecting text node's local range and wrapping the matched slice in `<mark data-statement-id="..." data-verdict="..." class="therascript-verified-mark ...">`).
     4. Ensure non-empty text node segments wrapped inside `<code>`, `<strong>`, `<em>`, etc. all carry `data-statement-id={String(stmt.id)}` so clicking any part of a highlighted statement opens `StatementVerdictModal` for that statement.

### Unit Tests
- Expand `packages/ui/src/utils/highlightVerifiedStatements.test.ts`:
  - Test `resolveStatementSpans` preserves worker `start_char`/`end_char` when `exact_quote` differs by case (`Using` vs `using`), quote style (`'Inspect'` vs `"Inspect"`), or Pass 3 anchor slack.
  - Test `resolveStatementSpans` fallback matches statements wrapped in outer quotes `"..."`, leading/trailing `...`, and inline Markdown `**bold**` / `` `code` ``.
  - Test `rehypeHighlightStatements` highlights statements that span across inline `<code>`, `<strong>`, and `<em>` HAST elements (e.g., a sentence containing `` `padding-top` `` and `**Summary**` parsed from Markdown into HAST).

### Verification Commands
```bash
yarn --cwd packages/ui test src/utils/highlightVerifiedStatements.test.ts
yarn --cwd packages/ui build
```

---

## Task 6: Surface Failed Verifications, Wire Single-Chat & Single-Message Verification Actions, and Polish Audit UX

### Background & Problem
1. **Failed message verifications (`status = 'failed'`) are invisible in the UI**:
   - In `ChatMessageBubble.tsx:127,262`, `verification.status === 'completed'` is required before rendering anything. When a message's verification fails (5 of 26 messages in dev DB!), the chat bubble renders nothing at all — no error badge, no tooltip with `error_message`, and no retry option.
   - In `VerificationAuditPage.tsx` (`LiveJobBanner`), `JobHistoryTab.tsx`, and `CoverageTab.tsx`, Job #1 displays `completed`, `26/26` messages, `7 issues flagged`, with zero indication that 5 messages failed verification with LLM errors.
2. **Dead / Unwired API Endpoints & Duplicate Client Helpers**:
   - `packages/ui/src/api/verification.ts` defines two duplicate functions for `POST /api/sessions/:id/chats/:chatId/verify`: `triggerSingleChatVerification` (`line 114`) and `verifySingleChat` (`line 403`), plus `deleteMessageVerification` (`line 378`, `DELETE /api/verification/messages/:messageId`).
   - **None of these functions are called anywhere in the UI!** A user viewing a session chat has no button to fact-check the current chat in-place, and no way to clear or re-verify a single message's verification.
3. **`StatementVerdictModal.tsx` renders `<Badge>UNKNOWN</Badge>` for speaker**:
   - When `item.speaker` is `'UNKNOWN'` (in existing DB rows), `StatementVerdictModal.tsx:343` displays a blue `UNKNOWN` speaker badge next to the paragraph timestamp.

### Target Files
- `packages/ui/src/api/verification.ts`
- `packages/ui/src/components/SessionView/Chat/ChatMessageBubble.tsx`
- `packages/ui/src/components/SessionView/Chat/ChatMessageBubble.test.tsx`
- `packages/ui/src/components/SessionView/Chat/ChatPanelHeader.tsx`
- `packages/ui/src/components/SessionView/Chat/ChatInterface.tsx`
- `packages/ui/src/components/Verification/StatementVerdictModal.tsx`
- `packages/ui/src/components/Verification/VerificationAuditPage.tsx`
- `packages/ui/src/components/Verification/CoverageTab.tsx`
- `packages/ui/src/components/Verification/JobHistoryTab.tsx`

### Implementation Instructions
1. **Clean up `packages/ui/src/api/verification.ts`**:
   - Consolidate `triggerSingleChatVerification` and `verifySingleChat` (keep `triggerSingleChatVerification` as the canonical implementation and alias `verifySingleChat = triggerSingleChatVerification` if needed for backwards compatibility).
2. **Render Failed Verification State & Clear/Retry Actions in `ChatMessageBubble.tsx`**:
   - When `verification?.status === 'failed'`, render the verification footer strip with a red/amber badge (`Fact-check failed`), a tooltip showing `verification.error_message || 'Verification failed for this message'`, and a "Clear" button (`deleteMessageVerification(message.id)`) so the user knows why the message has no verdict badge.
3. **Wire Single-Chat "Fact Check" Action in `ChatPanelHeader.tsx` & `ChatInterface.tsx`**:
   - For session chats (`!isStandalone && session?.status === 'completed' && activeChatId !== null`), add a compact "Fact Check Chat" button (`ShieldCheck` icon from `lucide-react` or Radix icon) in `ChatPanelHeader.tsx`.
   - Clicking it calls `triggerSingleChatVerification(session.id, activeChatId)` (with `skipVerified: true` by default), connects to `useVerificationStream` for the returned `job.id`, shows a spinner/progress state while the chat is being verified, and invalidates `['chatVerifications', session.id, activeChatId]` and `['verificationStats']` as messages complete.
4. **Add "Clear Verification" Action in `StatementVerdictModal.tsx`**:
   - Add a "Clear Verification" button in the modal footer (`deleteMessageVerification(verification.message_id)`) that invalidates `['chatVerifications']` and `['verificationStats']` and closes the modal so a user can reset and re-run verification on an individual message.
   - In `StatementVerdictModal.tsx:343`, hide the speaker badge when `!item.speaker || item.speaker.trim().toUpperCase() === 'UNKNOWN'`.
5. **Surface Failed Verification Counts in `CoverageTab.tsx`, `VerificationAuditPage.tsx`, and `JobHistoryTab.tsx`**:
   - In `CoverageTab.tsx`, display a red/amber badge (`X failed`) when `summary.failedAiMessages > 0` alongside `verifiedAiMessages / totalAiMessages`, with a "Retry Failed" button (`onVerifySession(summary.sessionId)` which runs with `skipVerified: true`).
   - In `VerificationAuditPage.tsx` (`VerificationOverviewStrip` / `LiveJobBanner`), if `stats.totals.failedMessagesCount > 0`, note how many messages failed verification and offer a one-click retry.

### Unit Tests
- Update `packages/ui/src/components/SessionView/Chat/ChatMessageBubble.test.tsx` (or add verification tests):
  - Verify `ChatMessageBubble` renders the `Fact-check failed` badge and error tooltip when `verification.status === 'failed'`.
  - Verify `StatementVerdictModal` hides the speaker badge when `speaker === 'UNKNOWN'` and invokes `deleteMessageVerification` when "Clear Verification" is clicked.

### Verification Commands
```bash
yarn --cwd packages/ui test
yarn --cwd packages/ui build
```

---

## Task 7: Update System Documentation & Add Release Changeset

### Background & Problem
- Zero documentation files (`AGENTS.md`, `docs/API_REFERENCE.md`, `docs/SCHEMA_REFERENCE.md`, `docs/DATA_FLOWS.md`, `docs/COMPONENT_MAP.md`, `docs/NAVIGATION.md`) were updated on this branch despite adding a new background worker queue (`verification-jobs`), 3 new SQLite tables (`verification_jobs`, `message_verifications`, `verified_statements`), a new system prompt (`system_verification_judge`), 10 new REST API endpoints, and a new top-level UI page (`/audit`).
- Per repository rules (`AGENTS.md` & Orchestrator Execution Protocol #5), all user-facing changes must include a changeset under `.changeset/`.

### Target Files
- `AGENTS.md`
- `docs/API_REFERENCE.md`
- `docs/SCHEMA_REFERENCE.md`
- `docs/DATA_FLOWS.md`
- `docs/COMPONENT_MAP.md`
- `docs/NAVIGATION.md`
- `.changeset/fact-verification-audit.md`

### Implementation Instructions
1. **Update `AGENTS.md`**:
   - Under `## 1. Background Workers`, document the **Verification Agent (The Fact-Checker / Judge)**: BullMQ queue `verification-jobs`, source `packages/worker/src/jobs/verificationProcessor.ts`, system prompt `system_verification_judge`, workflow (claims extraction, quote span resolution, transcript evidence hydration, accuracy scoring, Redis pub/sub progress streaming).
2. **Update `docs/`**:
   - `docs/SCHEMA_REFERENCE.md`: Document `verification_jobs`, `message_verifications`, and `verified_statements` tables and columns (Migration V10).
   - `docs/API_REFERENCE.md`: Document `/api/verification/jobs`, `/api/verification/jobs/:jobId`, `/api/verification/jobs/:jobId/cancel`, `/api/verification/jobs/:jobId/stream`, `/api/verification/stats`, `/api/verification/statements`, `/api/verification/messages/:messageId`, `/api/verification/reset`, `/api/sessions/:id/verifications`, `/api/sessions/:id/chats/:chatId/verifications`, and `/api/sessions/:id/chats/:chatId/verify`.
   - `docs/DATA_FLOWS.md`, `docs/COMPONENT_MAP.md`, `docs/NAVIGATION.md`: Add the Fact Verification / Hallucination Audit flow and component locations (`packages/ui/src/components/Verification/*`, `packages/ui/src/utils/highlightVerifiedStatements.ts`).
3. **Add release changesets (one per task)**:
   - Each of Tasks 1–6 ships its own changeset under `.changeset/` (`task-1-verification-accounting.md` … `task-6-failed-verification-ux.md`), listing only the packages that task changed. Task 7 itself is docs-only. (The single-umbrella `.changeset/fact-verification-audit.md` was removed as redundant.)

### Verification Commands
```bash
yarn build
yarn test
```

