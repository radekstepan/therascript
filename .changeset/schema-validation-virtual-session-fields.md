---
'@therascript/db': patch
---

# Silence schema-validation warnings for computed session fields

- `validateDatabaseSchema` no longer warns about `chatCount` and `factCheckedChatCount` on the `sessions` table; these are computed aggregates from the session list query, not real columns. The old hardcoded `chats` special case is now a per-table `virtualFieldsByTable` map.
