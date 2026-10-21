---
'@therascript/ui': patch
---

Add per-data-point hover tooltips to the Accuracy & Hallucinations Over Time chart. Each trend point (dot plus an invisible full-height hover rect, so hovering the stacked bars reads out the same point) now opens an AppTooltip (Radix) with that point's date, messages audited, accuracy, and claims breakdown (fabricated / contradicted / omitted). The point groups are focusable, so keyboard focus opens the same readout. The native SVG `<title>` elements are removed in favor of the repo-standard AppTooltip, with no layout shift (transparent SVG rect + portaled tooltip content).
