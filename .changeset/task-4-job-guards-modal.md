---
'@therascript/api': patch
'@therascript/ui': patch
---

# Task 4: verification job guards and Jobs Queue parity

- **Starting a verification job no longer clobbers the global chat model** (no more model unload or settings overwrite), and a second concurrent job is refused with `409 Conflict` — resets too, while a job is active (via `hasActiveVerificationJobs()`).
- **Jobs Queue modal parity:** the Verification Jobs section shows flagged-statement counts and a Cancel action for active jobs.
