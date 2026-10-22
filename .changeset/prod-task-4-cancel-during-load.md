---
'@therascript/worker': patch
'@therascript/data': patch
---

# Task 4 (prod-readiness): cancellation during model loading is no longer overwritten

- **Fixed canceled audits silently resuming:** the worker checked cancellation before awaiting model loading, then wrote `processing` unconditionally. A cancel landing during the await was overwritten, the next check read the revived state, and the canceled audit continued (while the API could accept a second audit).
- **Post-load re-read on both paths:** after the model load resolves, the job row is re-read and a `canceled` (or missing) job finishes as canceled with zero judge calls. If the load rejects after a cancel, the cancellation is preserved instead of being overwritten with `failed`.
- **Conditional `pending -> processing` transition:** the new `transitionJobToProcessing` repository helper only transitions non-terminal rows (`WHERE status NOT IN ('completed','failed','canceled')`), so even a cancel landing between the final re-read and the write cannot be revived. A lost race finishes as canceled without judge calls.
