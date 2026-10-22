# Fact-Checking & Verification UI / Worker Follow-Up Tasks

Sequential, self-contained engineering tasks for the Hallucination Audit (`/verification`) UI and the Verification Judge worker (`packages/worker/src/jobs/verificationProcessor.ts`). Work through these tasks in order (`Task 1` → `Task 5`), marking each checkbox (`- [x]`) and running its **Verification** commands before moving to the next.

For background on the Verification Agent and LLM lifecycle, see `AGENTS.md` (§1 "Verification Agent", §3 "Session Chat Agent"), `docs/DATA_FLOWS.md`, and `docs/SCHEMA_REFERENCE.md`.

## Working Agreement

- **Subagents:** implement each task in a dedicated subagent (sequential, in task order — later tasks build on earlier ones), with a final synthesis pass over all task results.
- **Changeset per task:** after finishing a task and before moving to the next, add a `.changeset/<kebab-case-name>.md` entry (patch bump on every touched `@therascript/*` package, following the style of existing entries) and commit the task's code + tests + changeset + checkbox tick as one commit.
- **Writeup per task:** after finishing a task, append a short writeup under that task's section in this doc — **what** changed (files/behavior) and **why** (the reason, not just the mechanism).
- **Docs after all tasks:** once every task is done, update the affected learnings/architecture docs (`AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/COMPONENT_MAP.md`, `docs/NAVIGATION.md`, `docs/API_REFERENCE.md`, `docs/DATA_FLOWS.md`, `docs/SCHEMA_REFERENCE.md`) so they describe the new behavior — never leave the docs stale relative to the finished work.

---

When there are active jobs we show this "oval" with a number. Use the subtly rounded borders on a square/rectangle instead (like elsewhere in the app).

**Task 1 writeup — what/why:** The sidebar "Active Jobs" count badge in `packages/ui/src/components/Layout/PersistentSidebar.tsx` was the only count badge passing `radius="full"` to Radix `Badge`, rendering it as an oval/pill. Removed the prop so it inherits the theme default (`radius="medium"` in `App.tsx`), matching the subtly-rounded rectangle badges used everywhere else (Fact Check `CoverageTab`/`JobHistoryTab`, Analysis jobs). Added `PersistentSidebar.test.tsx` asserting the badge never renders `data-radius="full"`. Changeset: `.changeset/active-jobs-badge-radius.md` (patch on `@therascript/ui`).

When we done with a Fact Check, make sure we still keep the selected model loaded with its context so if we go to a chat or run a different Fact Check, we have settings preset. We can of course unload the model too while starting a Fact Check (just like we woulf from a dsession chat)

**Task 2 writeup — what/why:** The verification worker unloaded the Judge model in a `finally` block, so every Fact Check ended cold and chat/next-audit had to reload. Removed the `finally` unload in `packages/worker/src/jobs/verificationProcessor.ts` and, once the Judge model is confirmed loaded, adopted its snapshotted config (model, context, sampling params, base URL) into the global `app_settings` via the new pure `buildJudgeActiveSettingsUpdate` helper (best-effort, range-guarded like `setActiveModelAndContextAndParams`) — so Session/Standalone chat and the next Fact Check modal start with settings preset and `ensureModelLoaded` reuses the warm model instead of evicting it (including mid-audit). Start-of-job eviction is unchanged: `loadLlmModelForWorker` still unloads a previous/differing model at load time, like Session Chat. Updated the worker tests to the new retention contract (no unload on completed/failed/canceled paths; settings adopted once per acquired-model run; no sync for pre-canceled/missing/default-model jobs) and added unit tests for the builder; refreshed two stale comments in `packages/api/src/api/verificationHandler.ts` (comment-only, creation still never mutates global settings). Docs (`AGENTS.md`, `docs/DATA_FLOWS.md` §9, `docs/SCHEMA_REFERENCE.md`) still describe the old unload behavior — left for the post-task docs pass per the Working Agreement. Changeset: `.changeset/fact-check-keep-model-loaded.md` (patch on `@therascript/worker`, `@therascript/api`).
