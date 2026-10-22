---
'@therascript/worker': patch
---

# Task 3 (prod-readiness): evidence hydration validates the quote before trusting the paragraph index

- **Fixed fabricated quotes borrowing real citations:** hydration previously accepted any existing `paragraphIndex` immediately, attaching that paragraph's real timestamp/speaker to the supplied quote. A fabricated quote paired with a valid index therefore appeared grounded.
- **Quote-first validation:** the normalized quote must now appear in the indexed paragraph (trailing sentence punctuation tolerated so clause quotes still match). On mismatch the quote is searched across the other paragraphs and re-attributed when found elsewhere; when no paragraph contains it, the citation metadata is nulled so the UI reports an unknown transcript position instead of a grounded citation.
- Correctly matched citations hydrate exactly as before.
