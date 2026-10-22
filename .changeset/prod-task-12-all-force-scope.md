---
'@therascript/api': patch
'@therascript/data': patch
---

# Task 12 (prod-readiness): the all_force audit scope now enforces re-auditing

- **Fixed force audits silently behaving as unverified-only:** a request with `scope: 'all_force'` and an omitted `skipVerified` flag was persisted with `skip_verified = true`, and candidate selection applied that flag independently of scope — so previously completed messages were excluded and the force re-audit quietly skipped exactly the messages it was supposed to re-check. Only the UI modal's explicit `false` masked this; direct API callers hit the contradictory behavior.
- **Scope-owned semantics, resolved server-side:** a shared `resolveVerificationSkipVerified` helper now defines the invariant in one place — `all_force` always re-audits completed verifications and `all_unverified` always skips them, regardless of an omitted or conflicting flag. The narrowed scopes (`selected_sessions`, `single_chat`) keep explicit flag behavior, defaulting to skip when omitted.
- **Defense in depth at selection time:** candidate selection enforces the same scope authority, so even a pre-fix or restored job row with a contradictory stored flag (e.g. `all_force` + `skip_verified = true`) still re-selects completed messages.
