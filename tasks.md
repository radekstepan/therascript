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

- [x] Consistent human-readable LLM display names in Fact Check + Settings Detailed Usage Logs (DB values unchanged, UI overrides only):
  - `qwen3.5-9b` (pass-through)
  - `Unknown Model` (canonical label; null/empty/`Unknown model` casing normalizes to this)
  - `gemma3:12b-it-qat` -> `gemma3-12b`
  - `qwen/qwen3.5-9b` -> `qwen3.5-9b`
  - `qwen3.8-27b` (pass-through)

  **Writeup — what/why:** Added a single shared UI override, `formatModelDisplayName` (`packages/ui/src/utils/modelDisplay.ts` + `modelDisplay.test.ts`), so every surface renders the same human name while the DB keeps the raw id. Explicit pins cover `gemma3:12b-it-qat` → `gemma3-12b` and `qwen/qwen3.5-9b` → `qwen3.5-9b`; a generic `vendor/model` slash-strip fallback covers future prefixed ids (e.g. `qwen/qwen3.8-27b`); missing/legacy-cased unknowns collapse to `Unknown Model`. Applied consistently across Fact Check (audit banner Judge, job history, failure details, issues-feed filter + `authored → Judge` line, accuracy-by-model table/tooltips/aria, trend filter + empty-state, coverage `Chat LLM`, verdict-modal footer) and Settings Detailed Usage Logs (model filter dropdowns + table column). Raw ids stay as React keys, filter values, `title` tooltips, and API params, so filtering and API behavior are unchanged. Reason: raw registry ids (`:`/`/` qualified) leaked into the UI inconsistently; a central display-only mapping fixes readability without a data migration. Verified with `yarn vitest run` on the new unit test plus the affected Verification component suites (55 tests passing). Changeset: `.changeset/human-model-display-names.md` (patch `@therascript/ui`, `@therascript/config` — includes the pre-existing uncommitted `qwen3.8-27b` pricing row needed for cost display).
