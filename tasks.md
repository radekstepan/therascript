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

- [ ] Done

> In the Issues Feed while Fact Check is running I see "refreshing..." flickering constantly

**Verification:** TBD

---

## Task 4: Claim mix bar not vertically aligned in the table row

- [ ] Done

> Fact Check - Claim mix little bar is not vertically aligned in the table row

**Verification:** TBD

---

## Task 5: Judge `malformed_json` failure exhausts retries (Audit #5, message 1819)

- [ ] Done

> On Fact Check Audit #5 most of the prompts worked, but this one didn't:
> Completed with errors: 18 of 19 checked, 1 failed (job 5, judge "qwen3.8-27b"). First failure [malformed_json]: [malformed_json] Judge returned invalid JSON for message 1819 (job 5, judge "qwen3.8-27b", retrying, attempt 2 of 2, 570.0s, 42747+57605 tokens): Judge LLM did not return valid JSON (unparseable output). Retries exhausted (1 retry).

**Verification:** TBD

---

## Task 6: Jump from a transcript chat reference to that part of the transcript

- [ ] Done

> When looking at transcript chat with a transcript reference, make it easy to jump to that part of the transcript to check yourself.

**Verification:** TBD

---

## Task 7: Fact-check highlight colors more transparent, full color only on hover

- [ ] Done

> The colors of fact checks on a session note should be a bit more transparent and only the transparency should switch to the current color/transparency on hover. Do not modify underline, border or anything like that.

**Verification:** TBD

---

## Task 8: Clarify "Clear Verification" scope (statement vs whole note) with tooltip

- [ ] Done

> On the Fact Check modal there is a "Clear Verification" button. Is that for the statement itself or the whole note? Would it then be rechecked on the next Fact Check run? I agree it would be good to clear certain findings of a Fact Check, just make it clear with the actions what you do. Provide a tooltip over the action too.

**Verification:** TBD
