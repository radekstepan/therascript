---
'@therascript/ui': patch
---

# Task 7: failed-verification footer layout fix

- **No more Clear/label overlap:** the failed-verification footer gives "Fact-check failed" and Clear separate layout space with an explicit gap, and the row wraps on narrow notes instead of squeezing.
- **Hover/focus-safe Clear button:** switched from the Radix `ghost` variant (whose negative margins pulled its hover/focus background over the label) to `soft`, so the button background stays inside its own box at rest, hover, keyboard focus, and in the "Clearing…" pending state.
