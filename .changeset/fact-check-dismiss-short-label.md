---
'@therascript/ui': patch
---

# Shorten Fact Check Dismiss button with trash icon

- The per-finding confirmation action in `StatementVerdictModal` is renamed from "Dismiss Statement (Confirmed)" to "Dismiss" and gains the `TrashIcon`, matching the delete-style affordance used elsewhere. Tooltip, pending ("Dismissing…"), and "Confirmed by you" badge behavior are unchanged.
