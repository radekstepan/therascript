# Therascript Production-Readiness Task Plan

This document is structured as a sequential execution plan for an LLM orchestrator delegating work to **subagents in series** (one task at a time).

## Orchestrator Execution Protocol

1. **Run Strictly in Series**: Invoke **one subagent per task** (`Task 1` $\rightarrow$ `Task 2` $\rightarrow$ ... $\rightarrow$ `Task N`) using `Workspace: 'inherit'`. Wait for the active subagent to finish and report back before starting the next task so file edits and builds never collide.
2. **Environment Requirement**: Always ensure Node `23.10.0` (see `.nvmrc` and `AGENTS.md`) is active before running `yarn` commands.
3. **Subagent Handoff Prompt Template**:
   When invoking a subagent for `Task N`, pass:
   - The full section for `Task N` from this file.
   - Instructions to read the listed **Target Files** first, implement the changes, add/update unit tests where specified, run the **Verification** commands, and update `tasks.md` to mark `- [x] Task N` upon completion.
4. **Gatekeeping**: Do not advance to `Task N+1` until `Task N`'s verification commands (`yarn test` and package builds) exit `0`.
5. **Record Changes with Changesets**: Every user-facing change must ship with a changeset. Run `yarn changeset` (or add a Markdown file under `.changeset/` by hand) listing the bumped packages plus release-note prose. Cut releases with `yarn version-packages`, which consumes pending changesets and updates `CHANGELOG.md` files. See `.changeset/README.md`.

---

