---
'@therascript/ui': patch
---

Stop model-list discovery from firing outside an open model dialog. The shared LLM model picker and the model-management dialog now pin `refetchOnWindowFocus: false` explicitly instead of inheriting the client's global default, so refocusing the window — like audit jobs/stats polling, SSE progress updates, and tab switches — never starts model discovery from hidden or backgrounded controls. Discovery still runs when a picker dialog opens or its endpoint changes, plus the picker's explicit error-Retry; the audit's jobs/stats polling and the dialog's own LLM status request are unchanged, and the last-known-good remote URL persistence still runs only for intentional, enabled discovery.
