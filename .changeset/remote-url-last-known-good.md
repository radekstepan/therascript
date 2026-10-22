---
'@therascript/ui': patch
---

Remember the last successfully queried remote LM Studio URL across the app. The shared `llm-remote-base-url` preference is now the last known good endpoint: the shared model picker persists the normalized URL as soon as a remote models request succeeds (an empty list counts; HTTP errors and malformed responses leave the stored value untouched), so no model save is required. Typed values stay transient until their own request succeeds — a delayed response for one URL never saves the current input — local endpoints are ignored, and API tokens are never stored alongside it. All remote endpoint forms (chat, analysis, verification) pre-fill from the same remembered value on open and on Local-to-Remote switches without clobbering in-progress edits; failed edits, clearing the field, and Local-mode saves preserve it. Modal Save/Submit handlers no longer write the preference, so an untested URL can never replace a good one.
