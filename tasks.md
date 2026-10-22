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

## 1. P1 — Greeting detection silently approves factual answers

- [x] Task 1

**Location:** `packages/worker/src/jobs/verificationProcessor.ts:1060–1086`, consumed at `1488–1519`.

The fast path accepts any short answer matching a greeting/prompt substring, without requiring the entire answer to be conversational. For example, `Hello! The patient reported suicidal thoughts.` meets the length, word-count, punctuation, and greeting checks. It is saved as completed with accuracy 1.0 and no claims without consulting the transcript. Default future audits then skip it.

**Fix plan:** Restrict this optimization to complete, explicitly recognized nonfactual utterances. Send any additional substantive clause through the judge.

**Validation:** Pure greetings still bypass inference; greetings followed by factual claims and factual answers ending with “let me know” invoke the judge and can receive negative verdicts.

## 2. P1 — Structurally invalid judge JSON becomes a perfect audit

- [x] Task 2

**Location:** `packages/worker/src/jobs/verificationProcessor.ts:829–884` and `1635–1751`.

Parsing only establishes JSON syntax. An object such as `{}` or `{"error":"unable to assess"}` is truthy and bypasses the repair retry. Normalization converts absent/non-array claims and omissions into empty lists, which receive accuracy 1.0. Invalid entries can likewise all be discarded and produce a clean completed verification.

**Fix plan:** Validate the response structure before normalization and scoring. Treat missing/wrong-type required arrays and unusable claim records as invalid judge output, run the bounded repair attempt, then persist a failed verification if validation still fails. Preserve explicitly valid zero-claim conversational results.

**Validation:** Empty/error objects, non-array claims, and malformed claim entries never become completed perfect audits; valid empty arrays remain supported where appropriate.

## 3. P1 — Evidence hydration trusts a valid paragraph number even when its quote is fabricated

- [x] Task 3

**Location:** `packages/worker/src/jobs/verificationProcessor.ts:769–797`.

When the judge supplies an existing `paragraphIndex`, hydration immediately accepts that paragraph and attaches its real timestamp/speaker to the supplied quote. Quote matching only happens if the index is absent or invalid. A fabricated quote paired with a valid index therefore appears to have a grounded citation.

**Fix plan:** Validate the normalized quote against the indexed paragraph first. If it does not match, search the other paragraphs; if no match exists, remove the grounded citation metadata and make the unverified evidence status clear. Do not attach a real speaker/time to text absent from the transcript.

**Validation:** Test a correct index with an invented quote, an incorrect-but-existing index whose quote belongs elsewhere, and a correctly matched citation.

## 4. P1 — Cancellation during model loading is overwritten

- [x] Task 4

**Location:** `packages/worker/src/jobs/verificationProcessor.ts:1244–1328`.

The worker checks cancellation before awaiting model loading. If the user cancels during that await, the API sets the database row to `canceled`, but the worker subsequently writes `processing` unconditionally. The next cancellation check reads this overwritten state, so the canceled audit continues. The API can also accept another audit after cancellation, leaving the original unexpectedly active again.

**Fix plan:** Re-read cancellation after model loading and use a conditional database transition that cannot move terminal jobs back to processing. Preserve cancellation on both successful and failed model-load paths.

**Validation:** Hold the model-load promise open, cancel the job, then resolve it. Assert no judge calls/results and a final canceled status. Repeat with a rejected load.

## 5. P1 — A job canceled before processing still unloads the default endpoint

- [x] Task 5

**Location:** `packages/worker/src/jobs/verificationProcessor.ts:1240–1255` and `1881–1889`.

The early return for a canceled job still executes `finally`. At that point `judgeBaseUrl` remains `config.llm.baseURL`, even for a job configured for a remote judge, and no model has been acquired. `unloadModelAtUrlForWorker` unloads every loaded LLM instance at that endpoint. This can interrupt an unrelated local chat when a queued job is canceled while waiting for the worker mutex.

**Fix plan:** Track whether the job actually acquired model resources, and clean up only those resources at the resolved endpoint. Early cancellation or missing-job exits must not unload models.

**Validation:** Process a pre-canceled remote job while a local chat model is loaded; assert no load/unload calls. Verify ordinary acquired-model cleanup still runs.

## 6. P2 — Terminal SSE events are dropped before delivery

- [x] Task 6

**Location:** `packages/api/src/api/verificationHandler.ts:367–421`.

`send(event)` schedules enqueueing with `setImmediate`. For terminal Redis events, the subscriber immediately sets `streamClosed = true` and closes the controller. The scheduled enqueue sees the flag and returns, so completion/failure/cancellation is never sent. Previously scheduled progress events can be discarded too. The browser must reconnect and obtain a terminal snapshot to discover completion, delaying callbacks and losing the original terminal error event.

**Fix plan:** Serialize enqueue and close so the terminal payload is flushed before stream closure. Make close/unsubscribe idempotent and retain disconnect handling.

**Validation:** Subscribe to a running job, emit each terminal event, and read the stream through EOF. Assert the terminal event arrives exactly once without a reconnect and preceding queued progress is retained.

## 7. P2 — Failed queue submission leaves an orphaned active job

- [x] Task 7

**Location:** `packages/api/src/api/verificationHandler.ts:219–236`.

The pending SQLite row is committed before `addVerificationJob` is awaited. If queue submission rejects, the endpoint returns an error but leaves the row pending. The active-job guard then rejects subsequent audits even though no worker can process that row; the user must discover and cancel it manually.

**Fix plan:** Reconcile submission failure by marking the job failed with the queue error. Use a deterministic queue identity/idempotent reconciliation if submission outcome is ambiguous, so retries cannot duplicate work or revive a failed row unexpectedly.

**Validation:** Reject queue submission, assert a terminal job with a useful error, and verify a subsequent start is accepted. Cover ambiguous/retried submission separately.

## 8. P2 — Context budgeting can exceed the configured context window

- [x] Task 8

**Location:** `packages/worker/src/jobs/verificationProcessor.ts:1359` and `1523–1537`.

Completion tokens have a minimum of 4096 and transcript tokens a minimum of 512, regardless of remaining capacity. A permitted 4096-token context therefore reserves more than its entire window before the system prompt, question, and answer are counted. Larger windows also overflow when the answer/question consumes the remaining prompt budget. The comment promising that context never overflows is not met by the arithmetic.

**Fix plan:** Allocate completion and transcript budgets from the actual remaining context, with explicit handling when the fixed prompt/answer cannot fit. Reject impossible settings or report a clear non-successful assessment rather than repeatedly sending oversized requests.

**Validation:** Cover 4096-token context, a large answer in a normal context, and a normal fitting request. Assert total estimated prompt plus completion stays within the available window.

## 9. P2 — Missing transcripts are recorded as successfully verified

- [x] Task 9

**Location:** `packages/worker/src/jobs/verificationProcessor.ts:1455–1483`.

A candidate from a completed session with no transcript paragraphs is saved as completed with accuracy 1.0, even when its answer contains substantive claims. Coverage treats it as verified and subsequent default audits skip it, including after transcript data is repaired.

**Fix plan:** Distinguish empty answer content from missing ground truth. Save missing-transcript results as failed or skipped with an explanatory reason, exclude them from successful coverage/accuracy, and allow retry once the transcript exists.

**Validation:** Audit a factual answer in a completed session without paragraphs; it must not receive a successful verification. Add paragraphs and verify it becomes eligible again.

## 10. P2 — Backup restore drops the new message author-model metadata

- [x] Task 10

**Location:** `packages/api/src/api/adminHandler.ts:302–311` and `540–556`; new field written by `packages/data/src/repositories/messageRepository.ts:5`.

This branch records `messages.model` for author-model attribution, but the import validator does not accept/preserve it and the insert does not write it. Restoring a backup loses model attribution for all messages. Existing verification rows retain their separate authored-model snapshot, but auditing previously unchecked messages or re-auditing restored messages uses null and reports Unknown Model instead.

**Fix plan:** Include nullable/optional `model` in backup message validation and insertion, while keeping older backups compatible.

**Validation:** Round-trip checked and unchecked messages with different model names, then force a re-audit and verify attribution is preserved. Import a pre-feature backup without the field successfully.

## 11. P2 — Restored active verification jobs have no corresponding queue work

- [x] Task 11

**Location:** `packages/api/src/api/adminHandler.ts:579–613`.

Verification backups include pending/processing jobs and restore their status verbatim. The import path does not enqueue or reconcile them. Restoring such a backup into a fresh installation leaves permanently active rows, and `hasActiveVerificationJobs()` blocks starting another audit or resetting verifications.

**Fix plan:** Restore nonterminal jobs as interrupted/failed with a clear restoration explanation, or implement deliberate queue reconciliation/resumption. Do not leave an active status without executable queue work.

**Validation:** Restore backups containing pending and processing verification jobs into an empty queue. Confirm the UI presents a recoverable terminal state or actual resumed work and that new audits are not permanently blocked.

## 12. P2 — The all_force API scope does not enforce re-auditing

**Location:** `packages/api/src/api/verificationHandler.ts:224` and `packages/data/src/repositories/verificationRepository.ts:459–464`.

A request with `scope: 'all_force'` and omitted `skipVerified` is persisted with `skip_verified = true`. Candidate selection applies that flag independently of scope, excluding completed verifications. Thus the force scope silently behaves like an unverified-only audit. The current modal masks this by explicitly sending false, but the API itself exposes the contradictory behavior.

**Fix plan:** Resolve scope semantics server-side: all_force must include completed verifications regardless of an omitted or conflicting skip flag. Define the corresponding invariant for all_unverified and keep selected-session/single-chat behavior explicit.

**Validation:** Submit all_force with omitted, true, and false skip flags and verify previously completed messages are selected in every case.

## Suggested implementation order

1. Prevent false successful audits and misleading evidence: findings 1–3 and 9.
2. Repair cancellation/resource ownership: findings 4–5.
3. Repair lifecycle delivery, submission recovery, and context allocation: findings 6–8.
4. Preserve backup integrity and enforce API scope semantics: findings 10–12.

Add the targeted regression cases above alongside each fix. Then run the relevant worker, API, and data tests under the repository-required Node 23.10.0, followed by a live smoke test covering start, progress, cancellation during load, completion, and backup restoration.
