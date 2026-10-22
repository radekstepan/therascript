---
'@therascript/ui': patch
---

# Task 4: vertically center the Claim mix bar in its table row

- The Accuracy by Authoring LLM table's Claim mix cell inherits baseline alignment, which pinned the 10px proportion bar's bottom edge to the row's text baseline instead of centering it. The cell now uses `vertical-align: middle`.
