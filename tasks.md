# Fact-Checking & Verification UI / Worker Follow-Up Tasks

Sequential, self-contained engineering tasks for the Hallucination Audit (`/verification`) UI and the Verification Judge worker (`packages/worker/src/jobs/verificationProcessor.ts`). Work through these tasks in order (`Task 1` → `Task 5`), marking each checkbox (`- [x]`) and running its **Verification** commands before moving to the next.

For background on the Verification Agent and LLM lifecycle, see `AGENTS.md` (§1 "Verification Agent", §3 "Session Chat Agent"), `docs/DATA_FLOWS.md`, and `docs/SCHEMA_REFERENCE.md`.

## Working Agreement

- **Subagents:** implement each task in a dedicated subagent (sequential, in task order — later tasks build on earlier ones), with a final synthesis pass over all task results.
- **Changeset per task:** after finishing a task and before moving to the next, add a `.changeset/<kebab-case-name>.md` entry (patch bump on every touched `@therascript/*` package, following the style of existing entries) and commit the task's code + tests + changeset + checkbox tick as one commit.
- **Writeup per task:** after finishing a task, append a short writeup under that task's section in this doc — **what** changed (files/behavior) and **why** (the reason, not just the mechanism).
- **Docs after all tasks:** once every task is done, update the affected learnings/architecture docs (`AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/COMPONENT_MAP.md`, `docs/NAVIGATION.md`, `docs/API_REFERENCE.md`, `docs/DATA_FLOWS.md`, `docs/SCHEMA_REFERENCE.md`) so they describe the new behavior — never leave the docs stale relative to the finished work.

---

...
