---
'@therascript/ui': patch
---

# Task 8: clarify the Fact Check modal's clear action scope

- The modal's `Clear Verification` button read as if it might clear only the statement shown, but it deletes the whole response's verification (all statements). It is renamed to `Clear Response Fact Check` and gains an `AppTooltip` spelling out the scope (`all N fact-check statements for this response — not just the one shown above`) and the recheck behavior (the response returns to the unverified pool and will be re-checked on the next audit).
