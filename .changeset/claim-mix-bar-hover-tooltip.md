---
'@therascript/ui': patch
---

# Claim mix bar owns a hover tooltip

- The Accuracy by Authoring LLM `ProportionBar` is now wrapped in the app `AppTooltip` (Radix, portaled) showing that model's own readout: model name, `{supported} supported · {partial} partial · {bad} contradicted/fabricated`, and `{total} claims across {n} audited responses`.
- Because Radix renders tooltip content in a portal, the readout escapes the table's `overflow-x: auto` scroller instead of being clipped by it. The bar keeps its `role="img"` percentage label and gains `tabIndex={0}` so keyboard focus opens the same readout.
