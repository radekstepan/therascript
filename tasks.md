# Fact-Checking & Verification UI / Worker Follow-Up Tasks

Sequential, self-contained engineering tasks for the Hallucination Audit (`/verification`) UI and the Verification Judge worker (`packages/worker/src/jobs/verificationProcessor.ts`). Work through these tasks in order (`Task 1` → `Task 5`), marking each checkbox (`- [x]`) and running its **Verification** commands before moving to the next.

For background on the Verification Agent and LLM lifecycle, see `AGENTS.md` (§1 "Verification Agent", §3 "Session Chat Agent"), `docs/DATA_FLOWS.md`, and `docs/SCHEMA_REFERENCE.md`.

## Working Agreement

- **Subagents:** implement each task in a dedicated subagent (sequential, in task order — later tasks build on earlier ones), with a final synthesis pass over all task results.
- **Changeset per task:** after finishing a task and before moving to the next, add a `.changeset/<kebab-case-name>.md` entry (patch bump on every touched `@therascript/*` package, following the style of existing entries) and commit the task's code + tests + changeset + checkbox tick as one commit.
- **Writeup per task:** after finishing a task, append a short writeup under that task's section in this doc — **what** changed (files/behavior) and **why** (the reason, not just the mechanism).
- **Docs after all tasks:** once every task is done, update the affected learnings/architecture docs (`AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/COMPONENT_MAP.md`, `docs/NAVIGATION.md`, `docs/API_REFERENCE.md`, `docs/DATA_FLOWS.md`, `docs/SCHEMA_REFERENCE.md`) so they describe the new behavior — never leave the docs stale relative to the finished work.

---

"yarn build" taking a really long time, what's up?
 Tasks:    14 successful, 14 total
Cached:    12 cached, 14 total
  Time:    1m20.008s 

In Accuracy and Hallucinations over time the tooltips don't show where the bar/data point is

In the Issues Feed while Fact Check is running I see "refreshing..." flickering constantly

Fact Check - Claim mix little bar is not vertically aligned in the table row

On FAct Check Audit #5 most of the prompts worked, but this one didn't:
Completed with errors: 18 of 19 checked, 1 failed (job 5, judge "qwen3.8-27b"). First failure [malformed_json]: [malformed_json] Judge returned invalid JSON for message 1819 (job 5, judge "qwen3.8-27b", retrying, attempt 2 of 2, 570.0s, 42747+57605 tokens): Judge LLM did not return valid JSON (unparseable output). Retries exhausted (1 retry).

When looking at transcript chat with a transcript reference, make it easy to jump to that part of the transcript to check yourself.

The colors of fact checks on a session note should be a bit more transparent and only the transparency should switch to the current color/transparency onhover. Do not modify underline, border or anything like that.

On the Fact Check modal there is a "Clear Verification" button. Is that for the statement itself or the whole note? Would it then be rechecked on the next Fact Check run? I agree it would be good to clear certain findings of a Fact Check, just make it clear witht he actions what you do. Provide a tooltip over the action too.
