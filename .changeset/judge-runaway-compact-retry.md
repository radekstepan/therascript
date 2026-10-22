---
'@therascript/domain': patch
'@therascript/data': patch
'@therascript/worker': patch
'@therascript/ui': patch
---

# Task 5: survive Judge runaways that fill the completion cap with invalid JSON

- Audit #5's `malformed_json` failure (message 1819, judge `qwen3.8-27b`, 57k completion tokens over 570s) was a runaway: the Judge filled its giant completion window with unparseable output, truncated mid-JSON, and the retry repeated the identical call and failed the same way. The worker now detects runaway attempts from server-reported usage (filled the cap, or ≥16k unparseable completion tokens) and retries with a compact-verdict reminder under a fail-fast cap (`min(original, 8k)`) — a concise valid verdict fits comfortably, while a second ramble fails in a minute or two instead of ~10. First attempts keep the full window and thinking/temperature behavior is unchanged, so nothing that used to succeed is affected.
- Cap-truncated failures now persist as a distinct `truncated_output` code (with cap numbers in the detail, e.g. `hit the completion cap (57605 of 60000 max tokens)`) instead of cryptic `malformed_json`, labeled `Judge output truncated` in the UI. Stored in the existing `error_code` TEXT column — no migration.
