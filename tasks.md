# Fact-Checking & Verification UI / Worker Follow-Up Tasks

Sequential, self-contained engineering tasks for the Hallucination Audit (`/verification`) UI and the Verification Judge worker (`packages/worker/src/jobs/verificationProcessor.ts`). Work through these tasks in order (`Task 1` → `Task 5`), marking each checkbox (`- [x]`) and running its **Verification** commands before moving to the next.

For background on the Verification Agent and LLM lifecycle, see `AGENTS.md` (§1 "Verification Agent", §3 "Session Chat Agent"), `docs/DATA_FLOWS.md`, and `docs/SCHEMA_REFERENCE.md`.

---

### - [x] Task 1: Keep Transcript Coverage message count and failed badge on a single line

- **Problem & Investigation Context:**
  In the Fact Check (`/verification`) **Transcript Coverage** tab (`packages/ui/src/components/Verification/CoverageTab.tsx`, lines 111–128), the `Coverage` column cell (`<Table.Cell justify="end">`) currently wraps the message counter (`{session.verifiedAiMessages} / {session.totalAiMessages} msgs`) and the failure badge (`{session.failedAiMessages} failed`) inside `<Flex direction="column" align="end" gap="1">`. When `session.failedAiMessages > 0`, this stacks `0 / 1 msgs` on top and `1 failed` on a second line, inflating row height and misaligning the compact table layout. Both elements should sit side-by-side on a single horizontal line.

- **Target Files:**
  - `packages/ui/src/components/Verification/CoverageTab.tsx`
  - `packages/ui/src/components/Verification/CoverageTab.test.tsx`

- **Implementation Detail:**
  1. In `packages/ui/src/components/Verification/CoverageTab.tsx` (lines 111–128), change the `<Flex>` inside the `Coverage` `<Table.Cell justify="end">` from `direction="column" align="end" gap="1"` to a single-line horizontal row:
     - Use `<Flex direction="row" align="center" justify="end" gap="2" wrap="nowrap" style={{ whiteSpace: 'nowrap' }}>` (or equivalent inline flex styling).
     - Ensure both the `<Text size="2">` (`{session.verifiedAiMessages} / {session.totalAiMessages} msgs`) and the `<Badge color="red" variant="soft" size="1">` (`{session.failedAiMessages} failed`) have `style={{ whiteSpace: 'nowrap', flexShrink: 0 }}` so neither wraps internally when table width is tight.
  2. Keep the existing `title` tooltip on the failed `<Badge>` (`"${session.failedAiMessages} message verification attempt(s) failed — click row to inspect or re-audit"`).
  3. Update `packages/ui/src/components/Verification/CoverageTab.test.tsx` to assert that when `failedAiMessages > 0`, the coverage cell's flex container renders as a single-line row (`rt-r-fd-row` / `flex-Wrap: nowrap` or `whiteSpace: nowrap`) containing both `{verifiedAiMessages} / {totalAiMessages} msgs` and `{failedAiMessages} failed`.

- **Acceptance Checks:**
  - In `CoverageTab`, a session row with `verifiedAiMessages = 0`, `totalAiMessages = 1`, `failedAiMessages = 1` renders `0 / 1 msgs` and `1 failed` side-by-side on one horizontal line, right-aligned in the `Coverage` column.
  - Rows with `failedAiMessages === 0` still render `{verifiedAiMessages} / {totalAiMessages} msgs` right-aligned without extra spacing artifacts.

- **Verification:**
  - `yarn --cwd packages/ui test src/components/Verification/CoverageTab.test.tsx`
  - `yarn --cwd packages/ui typecheck`

---

### - [ ] Task 2: Remove duplicate loading spinner from the live audit progress banner

- **Problem & Investigation Context:**
  When a fact-check audit is running on `/verification`, `LiveJobBanner` in `packages/ui/src/components/Verification/VerificationAuditPage.tsx` (lines 80–200) renders **two** `<Spinner>` components simultaneously:
  1. Line 103: `<Spinner size="2" />` in the header row next to `<Heading size="3">Audit #{display.id} in progress...</Heading>`.
  2. Line 140: `<Spinner size="1" aria-hidden="true" />` in the phase status row immediately next to `<Text size="2" weight="medium" data-testid="audit-live-phase">{phaseText}</Text>` (where `"Generating assessment..."` / `"Loading Judge model..."` is displayed).
  Having two spinners stacked a few pixels apart looks cluttered. Keep the title spinner (`<Spinner size="2" />` at line 103) and remove the second spinner at line 140.

- **Target Files:**
  - `packages/ui/src/components/Verification/VerificationAuditPage.tsx`
  - `packages/ui/src/components/Verification/VerificationAuditPage.progress.test.tsx`

- **Implementation Detail:**
  1. In `packages/ui/src/components/Verification/VerificationAuditPage.tsx` inside `LiveJobBanner` (around lines 139–152):
     - Remove `<Spinner size="1" aria-hidden="true" />` from the phase row (`<Flex align="center" gap="2">`), leaving the `<Text size="2" weight="medium" data-testid="audit-live-phase">{phaseText}</Text>` and the elapsed time `<Text size="1" color="gray">` intact.
     - Keep `<Spinner size="2" />` in the banner header next to `Audit #{display.id} in progress...`.
  2. In `packages/ui/src/components/Verification/VerificationAuditPage.progress.test.tsx`, add or update an assertion verifying that `LiveJobBanner` renders only a single spinner while `audit-live-phase` is displayed.

- **Acceptance Checks:**
  - While an audit job is in `pending` or `processing` status, `LiveJobBanner` displays the spinner next to `Audit #<id> in progress...` and **no** second spinner next to the `data-testid="audit-live-phase"` text.
  - Existing `data-testid="audit-live-phase"` and `data-testid="audit-live-elapsed"` elements remain intact.

- **Verification:**
  - `yarn --cwd packages/ui test src/components/Verification/VerificationAuditPage.progress.test.tsx`
  - `yarn --cwd packages/ui typecheck`

---

### - [ ] Task 3: Show live token generation speed (`~X.X tokens/s`) during an active fact-check audit

- **Problem & Investigation Context:**
  In Session Chat (`packages/ui/src/components/SessionView/Chat/ChatInterface.tsx`, lines 203–222, and `packages/ui/src/components/SessionView/Chat/ChatMessageBubble.tsx`, lines 567–579) and Cross-Session Analysis (`packages/worker/src/jobs/analysisProcessor.ts`, lines 784–810, and `packages/ui/src/hooks/useAnalysisStream.ts`, lines 151–196), the user sees live token generation speed (`~X.X tokens/s`) while the LLM is streaming tokens (including `<think>` reasoning tokens).
  By contrast, `runJudgeStreamAttempt` in `packages/worker/src/jobs/verificationProcessor.ts` (lines 1648–1674) consumes the `streamChatCompletion` generator silently without publishing streaming token progress, so during long Judge generations `LiveJobBanner` on `/verification` shows a static phase string with no indication of whether the model is actively generating tokens or how fast it is running.

- **Target Files:**
  - `packages/queue/src/types.ts`
  - `packages/worker/src/jobs/verificationProcessor.ts`
  - `packages/ui/src/hooks/useVerificationStream.ts`
  - `packages/ui/src/components/Verification/VerificationAuditPage.tsx`
  - `packages/worker/src/jobs/verificationProcessor.test.ts`
  - `packages/ui/src/components/Verification/VerificationAuditPage.progress.test.tsx`

- **Implementation Detail:**
  1. **Extend `VerificationStreamEvent` (`packages/queue/src/types.ts`):**
     - Add optional streaming telemetry fields to `VerificationStreamEvent`:
       - `tokensPerSecond?: number | null;` (live generation rate for the current Judge call)
       - `generatedTokens?: number | null;` (cumulative estimated/reported tokens generated in the current attempt)
     - Optionally allow `'token'` on `VerificationStreamEvent['type']` or emit throttled `'phase'` updates during `runJudgeStreamAttempt` (reusing `'phase'` with `phase: 'generating'` / `'retrying'` and `tokensPerSecond` avoids adding a new event branch in consumers, or support both cleanly).
  2. **Compute and publish live token speed in `packages/worker/src/jobs/verificationProcessor.ts`:**
     - Inside `runJudgeStreamAttempt` (lines 1648–1674), track token generation using the same heuristic used by `ChatInterface.tsx` (lines 204–222) and `useAnalysisStream.ts` (lines 151–196):
       - On each `thinking` or `content` chunk with non-empty `chunk.text`:
         - Record `firstTokenAt = Date.now()` on the first non-empty chunk of the attempt.
         - Increment `estimatedTokens += Math.max(1, Math.floor(chunk.text.length / 4))`.
         - Compute `elapsedSec = (Date.now() - firstTokenAt) / 1000`; when `elapsedSec > 0.1`, compute `tokensPerSecond = Math.round((estimatedTokens / elapsedSec) * 10) / 10`.
       - Throttle Redis publishes (e.g., at most once every `250ms`–`400ms`) so fast token streams do not flood Redis/SSE, publishing a `VerificationStreamEvent` via `publishVerificationEvent` with the current `phase` (`'generating'` or `'retrying'`), `message`, `messageId`, `messageIndex`, `attempt`, `tokensPerSecond`, `generatedTokens`, and current job counters. Do not write to SQLite on per-token ticks (`updateJobPhase` is only called on phase transitions).
       - When transitioning out of `generating`/`retrying` (e.g., to `checking_message`, `finishing`, `message_verified`, `complete`, `error`), reset `tokensPerSecond` to `null` so stale speed does not linger after generation finishes.
  3. **Track `tokensPerSecond` in `packages/ui/src/hooks/useVerificationStream.ts`:**
     - Add `tokensPerSecond: number | null` (and optionally `generatedTokens: number | null`) to `VerificationStreamProgress` (initialized to `null`).
     - In `connect()` SSE handler:
       - Update `tokensPerSecond` when `data.tokensPerSecond !== undefined` on `phase` (or `token`) events.
       - Reset `tokensPerSecond: null` when a phase transition changes away from `'generating'`/`'retrying'` without a speed value, or on `message_verified` / `complete` / `error` / terminal `status`.
  4. **Render token speed in `LiveJobBanner` (`packages/ui/src/components/Verification/VerificationAuditPage.tsx`):**
     - Match the transcript chat format (`~${tokensPerSecond.toFixed(1)} tokens/s`, see `ChatMessageBubble.tsx` line 573):
       - When `progress?.tokensPerSecond != null && progress.tokensPerSecond > 0` during an active job, display `<Text size="1" color="gray" data-testid="audit-live-tps" style={{ fontVariantNumeric: 'tabular-nums' }}>~{progress.tokensPerSecond.toFixed(1)} tokens/s</Text>` in the live phase row (e.g., right-aligned alongside `data-testid="audit-live-elapsed"` or inline next to the phase text, separated cleanly).

- **Acceptance Checks:**
  - While the Judge LLM is streaming `<think>` or content chunks for a message, `LiveJobBanner` displays `~X.X tokens/s` (`data-testid="audit-live-tps"`).
  - Redis/SSE event publishing during token streaming is throttled (no SQLite writes per token chunk, and at most ~3–4 Redis messages/sec).
  - Once a message finishes verification or the job enters a non-generating phase (`loading_judge`, `checking_message`, `finishing`, or terminal), the `~X.X tokens/s` indicator clears cleanly.

- **Verification:**
  - `yarn --cwd packages/worker test src/jobs/verificationProcessor.test.ts`
  - `yarn --cwd packages/ui test src/components/Verification/VerificationAuditPage.progress.test.tsx`
  - `yarn --cwd packages/queue typecheck && yarn --cwd packages/worker typecheck && yarn --cwd packages/ui typecheck`

---

### - [ ] Task 4: Replace raw database message IDs (`"Working on message 1914"`) with human-readable message previews

- **Problem & Investigation Context:**
  During an active audit on `/verification`, `LiveJobBanner` shows phase descriptions generated by two places:
  1. `describeVerificationPhase` in `packages/worker/src/jobs/verificationProcessor.ts` (lines 1849–1877):
     - `'checking_message'` → `"Checking message 1 of 1…"`
     - `'generating'` → `"Generating assessment for message 1914 (attempt 1)…"`
     - `'retrying'` → `"Retrying message 1914 with thinking disabled (attempt 2)…"`
  2. `phaseFallbackText` in `packages/ui/src/components/Verification/VerificationAuditPage.tsx` (lines 49–59, used when rendering from a DB job snapshot before/between SSE `phase` events):
     - `'checking_message' | 'generating'` → ``Working on message ${job.current_message_id}…`` (e.g., `"Working on message 1914…"`).
     - `'retrying'` → ``Retrying message ${job.current_message_id} (attempt ${job.current_attempt ?? 2})…``
  Users have no idea what internal SQLite primary key `1914` refers to. They need to see the first few words of the message being audited (and/or its session/prompt context), e.g., `"Working on (1/3): \"SOAP Note — Subjective: Client reported…\""`.

- **Target Files:**
  - `packages/domain/src/index.ts`
  - `packages/queue/src/types.ts`
  - `packages/data/src/repositories/verificationRepository.ts`
  - `packages/worker/src/jobs/verificationProcessor.ts`
  - `packages/ui/src/hooks/useVerificationStream.ts`
  - `packages/ui/src/components/Verification/VerificationAuditPage.tsx`
  - `packages/worker/src/jobs/verificationProcessor.test.ts`
  - `packages/ui/src/components/Verification/VerificationAuditPage.progress.test.tsx`

- **Implementation Detail:**
  1. **Create a clean message-preview formatter helper:**
     - Strip any `<think>...</think>` blocks (and unclosed `<think>...` prefix), strip common markdown formatting symbols (`#`, `*`, `_`, `` ` ``, `>`, list bullets), collapse whitespace into single spaces, and take the first ~8–10 words (capped at ~60 characters with an ellipsis `…` if truncated).
     - Example: `"### **SOAP Note**\n\n#### **S – Subjective**\nThe client opened the session..."` → `"SOAP Note S – Subjective The client opened the…"`.
     - Export this helper (e.g., `formatMessagePreview(text: string, maxWords?: number, maxChars?: number): string`) from `@therascript/domain` or `@therascript/services` (or define consistently in `verificationRepository` / `verificationProcessor`).
  2. **Populate preview on `BackendVerificationJob` snapshots (`packages/data/src/repositories/verificationRepository.ts` & `packages/domain/src/index.ts`):**
     - Add optional `current_message_preview?: string | null;` to `BackendVerificationJob` in `packages/domain/src/index.ts`.
     - In `packages/data/src/repositories/verificationRepository.ts`, update `selectJobByIdSql` and `findAllVerificationJobs` (or `mapJobRow`) so when `current_message_id IS NOT NULL`, it resolves the raw message text via a scalar subquery `(SELECT m.text FROM messages m WHERE m.id = verification_jobs.current_message_id)` and maps it through the preview formatter into `current_message_preview: string | null`. This requires **no** database migration and ensures initial SSE snapshots and page reloads have the preview immediately.
  3. **Include preview in worker `phase` events (`packages/worker/src/jobs/verificationProcessor.ts` & `packages/queue/src/types.ts`):**
     - Add `messagePreview?: string | null;` to `VerificationStreamEvent` in `packages/queue/src/types.ts`.
     - In `verificationProcessor.ts`, compute `const messagePreview = formatMessagePreview(extractVisibleAnswer(candidate.text) || candidate.text)` for the candidate message.
     - Pass `messagePreview` into `recordAndPublishPhase(...)` and `describeVerificationPhase(...)`:
       - Instead of `"Generating assessment for message 1914 (attempt 1)…"`, format human-friendly text using the 1-based position (`messageIndex` of `totalMessages`) and the preview quote, e.g.:
         - `checking_message`: `Checking message 1 of 3: "${messagePreview}"…` (or `Checking "${messagePreview}"…` when `totalMessages === 1`)
         - `generating`: `Generating assessment (1 of 3): "${messagePreview}"…` (include `(attempt 2)` only when `attempt > 1`)
         - `retrying`: `Retrying assessment (1 of 3, attempt ${attempt}): "${messagePreview}"…`
       - Only fall back to `message #${messageId}` if `messagePreview` is empty/unavailable.
  4. **Update UI fallback in `packages/ui/src/components/Verification/VerificationAuditPage.tsx` and `useVerificationStream.ts`:**
     - Propagate `messagePreview` in `VerificationStreamProgress` in `useVerificationStream.ts`.
     - In `phaseFallbackText(job)` in `VerificationAuditPage.tsx` (lines 49–59), prefer `job.current_message_preview` over `job.current_message_id`:
       - When `job.current_message_preview` is present:
         - `'checking_message' | 'generating'` → `Working on "${job.current_message_preview}"…`
         - `'retrying'` → `Retrying "${job.current_message_preview}" (attempt ${job.current_attempt ?? 2})…`
       - Only fall back to `Working on message #${job.current_message_id}…` if `current_message_preview` is null/empty.

- **Acceptance Checks:**
  - Live `phase` events during an audit never show raw `"Generating assessment for message 1914"`; they display the human-readable preview of the message being audited.
  - Reloading `/verification` mid-audit (hydrating from `GET /api/verification/jobs` or the SSE initial `snapshot`) shows `Working on "<first few words…>"…` instead of `Working on message 1914…`.

- **Verification:**
  - `yarn --cwd packages/data test`
  - `yarn --cwd packages/worker test src/jobs/verificationProcessor.test.ts`
  - `yarn --cwd packages/ui test src/components/Verification/VerificationAuditPage.progress.test.tsx`
  - `yarn typecheck`

---

### - [ ] Task 5: Fix Judge LLM thinking handling, sampling defaults, context budget, and prompt structure so reasoning models (`qwen3.8-27b`) succeed without ever disabling thinking

- **Problem & Investigation Context:**
  Audits #2 and #3 in production (`packages/api/data/therapy-analyzer-prod.sqlite`) audited `message 1914` (a SOAP note in `chatId = 1019`, `sessionId = 854` `"KD-Oct21-2026"`, 353 transcript paragraphs, `~17,101` prompt tokens) using Judge model `qwen3.8-27b` on an RTX 5090 with `context_size = 50000` (Job 3) and `60000` (Job 2). Both failed with:
  > `All 1 attempted assessment failed (job 3, judge "qwen3.8-27b"). First failure [empty_output]: [empty_output] Judge returned no output for message 1914 (job 3, judge "qwen3.8-27b", retrying, attempt 2 of 2, 305.9s, 34259+30000 tokens): Judge LLM returned no visible output (empty or thinking-only response). Retries exhausted (1 retry with thinking disabled).`

  Meanwhile, in the **exact same database**, `session_chat` using `qwen3.8-27b` (`usage_logs` IDs `1064`–`1077`) succeeded **14 out of 14 times** on 10k–25k token session transcripts (generating `2,158`–`6,922` completion tokens in `32s`–`87s`).

  Investigation comparing `sessionChatHandler.ts` / `SelectActiveModelModal.tsx` against `verificationProcessor.ts` / `StartVerificationModal.tsx` / `LlmSettingsForm.tsx` revealed **five compounding bugs** in how Fact Checking configures and invokes the LLM:

  1. **Verification artificially strangles thinking on Attempt 1 and disables thinking on Attempt 2 (Retry):**
     - **User Directive:** *"NEVER do that. If a model is thinking, use thinking. Take a look at how we choose and run chats on a session transcript. That one has logic for dealing with thinking and whatnot."*
     - In `packages/worker/src/jobs/verificationProcessor.ts`:
       - Line 99 defines `export const JUDGE_MAX_THINKING_BUDGET = 2048;` and `resolveJudgeThinkingBudget` (lines 111–116) clamps `thinking_budget = -1` (unrestricted) down to `2048` (`reasoning_budget: 2048`).
       - `StartVerificationModal.tsx` (line 42) also overrides `-1` with `JUDGE_DEFAULT_THINKING_BUDGET = 1024`.
       - Worse, on Attempt 2 (`attempt === 1` in `processVerificationJob`, lines 2110–2148), the worker forces `thinkingBudget: 0` and `chatTemplateKwargs: { enable_thinking: false }` (`"Retrying message X with thinking disabled"`).
       - With `qwen3.8-27b` in LM Studio, passing `reasoning_budget: 2048` or `enable_thinking: false` does not stop `<think>` emission, and clamping/disabling thinking violates how `sessionChatHandler.ts` runs models: Session Chat defaults `thinkingBudget` to `-1` (unrestricted) and passes `getConfiguredThinkingBudget()` straight through to `streamChatCompletion` without clamping or disabling thinking on retry.
  2. **`LlmSettingsForm.tsx` silently overwrites `temperature = 0.3` with `0.7` when the user selects a model in `StartVerificationModal`:**
     - In `packages/ui/src/components/Verification/StartVerificationModal.tsx` (line 41), the modal initializes `temperature` to `JUDGE_DEFAULT_TEMPERATURE = 0.3`.
     - However, in `packages/ui/src/components/Shared/LlmSettingsForm.tsx` (lines 160–173), a `useEffect` watches `[state.selectedModel, llmStatus?.activeModel]` and whenever `state.selectedModel !== llmStatus?.activeModel` (which happened in Jobs 2 and 3 because `app_settings.llm_model_name` was `'default'` while the user selected `'qwen3.8-27b'`), it executes:
       `onChange({ temperature: 0.7, topP: 0.9, repeatPenalty: 1.1, thinkingBudget: -1 })`!
     - As verified in SQLite (`SELECT temperature, thinking_budget FROM verification_jobs WHERE id IN (2, 3)`), **both Jobs 2 and 3 ran with `temperature = 0.7` instead of `0.3`!**
     - As documented in `packages/services/src/llamaCppClient.ts` (line 263) and `packages/worker/src/jobs/analysisProcessor.ts` (line 691), `temperature: 0.7` on structured extractive prompts causes reasoning models (`Qwen3`, `DeepSeek-R1`) to enter repetitive verification spirals inside `<think>`.
  3. **`allocateJudgeContextBudget` caps `maxCompletionTokens` at 30% of `contextSize` (`15,000` tokens) even when 33,000 tokens of context are unused:**
     - In `packages/worker/src/jobs/verificationProcessor.ts` (lines 586–620), `allocateJudgeContextBudget(50000)` pre-caps `maxCompletionTokens = Math.floor(50000 * 0.3) = 15000` *before* measuring the actual prompt (`17,101` tokens).
     - Even though `50,000 - 17,101 = 32,899` tokens of context window were available, `runJudgeStreamAttempt` passed `maxCompletionTokens: 15000` (`max_tokens: 15000`) to LM Studio. In both attempts of Job 3, `qwen3.8-27b` hit the exact `15,000` completion token ceiling (`18,000` in Job 2 for `60,000 * 0.3`) while still inside `<think>`, getting truncated right before emitting the closing `</think>` and JSON output!
     - In `sessionChatHandler.ts` (lines 226–234), `streamChatResponse` does **not** pass an artificial 30% `maxCompletionTokens` cap, allowing the model to use the remaining context window for `<think>` + answer.
  4. **Message role layout & `prepareLlmChatMessages` differ from Session Chat:**
     - In `packages/api/src/api/sessionChatHandler.ts` (lines 174–222), the session transcript is placed in the `system` message (`systemPromptWithContext = "${baseSystemPrompt}\n\n--- CONTEXT TRANSCRIPT ---\n${transcriptContext}\n--- END CONTEXT ---"`), the `user` message contains only the immediate turn, and the array is normalized via `prepareLlmChatMessages(messagesForLlm)` (`@therascript/services`). Putting the static session transcript in `system` also allows llama.cpp / LM Studio to reuse the KV cache across multiple audited messages in the same session.
     - In `verificationProcessor.ts` (`buildJudgeUserMessage`, lines 1550–1562), the entire 353-paragraph transcript (`[P#28551 00:00] ...`), the 3,687-character SOAP template user prompt, and the 4,475-character AI SOAP note were all concatenated into a single huge `user` message without `prepareLlmChatMessages`.
  5. **The `system_verification_judge` prompt triggers exhaustive per-paragraph `<think>` loops (including mental millisecond math):**
     - Look at `SYSTEM_PROMPT_TEMPLATES.VERIFICATION_JUDGE` in `packages/db/src/sqliteService.ts` (lines 147–206) and `DEFAULT_VERIFICATION_JUDGE_PROMPT` in `packages/worker/src/jobs/verificationProcessor.ts` (lines 1086–1145):
       - It asks the model to compute `"timestampMs"` in milliseconds from `MM:SS` (`"your best estimate in milliseconds for the cited paragraph (the MM:SS label is minutes:seconds)"`) AND copy `"speaker"`. Yet `hydrateEvidenceItem` in `verificationProcessor.ts` (lines 891–948) **completely overwrites** `timestampMs` and `speaker` from the ground-truth `transcript_paragraphs` row using `paragraphIndex`! Asking a thinking model to convert `MM:SS` to milliseconds for dozens of citations forces it to do arithmetic (`34 * 60000 + 12000 = ...`) inside `<think>` for every single claim.
       - It gives no guidance to keep internal `<think>` reasoning concise/focused, nor to group closely related clauses within the same sentence/bullet into a single claim (`MAX ~15–25 key factual claims`) rather than exploding a 4,500-char SOAP note into 80+ micro-clauses and cross-checking each against 353 paragraphs in `<think>`.
       - **Important DB Seeding Detail:** `seedSystemTemplates` in `packages/db/src/sqliteService.ts` (lines 210–231) is insert-only (`if (!existing)`). Therefore, existing databases (including `therapy-analyzer-prod.sqlite`) already have the old `system_verification_judge` text in the `templates` table, and `verificationProcessor.ts` loads `templateRepository.findTemplateByTitle('system_verification_judge')` first! Updating `SYSTEM_PROMPT_TEMPLATES.VERIFICATION_JUDGE` must also update existing `templates` rows where `title = 'system_verification_judge'` (when the row still matches a prior built-in default) so existing databases actually get the fixed Judge prompt.

- **Target Files:**
  - `packages/worker/src/jobs/verificationProcessor.ts`
  - `packages/worker/src/jobs/verificationProcessor.test.ts`
  - `packages/db/src/sqliteService.ts`
  - `packages/ui/src/components/Shared/LlmSettingsForm.tsx`
  - `packages/ui/src/components/Verification/StartVerificationModal.tsx`
  - `packages/ui/src/components/Verification/StartVerificationModal.test.tsx` (or `VerificationAuditPage` / modal tests)

- **Implementation Detail:**
  1. **Never disable or clamp thinking in the Verification Judge (`packages/worker/src/jobs/verificationProcessor.ts` & `packages/ui/src/components/Verification/StartVerificationModal.tsx`):**
     - Remove `JUDGE_MAX_THINKING_BUDGET = 2048` clamping from `resolveJudgeThinkingBudget` in `verificationProcessor.ts` (lines 99, 111–116):
       - When `job.thinking_budget` is `null` or `undefined`, default to `-1` (unrestricted thinking, matching `sessionChatHandler.ts` and `SelectActiveModelModal.tsx`).
       - Pass `job.thinking_budget` through as-is (`-1` stays `-1`; a positive user-selected budget stays that positive integer; `0` is only used if the user explicitly set `thinkingBudget === 0`).
     - In `StartVerificationModal.tsx` (lines 42, 108–124):
       - Remove `JUDGE_DEFAULT_THINKING_BUDGET = 1024` and the logic that overwrites `-1` with `1024`. Default `thinkingBudget` to `llmStatus.thinkingBudget ?? -1` (unrestricted by default, just like Session Chat).
     - In `processVerificationJob` (`verificationProcessor.ts`, lines 2090–2185):
       - **Never disable thinking on retry.** Remove `chatTemplateKwargs: isRetry ? { enable_thinking: false } : undefined` and remove `thinkingBudget: isRetry ? 0 : effectiveThinkingBudget`.
       - On retry (`attempt === 1`), keep the model's configured `thinkingBudget` (`effectiveThinkingBudget`), lower `temperature` to `0.1`, and append a concise retry reminder to the user prompt instructing the model to keep its reasoning brief and immediately emit the final JSON object.
       - Update `describeVerificationPhase` and failure diagnostics in `verificationProcessor.ts` so they no longer say `"with thinking disabled"` (e.g., `"Retrying assessment..."` and `"Retries exhausted (1 retry)."`).
  2. **Fix `LlmSettingsForm.tsx` so selecting a model does not clobber caller-provided defaults (`packages/ui/src/components/Shared/LlmSettingsForm.tsx` & `StartVerificationModal.tsx`):**
     - In `packages/ui/src/components/Shared/LlmSettingsForm.tsx` (lines 160–173):
       - Add an optional prop `defaultSamplingParams?: { temperature?: number; topP?: number; repeatPenalty?: number; thinkingBudget?: number }` (or `preserveSamplingOnModelChange?: boolean`) to `LlmSettingsFormProps`.
       - When the user changes `selectedModel` in `LlmSettingsForm`, use `defaultSamplingParams?.temperature ?? 0.7`, `defaultSamplingParams?.thinkingBudget ?? -1`, etc. (or in `StartVerificationModal`, keep `temperature: 0.3` and `thinkingBudget: -1` as the defaults when switching models instead of resetting `temperature` to `0.7`).
       - Also ensure that when `StartVerificationModal` opens and `llmStatus.activeModel` is `'default'` (so `LlmSettingsForm` auto-selects the first real model in `models`), it does **not** overwrite `StartVerificationModal`'s initial `temperature: 0.3` with `0.7`!
  3. **Stop starving completion tokens (`allocateJudgeContextBudget` & `runJudgeStreamAttempt` in `packages/worker/src/jobs/verificationProcessor.ts`):**
     - In `allocateJudgeContextBudget(contextSize)` (lines 586–620):
       - Keep `transcriptBudgetTokens` reserved for transcript selection (e.g. `~55%` of `contextSize` after system + user + safety margin so the prompt stays well within `contextSize`), **or** compute the actual remaining token budget **after** selecting the transcript:
         `remainingCompletionTokens = Math.max(JUDGE_MIN_COMPLETION_TOKENS, effectiveContextSize - actualPromptTokens - safetyMarginTokens)`.
       - Do **not** cap `maxCompletionTokens` to `30%` of `contextSize` when the prompt uses less than `70%` of the context window. For example, on a `50,000` context window with a `17,101`-token prompt, the model should have at least `28,000–30,000` tokens available for `<think>` + JSON output (or omit `maxCompletionTokens` / pass the full remaining context capacity minus safety margin).
  4. **Align Judge message structure with `sessionChatHandler.ts` (`packages/worker/src/jobs/verificationProcessor.ts`):**
     - Place the `GROUND-TRUTH SESSION TRANSCRIPT` block in the `system` prompt (just like `sessionChatHandler.ts` lines 174–180: `${systemPrompt}\n\n--- GROUND-TRUTH SESSION TRANSCRIPT ---\n${transcriptBlock}\n--- END TRANSCRIPT ---`), and keep the `user` message focused on the `THERAPIST'S PROMPT / QUESTION` and `AI RESPONSE TO AUDIT`.
     - Run the messages array through `prepareLlmChatMessages` from `@therascript/services` before calling `streamChatCompletion`, matching `sessionChatHandler.ts`.
     - Also note: if the `THERAPIST'S PROMPT / QUESTION` is a long template (e.g. a 3,700-char SOAP note prompt), keep it clearly delimited so the Judge knows it is the instructions given to the AI, while `AI RESPONSE TO AUDIT` is the sole text from which `claims` are extracted.
  5. **Streamline `system_verification_judge` / `DEFAULT_VERIFICATION_JUDGE_PROMPT` so reasoning models don't spiral in `<think>` (`packages/db/src/sqliteService.ts` & `packages/worker/src/jobs/verificationProcessor.ts`):**
     - Update both `SYSTEM_PROMPT_TEMPLATES.VERIFICATION_JUDGE.text` in `packages/db/src/sqliteService.ts` and `DEFAULT_VERIFICATION_JUDGE_PROMPT` in `packages/worker/src/jobs/verificationProcessor.ts`:
       - **Remove `"timestampMs"` and `"speaker"` from the JSON schema requested from the LLM** (or make them optional/omitted in the prompt example and schema): the Judge only needs to output `"paragraphIndex"` and `"quote"` in each `evidence` item, because `hydrateEvidenceItem` in `verificationProcessor.ts` already looks up the paragraph by `paragraphIndex` and populates the ground-truth `timestampMs` and `speaker`! (Keep `hydrateEvidenceItem` backward-compatible if an LLM or test fixture still includes `timestampMs`/`speaker`.)
       - **Add explicit thinking & granularity guidance** for reasoning models:
         - Instruct the Judge: *"If you use `<think>` reasoning, keep your internal thinking brief and focused—do not draft full JSON or convert timestamps in `<think>`. Group closely related details from the same sentence or bullet into a single factual claim (aim for at most 15–25 core factual/clinical claims for long structured notes) rather than splitting every clause."*
         - Instruct the Judge to keep `"reasoning"` concise (1 short sentence per claim).
     - In `packages/db/src/sqliteService.ts` (`seedSystemTemplates` or a schema migration):
       - Ensure existing databases whose `templates` row for `title = 'system_verification_judge'` matches either of the previous built-in default strings are automatically updated to the new `SYSTEM_PROMPT_TEMPLATES.VERIFICATION_JUDGE.text` on startup (while still preserving genuinely custom user edits).

- **Acceptance Checks:**
  - `resolveJudgeThinkingBudget` no longer clamps `-1` or `> 2048` budgets to `2048`; `-1` (unrestricted) is preserved by default.
  - Retrying a failed Judge attempt in `verificationProcessor.ts` **never** sets `thinkingBudget: 0` or `chatTemplateKwargs: { enable_thinking: false }`.
  - Opening `StartVerificationModal` and selecting a model (including when `llmStatus.activeModel` is `'default'`) preserves `temperature = 0.3` and `thinkingBudget = -1` unless the user explicitly changes the temperature slider or thinking budget.
  - For a `50,000` context window and a `~17,000`-token prompt, `runJudgeStreamAttempt` does not cap `maxCompletionTokens` at `15,000`.
  - The Judge prompt no longer asks the LLM to manually calculate `timestampMs` in milliseconds from `MM:SS`, includes concise-thinking / claim-grouping instructions, and updates the seeded `system_verification_judge` row in existing SQLite databases.

- **Verification:**
  - `yarn --cwd packages/db test`
  - `yarn --cwd packages/worker test src/jobs/verificationProcessor.test.ts`
  - `yarn --cwd packages/ui test src/components/Verification`
  - `yarn typecheck`
