---
'@therascript/ui': patch
---

# Task 7: subtler Fact Check highlight fills that reveal full color on hover

- Verified-statement marks on session notes now rest one alpha step below the verdict color (`red-a2` / `amber-a2` instead of `a3`) and switch only the fill back to full (`a3`) on hover. Underlines, borders, radius, and padding are byte-identical; supported marks stay fill-less (transparent) as before.
- The old hover treatment (brightness filter + gray box-shadow line) is removed in favor of the fill switch. Implementation detail: resting fills stay inline, so hover sets a `--verified-mark-bg` variable per `data-verdict` (a plain stylesheet rule cannot override an inline background); plain-text marks now carry `data-verdict` like the markdown path already did.
