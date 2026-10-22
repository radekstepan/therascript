# Fact-Checking & Verification UI / Worker Follow-Up Tasks

Sequential, self-contained engineering tasks for the Hallucination Audit (`/verification`) UI and the Verification Judge worker (`packages/worker/src/jobs/verificationProcessor.ts`). Work through these tasks in order (`Task 1` → `Task 8`), marking each checkbox (`- [x]`) and running its **Verification** commands before moving to the next.

For background on the Verification Agent and LLM lifecycle, see `AGENTS.md` (§1 "Verification Agent", §3 "Session Chat Agent"), `docs/DATA_FLOWS.md`, and `docs/SCHEMA_REFERENCE.md`.

## Working Agreement

- **Subagents:** implement each task in a dedicated subagent (sequential, in task order — later tasks build on earlier ones), with a final synthesis pass over all task results. (Superseded for this batch: user chose inline sequential execution.)
- **Changeset per task:** after finishing a task and before moving to the next, add a `.changeset/<kebab-case-name>.md` entry (patch bump on every touched `@therascript/*` package, following the style of existing entries) and commit the task's code + tests + changeset + checkbox tick as one commit.
- **Writeup per task:** after finishing a task, append a short writeup under that task's section in this doc — **what** changed (files/behavior) and **why** (the reason, not just the mechanism).
- **Docs after all tasks:** once every task is done, update the affected learnings/architecture docs (`AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/COMPONENT_MAP.md`, `docs/NAVIGATION.md`, `docs/API_REFERENCE.md`, `docs/DATA_FLOWS.md`, `docs/SCHEMA_REFERENCE.md`) so they describe the new behavior — never leave the docs stale relative to the finished work.

---

## Task 1: Slow `yarn build` — diagnose and fix

- [x] Done

> "yarn build" taking a really long time, what's up?
> Tasks:    14 successful, 14 total
> Cached:    12 cached, 14 total
> Time:    1m20.008s

**Verification:** `yarn turbo run build --filter=@therascript/ui --force` (cold ~64s, was ~91s; warm webpack cache ~5s); `npx tsc --noEmit -p packages/ui/tsconfig.json` passes.

**Writeup:** The 80s was the `@therascript/ui` webpack production build (~91s measured uncached) — every other package is a fast `tsc` build and turbo-caches cleanly (fully-cached `yarn build` takes ~1s). Three fixes in the UI build: (1) `packages/ui/webpack.config.js` now selects `devtool` by mode — external `source-map` for production instead of the hardcoded `inline-source-map` (the config comment always said to do this; the inline map bloated the bundle to ~14 MB and slowed minification; bundle is now ~3.3 MB + separate `.map`), and enables the webpack filesystem cache so repeat builds after small changes reuse unchanged modules (~5s); (2) `packages/ui/tsconfig.json` disables `composite`/`declaration`/`declarationMap` since no workspace package consumes `@therascript/ui` types — ts-loader no longer emits useless `.d.ts` files into `dist`. Full type-checking still runs in-band via ts-loader, so the build gate is unchanged. Changeset: `.changeset/ui-production-build-speed.md`.

---

## Task 2: Accuracy / Hallucinations chart tooltips don't anchor to the data point

- [x] Done

> In Accuracy and Hallucinations over time the tooltips don't show where the bar/data point is

**Verification:** `yarn vitest run packages/ui/src/components/Verification/AccuracyTimelineCard.test.tsx` (10/10 pass, incl. new trigger-anchor test); `npx tsc --noEmit -p packages/ui/tsconfig.json` passes. E2E spec (`verification-chart-tooltips.spec.ts`) untouched — Playwright browsers not installed, so not run; hover/focus behavior it asserts is preserved.

**Writeup:** The tooltip trigger was the point's `<g>` containing the invisible full-plot-height hover rect, so Radix anchored the readout to that tall box's center (chart middle) rather than the dot/bars. `packages/ui/src/components/Verification/AccuracyTimelineCard.tsx` now drives a controlled open state from the group (hover + keyboard focus preserved, including bar-hover readout) while the `AppTooltip` trigger is just the dot circle, so the readout + arrow appear at the data point; `delayDuration={0}` keeps the readout tracking across adjacent cells. `packages/ui/src/components/Shared/AppTooltip.tsx` gains optional `open`/`defaultOpen`/`onOpenChange` passthrough (additive, no other callers affected). Tests: new jsdom assertion that the Radix trigger marker (`data-state`) sits on the circle and not the group, plus `act()`-wrapped focus to silence the controlled-state update warning. Changeset: `.changeset/chart-tooltip-dot-anchor.md`.

---

## Task 3: Issues Feed "refreshing..." flickers while Fact Check runs

- [x] Done

> In the Issues Feed while Fact Check is running I see "refreshing..." flickering constantly

**Verification:** `yarn vitest run packages/ui/src/hooks/useVerificationStream.test.tsx packages/ui/src/components/Verification/IssuesFeedTab.test.tsx` (17/17 pass, incl. 2 new tests, both observed failing pre-fix); `npx tsc --noEmit -p packages/ui/tsconfig.json` passes.

**Writeup:** Two-part root-cause fix. (1) `packages/ui/src/hooks/useVerificationStream.ts` invalidated all four dashboard queries on every `progress`/`phase` SSE event, and the worker emits token-speed `phase` ticks ~3/sec during generation — a refetch storm that toggled `isFetching` constantly (new test proved 8 invalidation calls from 2 ticks pre-fix). It now invalidates only on `message_verified`, the sole event that persists new data; banner/phase stay live via local merged state and the existing jobs/stats polls backstop missed events. This also stops the strobe on the Updating spinner, pagination disabled states, and chat verification refetches. (2) `packages/ui/src/components/Verification/IssuesFeedTab.tsx` keeps the `· refreshing…` suffix always mounted and opacity-toggles it (aria-hidden while idle) instead of conditionally rendering, so even legitimate refetches cause zero layout shift. Tests: stream test asserts phase/progress ticks never invalidate while `message_verified` invalidates all four keys; feed test drives a deferred background refetch and asserts the same node fades 0→1→0. Changeset: `.changeset/issues-feed-refreshing-strobe.md`.

---

## Task 4: Claim mix bar not vertically aligned in the table row

- [x] Done

> Fact Check - Claim mix little bar is not vertically aligned in the table row

**Verification:** `yarn vitest run packages/ui/src/components/Verification/ModelAccuracyCard.test.tsx` (5/5 pass); `npx tsc --noEmit -p packages/ui/tsconfig.json` passes. No new maintained test — one-line style tweak (jsdom cannot assert layout); visual confirmation needs a browser run of `/verification`.

**Writeup:** Radix table cells use `vertical-align: inherit` (baseline), so the 10px `ProportionBar` block — which has no text baseline — sat its bottom edge on the row's text baseline instead of centering. `packages/ui/src/components/Verification/ModelAccuracyCard.tsx` now sets `vertical-align: middle` on the Claim mix cell only. Changeset: `.changeset/claim-mix-bar-alignment.md`.

---

## Task 5: Judge `malformed_json` failure exhausts retries (Audit #5, message 1819)

- [x] Done

> On Fact Check Audit #5 most of the prompts worked, but this one didn't:
> Completed with errors: 18 of 19 checked, 1 failed (job 5, judge "qwen3.8-27b"). First failure [malformed_json]: [malformed_json] Judge returned invalid JSON for message 1819 (job 5, judge "qwen3.8-27b", retrying, attempt 2 of 2, 570.0s, 42747+57605 tokens): Judge LLM did not return valid JSON (unparseable output). Retries exhausted (1 retry).

**Verification:** `yarn vitest run packages/worker/src/jobs/verificationProcessor.test.ts` (126/126, incl. 6 new tests); `yarn vitest run packages/domain packages/data/src/repositories/verificationRepository.test.ts packages/ui/src/api/verification.test.ts` (117/117); `yarn turbo run build --filter=@therascript/domain --filter=@therascript/data --filter=@therascript/worker --force` clean (tsc).

**Writeup:** 57k completion tokens over 570s means the Judge rambled to its (full-remaining-window) completion cap and truncated mid-JSON; the retry then repeated the identical giant call and failed the same way. `packages/worker/src/jobs/verificationProcessor.ts` now detects runaways from server-reported usage (`detectJudgeRunaway`: filled the cap, or ≥16k unparseable tokens under a larger cap) and retries with a compact-verdict reminder (`JUDGE_RETRY_COMPACT_REMINDER`) under a fail-fast cap (`resolveJudgeRetryCompletionBudget` = min(original, 8k)) — a concise valid verdict fits, a second ramble fails in ~1–2 min instead of ~10. First attempts keep the full window with unchanged thinking/temperature, so previously-successful audits are unaffected; small-context judges keep their already-small retry cap. Cap-truncated failures persist as a new `truncated_output` code with cap numbers in the detail (instead of cryptic `malformed_json`), rippling through the `VerificationFailureCode` union (`packages/domain/src/index.ts`), zod enum (`packages/domain/src/schemas/db/verification.ts`), worker label/reader, data repository input type, and UI label (`Judge output truncated`); the `error_code` TEXT column needs no migration. Deliberately no partial-claim salvage: accepting a truncated prefix as complete would inflate accuracy, so the message still fails loudly and can be re-run. Changeset: `.changeset/judge-runaway-compact-retry.md`.

---

## Task 6: Jump from a transcript chat reference to that part of the transcript

- [x] Done

> When looking at transcript chat with a transcript reference, make it easy to jump to that part of the transcript to check yourself.

**Verification:** `yarn vitest run packages/ui/src/components/Verification/StatementVerdictModal.test.tsx packages/ui/src/components/SessionView/SessionContent.test.tsx` (12/12, incl. 4 new); neighboring `ChatMessages`/`ChatMessageBubble`/`Transcription` suites (30/30); `npx tsc --noEmit -p packages/ui/tsconfig.json` passes. Scroll landing itself needs a browser (jsdom cannot scroll); href/tab wiring is pinned by tests.

**Writeup:** The `¶N` reference on each Fact Check evidence card (`packages/ui/src/components/Verification/StatementVerdictModal.tsx`) was plain text; it is now a same-page `#paragraph-N` link (accent + hover underline, matching the session-link pattern) reusing the transcript's existing hash-scroll + 2s highlight. Same-page (not `/sessions/:id`) deliberately: the desktop transcript panel sits side-by-side with chat, so leaving the route would discard chat context. Two supporting fixes: the desktop `Transcription` panel never received `isTabActive`, which silently disabled the hash-scroll effect on desktop — `packages/ui/src/components/SessionView/SessionContent.tsx` now passes it — and paragraph hashes auto-switch small (tabbed) screens to the Transcript tab via the tested `shouldActivateTranscriptTab` helper. Evidence `paragraphIndex` is the DB paragraph id (worker hydrates it from `paragraphsById`), matching the `paragraph-<id>` DOM anchors. Tests: modal link href/label + no-link-without-index cases (render helper gained a `MemoryRouter`), helper unit tests. Changeset: `.changeset/evidence-paragraph-jump-link.md`.

---

## Task 7: Fact-check highlight colors more transparent, full color only on hover

- [x] Done

> The colors of fact checks on a session note should be a bit more transparent and only the transparency should switch to the current color/transparency on hover. Do not modify underline, border or anything like that.

**Verification:** `yarn vitest run packages/ui/src/utils/highlightVerifiedStatements.test.ts packages/ui/src/components/SessionView/Chat/ChatMessageBubble.test.tsx` (51/51, incl. 3 new); `npx tsc --noEmit -p packages/ui/tsconfig.json` passes. Hover rendering itself needs a browser; resting values, untouched borders, and the verdict hook are pinned by tests.

**Writeup:** Resting fills in `getVerdictMarkStyle` (`packages/ui/src/utils/highlightVerifiedStatements.ts`) drop one Radix alpha step (`red/amber a3` → `a2`); `packages/ui/src/styles/global.css` hover rules switch only the fill back to `a3` per `data-verdict`, replacing the old brightness-filter + gray box-shadow hover. Underlines/borders/radius/padding are byte-identical (pinned by test); supported marks stay fill-less. Because resting fills are inline (a stylesheet rule cannot override them), the handoff uses a `--verified-mark-bg` variable with the `a2` value as fallback; plain-text marks in `ChatMessageBubble` gained the `data-verdict` attribute the markdown path already emitted. Changeset: `.changeset/fact-check-highlight-transparency.md`.

---

## Task 8: Clarify "Clear Verification" scope (statement vs whole note) with tooltip

- [ ] Done

> On the Fact Check modal there is a "Clear Verification" button. Is that for the statement itself or the whole note? Would it then be rechecked on the next Fact Check run? I agree it would be good to clear certain findings of a Fact Check, just make it clear with the actions what you do. Provide a tooltip over the action too.

**Verification:** TBD
