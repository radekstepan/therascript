---
'@therascript/ui': patch
---

# Task 1: Transcript Coverage count and failed badge stay on one line

- The `Coverage` column cell now lays out `{verified} / {total} msgs` and the red `{n} failed` badge side-by-side in a single horizontal row (`direction="row"`, `nowrap`) instead of stacking them in a column.
- Both elements are `whiteSpace: nowrap` with `flexShrink: 0`, so tight table widths never wrap them internally or inflate row height.
- The failed badge keeps its tooltip (`"... failed verification (LLM error)..."`); rows without failures render unchanged.
