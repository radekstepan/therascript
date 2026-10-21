---
'@therascript/ui': patch
---

Rename the user-visible "Judge Verdict" strings in the verification flow to "Fact Check". The verdict modal title now reads "Fact Check", and the entry-point tooltips that open it (inline statement-highlight tooltips in both markdown and plain-text modes, plus the hallucination/contradiction badge tooltip in session chat) point at the Fact Check instead of the Judge's verdict. Internal identifiers (props, API fields, DB columns) are unchanged.
