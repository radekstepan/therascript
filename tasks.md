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

- [x] Fact Check when I want to highlight a sentence in a note it should not keep flashing. Just a single flash and not border, just background.

  Writeup: `packages/ui/src/styles/global.css` — `.verified-statement-mark-active` now runs `verified-mark-flash 0.9s ease-out 1` (was `2`) with `box-shadow: none` (was a persistent 2px verdict ring). Keyframes animate `background-color` from the verdict tint (`--verified-flash` red/amber/green `a5`) with only the `0%` frame, so the mark flashes once and settles back into its resting fill. Reason: the repeating ring flash was distracting and the persistent border fought the resting underline styles; a single background pulse orients the reader without lingering chrome.

- [x] Accuracy by Authoring LLM - Claim mix little bar chart needs onhover tooltip. Make sure it won't be cutoff by the UI.

  Writeup: `packages/ui/src/components/Verification/ModelAccuracyCard.tsx` — `ProportionBar` is wrapped in `AppTooltip` (Radix, portaled) with a per-model readout (name, supported/partial/contradicted-fabricated counts, total claims across audited responses); the bar keeps its `role="img"` label and gains `tabIndex={0}` for keyboard. Reason: a bare bar forces users to guess the mix, and a non-portaled tooltip would be clipped by the table's `overflow-x` scroller — the portal escapes it. Regression coverage in `ModelAccuracyCard.test.tsx` (hover shows own model's breakdown, different model differs, keyboard focus opens it).

- [x] Fact Check page, Job History Action has "View details" that's cuttoff. Just say "View" so it's a single line.

  Writeup: `packages/ui/src/components/Verification/JobHistoryTab.tsx` — the failure-details `Action` button now reads `View` (with a `View failure details` tooltip) instead of `View details`. Reason: the `size="1"` button in the narrow right-aligned column wrapped/truncated; the shorter label fits on one line. The header `LastRunResultCard` banner keeps its roomier `View details` label. Updated `JobHistoryTab.details.test.tsx` and `verification-job-history.spec.ts` (exact match, since the banner's `View details` also contains `View`).

- [ ] Fact Check page, Transcripts coverage, add a column that says what was the (predominant) chat LLM across all chats for that transcript.
