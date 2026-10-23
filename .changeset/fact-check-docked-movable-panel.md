---
'@therascript/ui': patch
---

# Dock Fact Check modal left of transcript as a movable panel

- `StatementVerdictModal` is now a modeless, left-docked panel instead of a centered modal: it renders fixed at the left edge (`left: 24px`, vertically centered, max 560px wide) over the chat pane, so the session transcript on the right stays fully visible and interactive beside it. No overlay is rendered, so nothing dims the transcript.
- The header doubles as a drag handle (move cursor, pointer-capture dragging with viewport clamping, position resets on open); drags starting on the Close button are ignored.
- Implementation note: `@radix-ui/themes`' `Dialog.Root` hardcodes `modal: true`, so the modal now uses the raw `@radix-ui/react-dialog` primitives (already a direct dependency) with `modal={false}` and the same `rt-DialogContent` surface classes; Escape-to-close and `role="dialog"` semantics are preserved.
