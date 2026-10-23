---
'@therascript/ui': patch
---

# Fact Check inline highlight: single background-only flash

- The active verification `<mark>` (`verified-statement-mark-active`) flashed twice (`0.9s ease-out 2`) with a box-shadow ring that persisted as a 2px border while the step was selected. It now flashes once (`1` iteration) with no ring (`box-shadow: none`).
- The `verified-mark-flash` keyframes animate `background-color` from the verdict tint (`--verified-flash`: red/amber/green `a5`) instead of a `box-shadow` spread, so only the fill flashes. Only the `0%` frame is defined so the animation settles back into each mark's own resting fill instead of snapping.
