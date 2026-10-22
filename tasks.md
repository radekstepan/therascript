# Therascript Production-Readiness Task Plan

This document is structured as a sequential execution plan for an LLM orchestrator delegating work to **subagents in series** (one task at a time).

## Orchestrator Execution Protocol

1. **Run Strictly in Series**: Invoke **one subagent per task** (`Task 1` $\rightarrow$ `Task 2` $\rightarrow$ ... $\rightarrow$ `Task N`) using `Workspace: 'inherit'`. Wait for the active subagent to finish and report back before starting the next task so file edits and builds never collide.
2. **Environment Requirement**: Always ensure Node `23.10.0` (see `.nvmrc` and `AGENTS.md`) is active before running `yarn` commands.
3. **Subagent Handoff Prompt Template**:
   When invoking a subagent for `Task N`, pass:
   - The full section for `Task N` from this file.
   - Instructions to read the listed **Target Files** first, implement the changes, add/update unit tests where specified, run the **Verification** commands, add a changeset, commit the task, and update `tasks.md` to mark `- [x] Task N` upon completion.
4. **Gatekeeping**: Do not advance to `Task N+1` until `Task N`'s verification commands (`yarn test` and package builds) exit `0`.
5. **Record Changes with Changesets**: Every user-facing change must ship with a changeset. Run `yarn changeset` (or add a Markdown file under `.changeset/` by hand) listing the bumped packages plus release-note prose. Cut releases with `yarn version-packages`, which consumes pending changesets and updates `CHANGELOG.md` files. See `.changeset/README.md`.
6. **Commit Every Task**: Each task gets exactly one commit containing the task's code changes **plus its changeset file**. Never batch multiple tasks into one commit and never commit without the changeset. Use `git add` on the task's files only (never `git add -A`), verify with `git diff --cached --name-only`, and write the commit message as subject plus a body writeup (what / why / files / verification).

---

## Tasks

These are implementation instructions for a future execution pass. This editing pass only expands the plan; no task below has been implemented or verified. Paths are relative to the repository root. Read the current working tree before implementing: the new brand components already have local changes, which must be preserved.

For each task, run `yarn test` and the builds listed under **Verification** with Node `23.10.0`. Add focused regression coverage to existing test suites where possible; create a nearby test file if none exists. Include visual/manual checks for layout and interaction changes. Mark a task complete only after its acceptance checks and verification pass.

### - [x] Task 1: Order transcripts newest first in Run Verification Audit

**Target Files:**
- `packages/ui/src/components/Verification/StartVerificationModal.tsx`
- Modal regression coverage; `packages/ui/src/mocks/handlers/verification.ts` for fixtures if needed.

**Implementation Detail:**
- The modal currently builds `visibleSessions` by sorting `sessionName` alphabetically. Sort by the session's `date` descending instead, using the existing `SessionVerificationSummary` date field.
- Define a deterministic tie-breaker, such as descending `sessionId`. Put missing/invalid dates last; avoid mutating the `sessionsSummary` prop.
- Apply the same ordering whether “Hide verified” is enabled or disabled. Filtering and selecting sessions must continue to use session IDs and preserve selections.

**Acceptance Checks:** Dates deliberately out of alphabetical order display newest first; equal and invalid dates have stable ordering; toggling the verified filter does not change the order of remaining entries or lose selections.

**Verification:** `yarn test`; `yarn build:ui`. Open the modal and inspect both filter states.

### - [ ] Task 2: Derive logo colors from the accent and update matching favicons

**Target Files:**
- `packages/ui/src/components/Brand/TherascriptLogo.tsx`, `therascript-logo.css`, and `TherascriptLogo.test.tsx`
- `packages/ui/src/store/ui/accentColorAtom.ts`, `effectiveThemeAtom.ts`, and the theme integration in `packages/ui/src/App.tsx`
- `scripts/generate-favicons.mjs`, `packages/ui/src/utils/favicon.ts`, `favicon.test.ts`, `packages/ui/public/favicons/`, and `packages/ui/public/index.html`
- Inspect existing fallback favicon assets and `plan-logo.md` for the current logo geometry.

**Implementation Detail:**
- Replace the fixed green brand palette with an accent-derived palette for the waveform, wordmark, terminal dot, and focus ring. Derive coordinated shades/tints from the selected accent (for example through palette steps and color mixing); do not simply paint every element with the raw accent color.
- Keep the new logo/font, proportions, and home link. Ensure readable wordmark contrast in light, dark, and system appearance. Remove the logo's hover color change and any other logo-specific hover decoration; retain accessible keyboard focus indication.
- Change the favicon artwork to the new waveform mark. Update the generator and regenerate all supported accent/light/dark variants, using the same palette derivation as the on-page mark. Review fallback assets so browsers do not retain the old logo through another icon link.
- Update existing comments/tests that explicitly assert the old fixed-green behavior. Preserve unrelated in-progress logo work.

**Acceptance Checks:** Changing accent or appearance updates every logo instance and the favicon consistently; colors remain distinct and readable for pale accents; hovering does not change the logo; keyboard focus remains visible. Generated SVGs resolve for every supported accent.

**Verification:** `yarn test`; `yarn build:ui`; inspect the sidebar and splash-screen logos plus the browser favicon in light/dark appearance and several contrasting accents.

### - [ ] Task 3: Replace the session chat Fact Check button with a verified-status icon

**Target Files:**
- `packages/ui/src/components/SessionView/Chat/ChatPanelHeader.tsx`, `ChatInterface.tsx`, and `ChatMessages.tsx`
- `packages/ui/src/api/verification.ts` and existing chat header/message tests
- Inspect `packages/api/src/api/verificationHandler.ts` if additional chat-scoped summary data is needed.

**Implementation Detail:**
- Replace the header's actionable “Fact Check Chat” button with a passive status icon. Show it only when every eligible AI note/response in the currently selected transcript chat has a successful verification. A completed assessment with flagged claims still counts as checked; a failed, pending, or absent assessment does not.
- Reuse the backend's verification eligibility rules, including treatment of trivial/skipped messages, instead of counting therapist/user messages. An empty chat or a chat with no eligible AI notes must not show an all-verified icon.
- Derive state from the selected chat's messages and verification records, using the existing `chatVerifications` query/cache. Do not use transcript-wide coverage as a substitute for chat coverage or introduce a second polling loop.
- On hover and keyboard focus, show chat-scoped statistics: checked/eligible notes, failed count, claim verdict totals, omissions, and accuracy where available. Label unknown accuracy appropriately rather than presenting it as zero.
- The icon must not start verification when clicked. Remove obsolete header-only trigger/progress wiring, while preserving audit initiation elsewhere. Hide the icon immediately when a new unchecked AI note is added; refresh it after verification changes or switching chats.

**Acceptance Checks:** Cover fully checked, partially checked, failed, empty, and newly extended chats; standalone chats show no transcript verification icon. Tooltip totals match the selected chat, and the icon has an accessible name/focusable tooltip trigger without button styling.

**Verification:** `yarn test`; `yarn build:ui` (also `yarn build:api` if API changes are necessary).

### - [ ] Task 4: Remember the last successfully queried remote LM Studio URL throughout the app

**Target Files:**
- `packages/ui/src/store/ui/remoteBaseUrlAtom.ts`
- `packages/ui/src/components/Shared/LlmEndpointModelPicker.tsx` and its tests
- `packages/ui/src/components/Shared/LlmSettingsForm.tsx`
- `packages/ui/src/components/SessionView/Modals/SelectActiveModelModal.tsx`, `packages/ui/src/components/Analysis/CreateAnalysisJobModal.tsx`, and `packages/ui/src/components/Verification/StartVerificationModal.tsx`
- Existing modal persistence tests and any other consumers of `remoteBaseUrlAtom`.

**Implementation Detail:**
- Reuse the shared `llm-remote-base-url` localStorage atom, but redefine it as the last known good remote endpoint. Currently modal Save handlers own persistence; move successful-discovery persistence into the shared model-fetch path so saving a model is not required.
- Persist the normalized URL only after the remote models request succeeds with a valid models response. A successful empty list is still a successful connection; HTTP errors or malformed responses must not overwrite the remembered URL.
- Keep typed values transient until success. A delayed response for URL A must not save URL B from the current input. Ignore local-endpoint requests for this preference, and never store API tokens alongside it.
- Prefill all remote endpoint forms from the same remembered value when opened or switched to remote mode. Do not overwrite a user's in-progress edit due to refetches, backend status updates, or another modal's state. Failed edits, clearing the field, and switching to local must preserve the last known good value.
- Remove/update Save-time writes and old comments/tests that would allow an untested URL to replace a good one. This preference must not change the active chat model or running job's endpoint snapshot.

**Acceptance Checks:** A successful discovery in any picker survives modal close and browser reload and prefills other pickers. Failed discovery and unsaved typing preserve the previous good URL. Test URL races, empty successful lists, local mode, and token non-persistence.

**Verification:** `yarn test`; `yarn build:ui`.

### - [ ] Task 5: Separate Fact Check header actions from labels and remove Retry Failed

**Target Files:**
- `packages/ui/src/components/Verification/VerificationAuditPage.tsx` and its tests
- Inspect `CoverageTab.tsx` and `JobHistoryTab.tsx` for shared callbacks before deleting mutation code.

**Implementation Detail:**
- Keep the “Fact Check” title on the first row, with the remaining action buttons grouped on the right. Move all informational labels/badges, including failed and unverified coverage counts, into a separate row below the title/actions.
- Ensure the labels row wraps cleanly on small screens without interleaving with action buttons. Preserve active-job disabling and existing confirmation behavior for destructive actions.
- Remove the “Retry Failed” header button and its action handler, tooltip, loading copy, and now-unused imports. The current `retryFailedMutation` also serves session coverage actions: refactor those callers to the appropriate retained flow before removing shared code.
- Keep normal Run Verification Audit and its skip-already-verified behavior available. Do not remove per-note Clear or unrelated history/cancel actions as part of this task.

**Acceptance Checks:** With failures and unverified items present, all informational badges appear below the first row; remaining buttons are right aligned. No “Retry Failed” header control or orphaned action remains, and session coverage actions still work.

**Verification:** `yarn test`; `yarn build:ui`; inspect desktop and narrow viewport layouts.

### - [ ] Task 6: Stop fetching model lists while only viewing/running an audit

**Target Files:**
- `packages/ui/src/components/Verification/VerificationAuditPage.tsx`, `StartVerificationModal.tsx`
- `packages/ui/src/components/Shared/LlmSettingsForm.tsx`, `LlmEndpointModelPicker.tsx`
- Inspect other mounted model dialogs, particularly `packages/ui/src/components/SessionView/Modals/LlmManagementModal.tsx`
- Relevant query/modal tests and API mocks.

**Implementation Detail:**
- Reproduce with the audit running and all model-selection dialogs closed. Trace calls to `fetchAvailableModels` and the `availableLlmModels` query to identify the actual mounted caller; do not assume the audit's job/stats polling is responsible.
- Propagate dialog visibility to model-discovery query `enabled` conditions, or mount discovery controls only while their dialog is open. Check effects, manual `refetch` calls, and query invalidations as well as the primary query flag.
- Running a job, receiving SSE updates, polling jobs/stats, changing tabs, or refocusing the window must not start model discovery from hidden controls. An already-submitted job uses its snapshotted configuration.
- Retain model fetching when the user opens a model picker or changes its endpoint. Keep necessary LLM status and audit progress requests working. Coordinate with Task 4 so persistence only occurs for intentional, enabled discovery.

**Acceptance Checks:** Assert zero model-list requests during audit viewing/running with dialogs closed, including progress updates and window focus. Opening the audit/model configuration dialog fetches models as expected, and closing it prevents subsequent hidden refetches.

**Verification:** `yarn test`; `yarn build:ui`; inspect browser Network requests during a running audit and after opening/closing its configuration dialog.

### - [ ] Task 7: Prevent the failed-verification Clear control from overlapping its label

**Target Files:**
- `packages/ui/src/components/SessionView/Chat/ChatMessageBubble.tsx` and `ChatMessageBubble.test.tsx`
- Inspect shared button styles if the overlap originates in Radix/overridden ghost-button spacing.

**Implementation Detail:**
- In the failed verification footer, give “Fact-check failed” and Clear separate layout space with an explicit gap. Account for the button's entire hover/focus background and padding, including any negative margins from its variant.
- Use a suitable button variant or scoped styling so hover/focus never paints over the failure label. Support wrapping on narrow message bubbles, long error text, and the “Clearing…” pending state.
- Preserve the existing clear mutation, pending disabling, error handling, tooltip, and cache invalidations; this is a layout fix.

**Acceptance Checks:** Label and button do not overlap at rest, hover, or keyboard focus, including narrow screens and pending state. Clearing still returns the note to an eligible unchecked state.

**Verification:** `yarn test`; `yarn build:ui`; visually inspect hover/focus and narrow layouts (DOM assertions alone cannot establish absence of painted overlap).

### - [ ] Task 8: Show missing audio as a specific warning instead of an unsupported-format error

**Target Files:**
- `packages/ui/src/components/SessionView/Transcription/Transcription.tsx` and nearby regression tests
- `packages/api/src/routes/sessionRoutes.ts` (`GET /api/sessions/:sessionId/audio`)
- `packages/api/src/api/sessionHandler.ts` and audio API helpers only if needed to expose reliable availability.

**Implementation Detail:**
- Handle both normal deletion (no `audioPath`) and external deletion (the database still references a file that no longer exists). A populated path alone is not proof that audio is available.
- Confirm missing-file status from the server; browser media error code 4 can also mean an actual unsupported format. Reuse the audio endpoint's missing-file response or add a lightweight availability check where necessary, without downloading the entire recording just to detect a 404.
- Display “The audio file doesn't exist.” using the app's amber/warning palette for a confirmed missing file. Keep genuine decoding, unsupported-format, and network failures distinguishable instead of relabeling every media error as missing audio.
- Stop loading/playback indicators and disable unavailable playback/seek controls while leaving the transcript readable. Reset stale error/availability state when sessions or audio sources change, and avoid repeated availability requests.

**Acceptance Checks:** Cover null audio path, stale path with a missing file, valid supported audio, unsupported audio, and network failure. Missing audio displays a warning without an indefinite spinner; a subsequent session with valid audio plays normally.

**Verification:** `yarn test`; `yarn build:ui`; `yarn build:api` if the endpoint changes. Manually reproduce external file deletion and ordinary in-app deletion.

### - [ ] Task 9: Make verification progress, failures, and history useful for debugging

**Reported Failure:** A one-note run remains at “Processed 0 / 1 messages — auditing newest first” while the LLM generates output. The worker then reports `Judge LLM did not return valid JSON (empty or unparseable output)` for message `1914` in job `2`, but the job is marked completed and the UI provides no useful explanation or history action. These IDs are reproduction context, not values to hard-code.

**Target Files:**
- `packages/worker/src/jobs/verificationProcessor.ts` and `verificationProcessor.test.ts`
- `packages/data/src/repositories/verificationRepository.ts` and its tests
- `packages/domain/src/schemas/db/verification.ts`; database migrations if durable fields are added
- `packages/queue/src/types.ts`, `packages/worker/src/services/streamPublisher.ts`
- `packages/api/src/api/verificationHandler.ts`, `packages/api/src/routes/verificationRoutes.ts`, and API tests
- `packages/ui/src/api/verification.ts`, `packages/ui/src/hooks/useVerificationStream.ts`
- `packages/ui/src/components/Verification/VerificationAuditPage.tsx`, `JobHistoryTab.tsx`, and their tests
- Session chat failure feedback in `ChatInterface.tsx`/`ChatMessageBubble.tsx`; verification mocks and relevant e2e coverage.

**Implementation Detail — Progress:**
- The worker currently advances the processed counter only after a message succeeds or fails, so `0 / 1` can be numerically correct during generation. Keep processed as finished attempts; add a separate current phase/message indicator rather than pretending work is complete.
- Publish useful phase changes: waiting for the LLM lock, loading the Judge, checking message N of M, generating/parsing the assessment, retrying invalid output, and finishing. Distinguish the first attempt from the existing retry with thinking disabled.
- Carry phase, current message identity, attempt, and elapsed timing through the queue event type, API SSE stream, UI type, and hook as needed. Use truthful indeterminate activity while generating; do not invent token percentages. Preserve enough state in a snapshot/refetch to make reconnects and page reloads understandable.

**Implementation Detail — Failure Semantics and Diagnostics:**
- The per-message catch currently persists a failed assessment and increments processed, but the loop ends with unconditional job status `completed` and a success log. Count succeeded, failed, and skipped messages distinctly across every path, including context-budget failures and trivial-message fast paths.
- A run in which every attempted assessment fails must be marked failed. A mixed run must visibly report “Completed with errors” with success/failure counts, never unqualified success. Either retain `completed` with explicit persisted outcome counts or introduce a distinct status; if adding a status, update every schema, terminal-status guard, queue consumer, history filter, and active-job check consistently. Preserve cancellation and treat a zero-candidate run separately from all-failed.
- Persist a useful job error summary and per-message reason, with job/message IDs and enough context to identify the Judge model, phase/attempt, duration, and token usage. Distinguish empty output, malformed JSON, structural validation failure, provider errors, and exhausted retries. Preserve the existing single retry and usage logging on failed attempts.
- Make failure details available through read APIs and snapshots, not just transient SSE/toasts. Surface them in the audit banner or a persistent terminal result, the affected note, and Job History. Errors must remain inspectable after the active-job banner disappears or the page reloads.
- Provide a history “View details” action for failed or mixed-outcome runs, showing failed message reasons and links to the affected session/chat/note using the existing navigation conventions. Do not reintroduce the header Retry Failed action removed in Task 5.
- Prevent generic “complete” toasts and success logs from masking failures. Handle missing SSE events with the existing polling/refetch path; distinguish connection trouble from an actual Judge failure. Ensure cleanup/model unload still executes on every terminal path.
- Keep diagnostics concise and bounded. Do not expose API tokens, full therapy transcripts, or raw model reasoning in error messages; summaries, provider error codes, and existing usage metrics should supply the debugging context.

**Acceptance Checks:**
- A slow successful one-message run shows the active phase before its processed count increments, then an accurate final result.
- Empty output, malformed JSON after the permitted retry, invalid response structure, and provider failure show a specific reason in the UI and survive reload/history inspection.
- An all-failed run is failed; a mixed run visibly reports its failures while retaining successful assessments; skipped/no-candidate runs and canceled runs have accurate outcomes.
- Progress counters never equate failed attempts with successful checks. Terminal SSE events, API snapshots, history rows, and per-note state agree on outcome and counts.
- Tests cover reconnect/refetch after missed terminal events, retry-phase updates, failure-persistence errors, and cleanup. Use mocked LLM responses rather than requiring a live model server for automated tests.

**Verification:** `yarn test`; `yarn build:worker`; `yarn build:api`; `yarn build:ui`. Manually inspect a slow run, all-failed run, and mixed run, including history details after reload. Update `docs/DATA_FLOWS.md` / `docs/API_REFERENCE.md` if event or API contracts change.
