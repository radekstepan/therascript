---
'@therascript/ui': patch
---

Fix the empty-rectangle cancel button icons throughout the app. Every cancel affordance used Radix `StopIcon`, whose SVG path is a hollow even-odd square outline that renders as a tofu box at icon size; all six call sites (chat cancel-stream button, analysis list dropdown + detail header + confirm-cancel dialog, verification live banner + job history, LLM download cancel) now use the `Cross2Icon` X glyph matching every other Cancel button.
