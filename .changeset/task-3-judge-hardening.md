---
'@therascript/api': patch
'@therascript/ui': patch
'@therascript/worker': patch
---

# Task 3: Judge execution hardening

- **Deterministic `0.3` Judge temperature default** end to end (API, worker, launch modal), and the worker caps unrestricted (`-1`) thinking budgets at 2048 tokens so reasoning can't starve the verdict JSON.
- **JSON repair:** control-character/trailing-comma sanitization plus one retry with thinking disabled and `temperature: 0.1`; usage logs and token counts are recorded even when parsing fails.
- **Greeting fast-path** completes trivial conversational messages with zero LLM calls, and a **cross-worker mutex** serializes model load/unload so analysis and verification jobs never evict each other's model.
