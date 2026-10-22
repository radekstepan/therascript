---
'@therascript/ui': patch
---

# Task 2: drop the duplicate spinner in the live audit banner

- `LiveJobBanner` rendered two spinners a few pixels apart while an audit ran: one in the header next to `Audit #<id> in progress...` and a second next to the live phase text.
- The phase-row spinner is removed; the header spinner stays as the single activity indicator. The `audit-live-phase` text and elapsed-time elements are untouched.
