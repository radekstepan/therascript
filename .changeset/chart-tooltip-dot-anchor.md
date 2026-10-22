---
'@therascript/ui': patch
---

# Task 2: anchor accuracy-chart tooltips to the data point

- The Accuracy & Hallucinations Over Time tooltip trigger was the point's full-plot-height hover group, so Radix anchored the readout to the middle of the chart instead of the dot/bars under the cursor. The trigger is now just the dot circle while the group (dot + full-height hover rect + keyboard focus) still drives the controlled open state — hovering the stacked bars shows the readout at that point's dot.
- `AppTooltip` gains optional controlled-mode passthrough (`open` / `defaultOpen` / `onOpenChange`); chart tooltips also use `delayDuration={0}` so the readout tracks the pointer across adjacent points without lag.
