---
'@therascript/api': patch
---

# Task 10 (prod-readiness): backup restore preserves message author-model metadata

- **Model attribution survives restores:** the backup message validator now accepts the optional `model` field and the import insert writes it to `messages.model`, so restored messages keep their authoring model and (re-)audits report the real model instead of Unknown Model.
- **Older backups stay compatible:** the field is nullable/optional and missing values import as `NULL`, so pre-feature backups without `model` restore successfully.
