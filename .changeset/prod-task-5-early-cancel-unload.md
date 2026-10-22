---
'@therascript/worker': patch
---

# Task 5 (prod-readiness): a job canceled before processing no longer unloads the default endpoint

- **Fixed early-cancel evicting unrelated chat models:** the `finally` block unconditionally called `unloadModelAtUrlForWorker(judgeBaseUrl)` (which unloads every loaded LLM instance at that endpoint), even when the job exited before acquiring anything. At the early-cancel return `judgeBaseUrl` was still the default `config.llm.baseURL`, so canceling a queued remote-judge job while it waited for the worker mutex interrupted an unrelated local chat.
- **Acquisition-tracked cleanup:** the worker now sets a `judgeModelAcquired` flag only after `loadLlmModelForWorker` resolves, and `finally` unloads only when the flag is set — at the job's resolved endpoint. Early-cancel, missing-job, failed-load, and `default`-model exits (which reuse whatever is already loaded) make zero unload calls.
- **Task 4 interaction preserved:** a job canceled while its model load resolves genuinely acquired the model, so its acquired remote endpoint is still released.
