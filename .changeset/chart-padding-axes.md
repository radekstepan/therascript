---
'@therascript/ui': patch
---

Fix the Accuracy & Hallucinations Over Time chart side padding so the edge issue bars no longer cover the y-axis tick labels or clip past the SVG edge. The x-scale is now inset by half a bar width, the side padding widened, and the first/last x-axis labels anchor inward.
