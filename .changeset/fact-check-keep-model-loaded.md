---
'@therascript/worker': patch
'@therascript/api': patch
---

Keep the Fact Check Judge model loaded after the audit finishes and adopt its config as the active model settings. The verification worker no longer unloads the Judge model in `finally`, so Session/Standalone chat and the next Fact Check reuse the warm model with settings preset; starting a job with a different model still evicts the previous one at load time, like Session Chat.
