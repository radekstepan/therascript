---
'@therascript/api': patch
---

# Task 6 (prod-readiness): verification SSE stream no longer drops terminal events

- **Fixed terminal completion/failure/cancellation never reaching the browser:** `send()` deferred each enqueue with `setImmediate`, but the terminal Redis path set `streamClosed` and closed the controller synchronously, so the scheduled terminal payload (and any previously queued progress) was discarded. Clients had to reconnect for a terminal snapshot to discover completion, delaying callbacks and losing the original terminal error event.
- **Serialized enqueue and close:** sends now append to a promise chain that preserves the per-event event-loop yield (no kernel-flush coalescing regression), and the terminal close is appended to the same chain so every queued payload flushes before the controller closes.
- **Idempotent teardown:** close and Redis unsubscribe are guarded so duplicate terminal deliveries can no longer throw `Controller is already closed` or unsubscribe twice; client-disconnect handling is unchanged.
