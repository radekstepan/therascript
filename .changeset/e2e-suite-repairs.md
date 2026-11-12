---
'@therascript/ui': patch
---

# Repair the e2e suite (78/78 green)

- Add the missing `GET /api/vault/status` MSW mock (legacy-fallback shape). The App vault gate blocks the entire UI until the first status fetch succeeds, so without it every spec stalled on the "Connecting to server…" spinner.
- Persist injected `e2eVerificationJobs` in `localStorage` (fact-check-fixture precedent): MSW v2 resolves handlers in the page realm, so `page.goto` after seeding wiped the module-state job list. Fixes verification-job-history, verification-live-banner, and jobs-queue-verification.
- Add generic `GET /api/analysis-jobs/:jobId` mock serving seeded `e2eAnalysisJobs` detail (fixes cancel-icons job-100 detail view).
- Give the Landing sessions-table wrapper `minHeight: 200px` (standalone-chats precedent): the virtualized table collapsed to ~14px and rendered zero rows. Fixes landing, crud, and analysis specs.
- Update specs to current UI contracts: chart-tooltips per-string assertions, job-history `exact` badge match, jobs-queue text-anchored row locator, and remote-llm-status state-panel expectations (input replaced by `model-state-panel` when no model is ready; header hides the model name unless loaded; dialog dismissed before role queries since Radix `aria-hidden`s the background).
