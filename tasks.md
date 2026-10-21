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

The buttons in the header of Fact Check need to be right aligned on the same row as the title that says "Fact Check"

I don't understand why say session "foo" has accuracy of 0.8%. Statements???

Show accuracy by llm and the chart over time above rather than next to each other. The chart should go first.

When I navigate from issue feed to that chat, it opens the Fact Check modal on the page 2x

Highlight the name of the session in the issues feed like a link just like we do elsewhere

Be able to filter the issues list by client

Don't like the purple judge label when job is running, put the name of the judge in the "audit in progress" line instead

Currently we change the icon of the session in the list when it has a chat (speech bubble icon). If it is also fact checked, use that icon instead (the one you use in the header of the chat panel on the session page in the Fact Check Chat)

The Fact Check Chat should just be an icon in the header of the chat instzead of a whole "action" looking thing. Still should have a color. Doesn't open any modal or anything.

Just to confirm, we only Fact Check AI messages/responses and not user's messages correct? Just confirm in writeup here, no need to makea commit.
