# Fact-Checking & Verification UI / Worker Follow-Up Tasks

Implementation task for the Hallucination Audit (`/verification`) UI and the Verification Judge worker (`packages/worker/src/jobs/verificationProcessor.ts`), following the completed "Clear Response Fact Check" task. Mark the checkbox (`- [x]`) only after implementing the requirements and completing the verification below.

For background on the Verification Agent and LLM lifecycle, see `AGENTS.md` (§1 "Verification Agent", §3 "Session Chat Agent"), `docs/DATA_FLOWS.md`, and `docs/SCHEMA_REFERENCE.md`.

## Working Agreement

- **Subagents:** implement each task in a dedicated subagent (sequential, in task order — later tasks build on earlier ones), with a final synthesis pass over all task results. (Superseded for this batch: user chose inline sequential execution.)
- **Changeset per task:** after finishing a task and before moving to the next, add a `.changeset/<kebab-case-name>.md` entry (patch bump on every touched `@therascript/*` package, following the style of existing entries) and commit the task's code + tests + changeset + checkbox tick as one commit.
- **Writeup per task:** after finishing a task, append a short writeup under that task's section in this doc — **what** changed (files/behavior) and **why** (the reason, not just the mechanism).
- **Docs after all tasks:** once every task is done, update the affected learnings/architecture docs (`AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/COMPONENT_MAP.md`, `docs/NAVIGATION.md`, `docs/API_REFERENCE.md`, `docs/DATA_FLOWS.md`, `docs/SCHEMA_REFERENCE.md`) so they describe the new behavior — never leave the docs stale relative to the finished work.

---

## Tasks

- [x] Fact Check modal - If you click Next or Prev, the statement in the note itself (on the chat thread) should flash/highlight with the appropriaet color (so we know where we at in the note. And also when I open the modal it starts bottom left and then it slides up. Can we "remember" the last position and show the modal there immediately?

### Writeup — Fact Check step flash + remembered panel position

**What changed (files/behavior):**
- `packages/ui/src/components/Verification/StatementVerdictModal.tsx` — new optional `onSelectionChange` callback reporting the shown statement on open and every Prev/Next/arrow-key step; drag offset persisted to `localStorage` (`therascript.fact-check-panel-pos`) on drop and restored on open (clamped to viewport); drag ref updated synchronously so the persisted drop point never lags a render; new `fact-check-panel` class for the animation override.
- `packages/ui/src/components/SessionView/Chat/ChatMessages.tsx` — tracks the panel's active statement id (cleared on close) and passes it to the owning bubble only.
- `packages/ui/src/components/SessionView/Chat/ChatMessageBubble.tsx` — new `activeStatementId` prop; the matching `<mark>` in both Markdown and plain-text paths gains `verified-statement-mark-active` + `data-active` and is scrolled into view (`block: nearest`, smooth unless reduced-motion).
- `packages/ui/src/styles/global.css` — entrance `dialogSlideIn` animation disabled for the panel (it reappears at its persisted position immediately); verdict-colored flash keyframes (red/amber/green) with a persistent tinted ring while selected.
- `packages/ui/src/utils/highlightVerifiedStatements.ts` — quote search retries with trailing sentence punctuation stripped, so Judge quotes like `daily.` resolve against note text reading `daily and has ...` (Markdown mode previously produced no mark at all for these, leaving the new flash with nothing to target). Verbatim matches still win.
- Tests: 5 new modal tests (selection sync, position memory), 3 new bubble tests (active mark per render mode), 2 new resolver tests; `tests/e2e/fact-check.spec.ts` asserts the note flash on Next/Prev and close→reopen position restore. Full UI suite: 35 files / 315 tests pass; tsc clean; fact-check e2e 3/3 pass.

**Why:** stepping through findings left the reader lost in long notes because nothing connected the panel's current step to the note text — the verdict-colored flash orients them instantly (red for fabricated/contradicted, amber for partial/omission, green for supported). The panel used to reset to the left dock with a slide-up entrance on every open, which felt jumpy when repeatedly opening it beside the transcript; remembering the drop point and appearing there immediately keeps the cross-checking layout stable. The resolver retry was load-bearing: without it the e2e seed's fabricated statement had no mark in Markdown mode, so the flash silently did nothing for exactly the most severe finding.
