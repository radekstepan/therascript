---
'@therascript/worker': patch
---

# Task 8 (prod-readiness): judge context budgeting fits the configured window

- **Fixed context-window overflow:** completion kept a blind 4096-token floor and transcript a 512-token floor regardless of remaining capacity, so a permitted 4096-token context reserved more than its entire window before the system prompt, question, and answer were counted, and large answers overflowed bigger windows too.
- **Remaining-capacity allocation:** the new `allocateJudgeContextBudget` helper derives completion (preferred 30% of context / 4096 floor only when room allows) and transcript budgets from the actual remaining window, guaranteeing estimated prompt plus completion stays within the configured context; the per-call thinking budget (40% of completion) follows the allocated value.
- **Explicit infeasible handling:** a job whose window cannot fit even an empty request fails fast before model loading with a clear error, and an oversized individual message is saved as a failed verification (zero tokens, explanatory error) without a judge call while fitting messages in the same job still audit normally.
