---
'@therascript/ui': patch
---

Hide the configured model name in the session and standalone chat headers unless it is actually resident on the LLM server. A settled-but-unloaded model now shows only the "Not loaded" badge (plus Configure) instead of the name in calm gray, so the header can no longer read as loaded while the input says "Model not loaded".
