---
'@therascript/ui': patch
---

Simplify the below-note verification footer in session chat. The hallucination / partially-supported / omission badge set and the model-name chip are replaced by a single label showing only the highest severity (hallucinations and contradictions outrank partials and omissions, which outrank the clean "Verified" state), rendered as a link that opens the Fact Check modal at the most severe statement. The label sits right-aligned in the same row as the tokens display; the row shares the note bubble's max-width and both cells shrink with ellipsis, so the label can never overflow past the note's right edge.
