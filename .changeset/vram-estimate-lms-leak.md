---
'@therascript/api': patch
'@therascript/ui': patch
---

# Fix VRAM-estimation `lms` process leak

- **Leak:** every keystroke in the context-size field shelled out a `lms load --estimate-only` child with no timeout, and `lms` can hang indefinitely — leaking one spinning process per keystroke (observed 32 orphans at 15-20% CPU each, PPID 1).
- **UI (`LlmSettingsForm`):** debounce the estimate request ~500ms so typing `30000` fires one probe for the settled value instead of `3 → 30 → 300 → 3000 → 30000`.
- **API (`nativeLMStudioEstimate`):** bound every spawn with a 15s timeout + `SIGKILL`; timeouts fall back to the manual estimate instead of hanging the request forever.
- **API (`fetchVramUsage`):** singleflight concurrent identical probes onto one child process.
