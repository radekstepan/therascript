---
'@therascript/ui': patch
---

# Accuracy by Authoring LLM merges aliased model ids

- New `mergeModelAccuracyStatsByDisplayName` (`packages/ui/src/utils/modelDisplay.ts`) folds `byModel` rows that share a display name (e.g. `qwen/qwen3.5-9b` + `qwen3.5-9b`) into one row: counts summed, accuracy/fabrication/contradiction/omissions rates recomputed with the backend's pooled formulas, `averageAccuracyScore` as a messages-weighted mean, sorted audited-desc like the backend.
- `ModelAccuracyCard` renders the merged rows (row `model` is already the display name), so the table never shows the same human name twice. Filter dropdowns (trend, issues feed, usage logs) keep raw ids as values for API correctness and gain a raw-id `title` tooltip when the label differs.
