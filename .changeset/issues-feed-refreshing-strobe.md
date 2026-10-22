---
'@therascript/ui': patch
---

# Task 3: stop the Issues Feed "refreshing…" strobe during audits

- Root cause: the verification SSE hook refetched all four dashboard queries (stats, jobs, chat verifications, statements) on every `progress` and `phase` event — and the worker emits token-speed `phase` ticks ~3/sec during generation. Each refetch toggled `isFetching`, so the feed's `· refreshing…` suffix (plus the Updating spinner and pagination disabled states) strobed constantly. The hook now invalidates only on `message_verified` (the only event that persists new data) and the existing terminal/reconnect paths; banner progress still merges locally on every tick and the jobs/stats polls backstop missed events.
- The `· refreshing…` suffix itself is now always mounted and opacity-toggled (aria-hidden while idle) instead of conditionally rendered, so legitimate refetches never shift the line.
