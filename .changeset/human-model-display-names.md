---
'@therascript/ui': patch
'@therascript/config': patch
---

# Consistent human-readable LLM names in Fact Check and usage logs

- New `formatModelDisplayName` UI override (`packages/ui/src/utils/modelDisplay.ts`) maps stored ids to display names without touching the DB: `gemma3:12b-it-qat` → `gemma3-12b`, `qwen/qwen3.5-9b` → `qwen3.5-9b` (plus a generic `vendor/model` slash-strip fallback), while `qwen3.5-9b`, `qwen3.8-27b`, and `Unknown Model` pass through. Null/empty/whitespace and any `unknown model` casing normalize to `Unknown Model`.
- Fact Check surfaces (audit banner Judge, job history, failure details, issues feed filter + `authored → Judge` line, accuracy-by-model table/tooltips, trend filter, coverage `Chat LLM`, verdict modal footer) and Settings Detailed Usage Logs (model filter dropdowns + table column) render the formatted name with the raw id kept as the filter value, `title` tooltip, and React key so filtering and API params are unchanged.
