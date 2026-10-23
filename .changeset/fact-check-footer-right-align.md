---
'@therascript/ui': patch
---

# Right-align Fact Check modal Prev/Next navigation

- The `StatementVerdictModal` footer is now a single right-aligned column (`justify="end"`): with the response-scoped Clear action gone, the leftover `justify="between"` + empty left filler served no purpose. Prev/Next (and Dismiss, when shown) sit in one right-pinned row.
