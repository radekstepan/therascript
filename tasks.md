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

- [x] remove "Cleare Response Fact Check button from Fact Check modal
  - **Done:** deleted the "Clear Response Fact Check" footer action (plus its `clearMutation` and the now-unused `messageId` modal prop) from `packages/ui/src/components/Verification/StatementVerdictModal.tsx`; `ChatMessages.tsx` no longer passes `messageId`. Per-response clearing stays available for failed verifications via the "Clear" button in `ChatMessageBubble.tsx`, and via Reset All Verifications on the `/verification` hub.
  - **Why:** the response-scoped delete did not belong in a per-statement verdict modal (its tooltip had to explain it cleared all N statements, not the one shown); failed-message retry keeps its own inline entry point.
  - **Tests:** `StatementVerdictModal.test.tsx` — removed the clear-action suite, replaced with a "clear action removed" assertion; all 15 modal tests + 39 `SessionView/Chat` tests pass.

- [x] Align Prev and Next buttons in Fact Check to the right
  - **Done:** modal footer switched from `justify="between"` (with an empty left filler left over from the Clear action) to a single right-aligned column in `StatementVerdictModal.tsx`; Prev/Next and Dismiss share one right-pinned row.
  - **Why:** with no left-side action remaining, `space-between` pushed the steppers unpredictably; right-pinning matches the dialog-close affordance and other modal footers.
  - **Tests:** new "footer alignment" case in `StatementVerdictModal.test.tsx` asserting Prev/Next share a right-justified row and no Clear button exists; 16/16 modal tests pass.

- Rename "Dismiss Statement (Confirmed)" to "Dismiss" with a trahscan delete icon

- Make it so that Fact Check modal shows to the left of the Transcript and we can see both modal and the transcript. Make the modal moveable too.

- Make sure we have e2e coverage around fact checking including the Fact Check page and individual session transcript page
