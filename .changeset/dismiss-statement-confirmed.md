---
'@therascript/domain': patch
'@therascript/db': patch
'@therascript/data': patch
'@therascript/api': patch
'@therascript/worker': patch
'@therascript/ui': patch
---

# Dismiss individual Fact Check findings as confirmed

Adds durable per-finding human confirmation ("Dismiss Statement (Confirmed)") to the Fact Check flow:

- New `verification_statement_reviews` table (migration V22, message-owned, survives per-response clears and reruns) plus `material_revision` on assessments and stored finding identity (`finding_key`, `context_revision`) on statements. Legacy rows start unreviewed.
- Shared `@therascript/domain` identity/scoring contract: canonical finding text, material fingerprint (visible answer + therapist question + full transcript), deterministic finding keys, opaque review tokens, and one review-aware reduction (confirmed problematic claims count as supported with the claim total unchanged; confirmed omissions leave the active count).
- `POST /api/verification/statements/:statementId/dismiss` (id + token only; `200` idempotent, `400` malformed, `404` replaced ids, `409` stale/non-completed/supported). The worker reconciles confirmations at save time, revalidates material before committing (stale results discarded as skipped), and publishes persisted effective values.
- UI: Dismiss action with pending/error states and "Confirmed by you" badge in the verdict modal (ID-tracked selection, immediate cache update + dependent invalidation), highlight removal for confirmed claims, Active Issues feed exclusion with pagination clamp, and reset/clear copy clarifying confirmation lifetimes. Backup export/import round-trips reviews with association remapping and aggregate recomputation.
