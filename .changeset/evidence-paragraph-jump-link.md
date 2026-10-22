---
'@therascript/ui': patch
---

# Task 6: jump from Fact Check evidence to the transcript paragraph

- The `¶N` reference on each Fact Check evidence card is now a link to `#paragraph-N`, so verifying a claim against the transcript is one click instead of manual scrolling. The link stays on the current chat route (same-page hash), preserving chat context — the side-by-side desktop transcript panel scrolls to and briefly highlights the paragraph.
- Two supporting fixes make the landing work: the desktop transcript panel now passes `isTabActive` (it previously never did, so the existing `#paragraph-<id>` scroll effect was dead on desktop), and paragraph hashes auto-switch small screens to the Transcript tab.
