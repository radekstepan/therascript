# Fact-Checking & Verification UI / Worker Follow-Up Tasks

Implementation task for the Hallucination Audit (`/verification`) UI and the Verification Judge worker (`packages/worker/src/jobs/verificationProcessor.ts`), following the completed "Clear Response Fact Check" task. Mark the checkbox (`- [x]`) only after implementing the requirements and completing the verification below.

For background on the Verification Agent and LLM lifecycle, see `AGENTS.md` (§1 "Verification Agent", §3 "Session Chat Agent"), `docs/DATA_FLOWS.md`, and `docs/SCHEMA_REFERENCE.md`.

## Working Agreement

- **Subagents:** implement each task in a dedicated subagent (sequential, in task order — later tasks build on earlier ones), with a final synthesis pass over all task results. (Superseded for this batch: user chose inline sequential execution.)
- **Changeset per task:** after finishing a task and before moving to the next, add a `.changeset/<kebab-case-name>.md` entry (patch bump on every touched `@therascript/*` package, following the style of existing entries) and commit the task's code + tests + changeset + checkbox tick as one commit.
- **Writeup per task:** after finishing a task, append a short writeup under that task's section in this doc — **what** changed (files/behavior) and **why** (the reason, not just the mechanism).
- **Docs after all tasks:** once every task is done, update the affected learnings/architecture docs (`AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/COMPONENT_MAP.md`, `docs/NAVIGATION.md`, `docs/API_REFERENCE.md`, `docs/DATA_FLOWS.md`, `docs/SCHEMA_REFERENCE.md`) so they describe the new behavior — never leave the docs stale relative to the finished work.

---

## Task - Dismiss an individual Fact Check statement as confirmed

- [ ] Done

**Follow-up to Task 8 — "Clear Response Fact Check".** After reading the Judge's reasoning and transcript evidence, the user must be able to dismiss a particular flagged statement because they have confirmed it is not an issue. This is a persistent human review decision for that statement; the existing whole-response clear action remains separate.

### Product decisions and boundaries

- Eligible findings: `partially_supported`, `contradicted`, `fabricated`, and `omission`. Supported claims need no dismissal action. For an omission, confirmation means the omission is acceptable, not that the absent information appeared in the answer.
- Dismiss only the selected finding. Keep its parent assessment `completed` and its original Judge verdict, severity, confidence, reasoning, and evidence intact. Store human confirmation separately. A response with every issue dismissed remains verified and is skipped by normal unverified-only audits.
- Keep confirmed records available in the response modal, labeled **Confirmed by you** with their review date and original Judge details. Exclude them from active issues and highlights. An undo/reopen action and a separate dismissed-findings dashboard are outside this task.
- **Clear Response Fact Check** still clears the current assessment and returns the response to the unverified pool, but preserves confirmations for matching findings. Update its tooltip accordingly. **Reset All Verifications** is the explicit clean-slate operation and deletes confirmations too; update its explanatory UI text.
- “Not rechecked” means no normal requeue of the completed response, and no reinstatement of a matching confirmed finding on a forced/cleared-response rerun. The current Judge makes one whole-response call, so it may see confirmed text while checking other claims. Do not promise zero tokens for that text or add per-claim LLM calls. Reconcile durable confirmations before saving and publishing the new result.

### Implementation map — inspect these before editing

| Area | Current code and required change |
| --- | --- |
| Migration | `packages/db/src/sqliteService.ts`: V20 created verification tables; V21 is currently latest. Add the next migration after checking the version at implementation time; never rewrite a shipped migration. |
| Domain | `packages/domain/src/index.ts`, `packages/domain/src/schemas/db/verification.ts`, and exports: add review types/metadata and API contracts; keep the Judge verdict enum unchanged. |
| Repository | `packages/data/src/repositories/verificationRepository.ts`: `saveMessageVerificationResult` upserts the parent, deletes old statement rows, inserts replacements, and increments job counters in one transaction. Independent review storage and review-aware saves/readers are essential. |
| Worker | `packages/worker/src/jobs/verificationProcessor.ts`: scoring, result save, fast/failure paths, and `message_verified`/progress events. Publish authoritative persisted effective values, not stale local counts calculated before applying reviews. |
| API | `packages/api/src/routes/verificationRoutes.ts`, `packages/api/src/api/verificationHandler.ts`: new mutation and response schemas; also update session chat routes that serialize statements. |
| UI | `packages/ui/src/api/verification.ts`, `components/Verification/StatementVerdictModal.tsx`, `components/SessionView/Chat/ChatMessages.tsx`, and `ChatMessageBubble.tsx`. The modal currently has a response-clear mutation; the bubble currently highlights all claims, including supported claims. |
| Analytics | Repository chat/global/model/time/session queries, `IssuesFeedTab.tsx`, and UI chat summary helpers. Some issue counts query raw verdicts directly; updating parent scores alone leaves stale totals. |
| Backup/reset | `packages/api/src/api/adminHandler.ts` exports/imports JSON and remaps IDs. Extend this, repository backup readers, and reset/wipe/delete paths. |

Paths in the UI row are relative to `packages/ui/src/` after the first entry. Use the repository's current versions if functions move before implementation.

### Storage and identity contract

Create an independent table, e.g. `verification_statement_reviews`, owned by the **message**, with an FK/cascade on message deletion. Do not make it dependent on a disposable statement/assessment FK: reviews must survive `deleteMessageVerification` and the worker's delete/reinsert cycle. Explicitly delete reviews in content deletion paths that do not rely on enabled FK cascades.

Store at least: review ID, message/session scope, identity-format version, material/context revision, deterministic finding key, `confirmed_at` in milliseconds, and a snapshot of the reviewed quote, normalized claim, resolved span, raw verdict, severity, reasoning, and evidence. The snapshot preserves what the user actually approved even if a subsequent Judge no longer returns that finding. Add a uniqueness constraint on `(message_id, context_revision, finding_key)` for unambiguous reusable findings. Ambiguous findings need a current-row association that does not accidentally confirm multiple distinct rows.

Store an assessment revision/fingerprint of the material actually evaluated: visible answer (same thinking-removal convention as worker/UI), therapist question, and full relevant transcript content in deterministic order, including meaningful speaker information. Do not use audit date, Judge model, run ID, statement ordering, or the selected/truncated transcript window as this revision. Changing Judge/context size alone must not erase a human decision. Fingerprints must survive backup ID remapping; avoid DB paragraph IDs as content identity.

Define shared, deterministic identity/scoring helpers in an existing lower-level package. Do not import the worker into API/data, add embeddings, or ask an LLM to match findings. Test these rules:

1. Require the same owning message, finding kind, and material revision. A changed answer, therapist question, or transcript invalidates automatic reuse; retain old reviews as history. A confirmation never applies to another response/session.
2. For a resolved claim, match canonical normalized claim **plus** its quote occurrence in the visible answer, including offsets to distinguish repeated text. Resolve quote typography with the existing span-resolution conventions. Canonicalize whitespace/typographic equivalents consistently, preserving numbers, negation, names, and meaningful punctuation. Judge ordering/severity/confidence/reasoning changes do not change identity.
3. A span alone is insufficient: two atomic claims may share one sentence/span. Different normalized claims must remain separate. Never use substring, same-paragraph, or same-index matching.
4. For an unresolved claim span, require exact canonical quote plus exact canonical normalized claim in the same material revision. If duplicates make this ambiguous, confirm only the currently selected row and do not automatically reuse that ambiguous association across runs.
5. Omissions have no answer span. Match exact canonical normalized omission text plus canonical evidence content/location in transcript content. Sort evidence deterministically, and do not depend on remapped paragraph IDs.
6. Arbitrary semantic paraphrases, splits, and merged claims are not guaranteed matches. Typography/whitespace variants are supported; materially different normalized claim text remains reviewable. Prefer a newly expressed finding requiring review to suppressing a distinct problem. This replaces the earlier loose “reworded matching claims” acceptance criterion.

Expose `review_status: 'unreviewed' | 'confirmed'`, `confirmed_at: number | null`, and `review_id: number | null` on all statement reads. Legacy/unmatched rows are unreviewed. Also expose an opaque `review_token` covering the immutable statement snapshot and material revision. Exclude mutable review status from the token so a repeated submission remains idempotent. Wire metadata through repository mappers, domain/zod definitions, route response serializers, UI types, and mocks; do not let a schema silently strip it.

Inspect existing message/transcript edit and verification invalidation flows. Persist revisions when the worker evaluates material, compare them again at save/dismiss time, and prevent stale modal submissions after material edits. For legacy assessments lacking a revision, establish a documented migration baseline from current material, and invalidate/re-audit assessments known to predate content edits. Hashing today's content twice does not prove an old assessment used that content; do not invent historical provenance.

### Effective scoring and query semantics

Preserve raw Judge fields. Use one review-aware reduction of current statements for both dismissal and worker saves. Share/extract `computeVerificationAccuracy` as needed without breaking existing worker imports/tests.

| Finding | Effective contribution after confirmation |
| --- | --- |
| Partial/contradicted/fabricated claim | One supported claim; zero contribution to its old problematic bucket; total claim count unchanged. |
| Omission | Zero active omissions; no new supported claim; remove its denominator penalty. |
| Unreviewed finding | Existing verdict/weighting. |

For effective counts `S`, `P`, `C`, `F`, and active omissions `O`, require `T = S + P + C + F` and `accuracy_score = (S + 0.5 * P) / (T + O)`, with `1.0` for zero denominator. Persist scores in **0–1** units; display percentages in **0–100** units. Do not round before aggregating.

**Required fixture:** one supported + one partial + one fabricated + one omission gives `T=3, O=1`, score `1.5/4 = 37.5%`. Confirm fabricated → `S=2, P=1, F=0`, score `2.5/4 = 62.5%`. Then confirm omission → `O=0`, score `2.5/3 ≈ 83.33%`. Then confirm partial → `S=3, P=0`, score `100%`. Repeat submissions change nothing.

Audit all raw-verdict predicates and UI reductions:

- Active Issues Feed rows **and its COUNT/pagination query** exclude confirmed findings, including filtered requests. Session/chat flagged counts and severity totals use the same unresolved predicate. Do not hide rows only after fetching a page.
- Parent aggregates, chat/global pooled accuracy, model claim mix/rates, daily timelines, and session mean accuracy consume effective data. Preserve the existing distinctions between pooled counts and mean per-message scores.
- Dismissal does not change completed/verified coverage, audited-message counts, author/Judge attribution, usage/duration, or `verified_at`. The UI chat summary currently returns `null` when there are no claims/omissions; preserve that convention even though stored zero-denominator score is `1.0`.
- Job history counters describe execution results **at time of audit**; do not retroactively decrement old run counters after human review. Label them accordingly where necessary. New audit counters use effective results at save time. Dismissal never increments `processed_messages`, success/failure counts, or execution totals.

### Endpoint and transaction contract

Add `POST /api/verification/statements/:statementId/dismiss` with JSON body `{ "expectedReviewToken": "<token from the statement read>" }`. Validate a positive **integer** ID and nonempty token. Do not accept client-supplied verdicts, scores, parent message IDs, or review timestamps. Use existing application error serialization.

| Result | Contract |
| --- | --- |
| 200 | `{ statement, verification }`: original Judge finding plus confirmed metadata, and the full authoritative parent assessment with all statements and effective aggregates. Define concrete exported types and route schemas, not `any`. |
| Repeated request | 200 for the same live statement/token, returning the existing review and original `confirmed_at`; no count changes or duplicate review. |
| 404 | Statement/parent no longer exists, including an old ID replaced by rerun/clear. Never silently apply the request to a replacement row. |
| 409 | Stale token/material revision, non-completed parent, or initially unreviewed supported statement. Explain conflict and refresh the current assessment. |
| Validation error | Use the application's normal route-validation status. Test fractional/zero/negative IDs, `12abc`, and missing/blank tokens. |

Within one short SQLite write transaction: validate current finding/parent/revision → insert/reuse review snapshot → associate the selected finding → reduce all current statements → update parent effective counts/score → return authoritative data. Failure rolls back the review and aggregates together. Do not reuse `saveMessageVerificationResult` unchanged for dismissal: it destroys statement IDs and increments job counters.

Modify the worker save transaction to read the latest durable reviews **inside the transaction**, after generation and before calculating effective aggregates/job deltas. Do not rely solely on reviews fetched before the LLM call. Revalidate material revision before committing; discard/reject stale results rather than attributing them to changed content. Keep LLM/network calls outside SQLite transactions. Failed/skipped/empty-result saves must preserve independent review records. Emit persisted effective accuracy/counts from the returned save result.

Race requirements: dismissal first → worker's later matching save honors it; worker replaces rows first → stale dismissal gets 404 and refreshes; two different dismissals serialize and both count; duplicate dismissals create one review. Use the same safe SQLite transaction conventions in API and worker; cover real separate connections, not just mocked calls.

### UI and cache behavior

- Place **Dismiss Statement (Confirmed)** with selected-statement actions, separate from **Clear Response Fact Check**. `AppTooltip`: “Confirm that this finding is not an issue. Removes its highlight, updates accuracy and issue counts, and keeps this confirmation for future Fact Checks of unchanged content. Other statements are unchanged.”
- Show dismissal only for unresolved eligible findings. Capture ID/token at click time. Show “Dismissing…” and disable dismissal, response clear, and statement navigation while pending. Leave reasoning/evidence visible. On failure restore controls and show an accessible inline error; do not close or advance the modal.
- After success stay on the reviewed statement, show **Confirmed by you** and the original Judge details, and preserve navigation through all response statements. Track selection by ID when refetches arrive; a shifting index must not target another finding. No second confirmation dialog.
- Update the matching `chatVerifications` cache immediately from the returned assessment, and invalidate `chatVerifications`, `verificationStats`, and `verificationStatements` query prefixes across filter variants. Inspect other dependent caches. Cancel/guard older in-flight reads so stale responses cannot restore highlights. Do not depend on job SSE: dismissal can happen with no active job.
- Explicitly exclude confirmed findings from `ChatMessageBubble`'s `highlightable` input, used by markdown and plain-text rendering (`highlightVerifiedStatements.ts`). Changing the effective verdict to supported alone is insufficient because supported claims are also marked. Remove the selected finding's mark/underline/click target; retain any overlapping mark belonging to a different unresolved finding.
- When the last issue on a feed page disappears, clamp/refetch pagination so no empty out-of-range page or stale total remains. Preserve existing unreviewed/supported highlight styling.

### Migration, backup, lifecycle, and documentation

- Cover fresh DB and upgrade migration paths; existing results start unreviewed. Do not infer human confirmations from old supported verdicts.
- Export reviews even if their assessment was cleared. Legacy backups lacking review data import as an empty set. New backup imports remap message/session/review associations and any identity data dependent on remapped IDs; preserve review snapshots without requiring an extant old statement row. Validate/recompute restored effective aggregates. Prefer content fingerprints that survive remapping naturally.
- Preserve reviews on ordinary reruns and `deleteMessageVerification`. Delete them on owning message/chat/session deletion and full reset/wipe. Cover enabled cascades and explicit-delete paths. Preserve existing reset return contracts or update all consumers consistently.
- Update `AGENTS.md`, affected architecture/component/navigation references, `docs/API_REFERENCE.md`, `docs/DATA_FLOWS.md`, and `docs/SCHEMA_REFERENCE.md` for human-review precedence, endpoint, scoring, and clear/reset semantics. Add the changeset and writeup required by the working agreement.

### Implementation order and acceptance tests

Implement shared contracts/identity/scoring → migration/repository → review-aware worker saves/analytics → API/backup → UI/cache/highlights → checks/docs. Retain the behavior established by completed Tasks 1–8.

1. **Identity tests:** changed order/model/context size; typography/whitespace variants; repeated quote occurrences; same span with distinct atomic claims; ambiguous/unresolved spans; reordered omission evidence; different response/session; changed answer/question/transcript; conservative paraphrase/split/merge behavior.
2. **Repository tests:** scoring fixture above; every eligible verdict; omission-only/zero-denominator and last remaining issue; raw Judge data and audit timestamps preserved; idempotency; unaffected neighbors; feed count/filter/pagination; effective pooled/model/time/chat/session totals; old job counters unchanged; rollback after injected aggregate-write failure.
3. **API tests:** success schema including review metadata; strict input validation; missing parent/statement; stale token/revision; unsupported/non-completed conflict; repeat request; old statement ID after rerun returns 404. Add route tests where handler mocks cannot prove serialization/validation.
4. **Worker/integration tests:** normal audit skips completed response; forced rerun with new IDs/order honors matching reviews; new claims remain unresolved; response clear then recheck preserves confirmations; failed retry preserves reviews; published effective score equals stored score. Use separate SQLite connections to exercise dismiss/save ordering and concurrent different dismissals.
5. **UI tests:** reasoning/evidence before action; selected ID/token posted; pending/error/stale behavior; confirmed badge/navigation; both rendering modes lose only the selected mark; overlapping unresolved mark stays; immediate cache update and refetched percentages/counts; empty-page recovery; no extra confirmation dialog.
6. **Lifecycle tests:** migration baseline; review survives clear without current statement row; backup round-trip with remapped IDs; legacy backup import; content deletion and full reset remove reviews.

**Verification commands (repository root):** use Node **23.10.0** exactly (`nvm use`, then verify `node --version`). If installation is needed, run the normal install including the native-binding postinstall check.

```sh
yarn vitest run packages/db/src/migrations.test.ts packages/domain packages/data/src/repositories/verificationRepository.test.ts
yarn vitest run packages/api/src/api/verificationHandler.test.ts packages/api/src/api/adminHandler.test.ts packages/worker/src/jobs/verificationProcessor.test.ts
yarn vitest run packages/ui/src/api/verification.test.ts packages/ui/src/components/Verification/StatementVerdictModal.test.tsx packages/ui/src/components/Verification/IssuesFeedTab.test.tsx packages/ui/src/components/SessionView/Chat packages/ui/src/utils/highlightVerifiedStatements.test.ts packages/ui/src/hooks/useVerificationStream.test.tsx
yarn turbo run build --filter=@therascript/domain --filter=@therascript/db --filter=@therascript/data --filter=@therascript/api --filter=@therascript/worker --filter=@therascript/ui
```

Also run any new helper/route/integration suites outside these paths. Manually exercise session chat and `/verification`: inspect → dismiss → observe removed highlight/updated percentages and unaffected neighbors → reload → force rerun → clear response and recheck. Matching findings stay confirmed; new findings still appear; full reset removes confirmations. Record actual results and unavailable manual checks in the writeup. Do not claim browser verification from jsdom alone or mark the task done with required checks outstanding.
