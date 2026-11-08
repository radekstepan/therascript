---
'@therascript/api': patch
'@therascript/ui': patch
---

Fix inconsistent model-loaded tracking between the LLM status probe and the chat UI.

- `GET /api/llm/status` is now a read-only probe: it no longer rewrites the persisted active model to whatever the server happens to have loaded (on a shared/remote server an out-of-band model change silently replaced the user's configuration and the UI reported "loaded" for a model never picked). The server's actual resident is reported separately as `actualLoadedModel`, and real reachability as `status` / `serverReachable` (the `unavailable` branch was dead code — every response claimed `available`).
- `POST /api/llm/unload` resets the load-attempt tracker to idle so a stale "Load failed" banner cannot survive an explicit unload.
- Chat headers (session + standalone) render every settled state explicitly via a shared `LlmStatusBadge`: green check when loaded, a "Not loaded" badge after unload/eviction, an amber mismatch indicator naming the stranger ("Server has X, you configured Y"), and a red unreachable indicator. The chat input placeholder and send-button tooltip now name the disabled reason instead of showing the normal prompt on a disabled field.
- The Configure AI Model form only locks behind "Unload it to change settings" when the loaded flag actually refers to the configured model.
- The MSW mock now mirrors production unload (configured name stays, `loaded: false`) instead of clearing the active model, and e2e covers the stale-name, mismatch, and unreachable states.
