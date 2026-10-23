---
'@therascript/ui': patch
---

# Same-paragraph link re-highlight + Dismiss button left/grey

- Clicking a `#paragraph-N` transcript jump link while already on that hash now scrolls to and re-highlights the paragraph. Previously only the `location.hash` effect drove highlighting, so same-hash clicks (no location change) did nothing. `Transcription.tsx` extracts the scroll+highlight into a shared callback and adds a document-level click listener for paragraph links (document-level because Fact Check evidence links portal to `document.body`); the clear timeout is reset rather than stacked on double triggers.
- The Fact Check panel's Dismiss button moves to the footer's left column (Prev/Next stay right) and turns grey solid with a bold label instead of green.
