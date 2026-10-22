---
'@therascript/ui': patch
---

Fix the issues-feed deep-link opening two stacked Fact Check modals. The session view mounts the chat twice (desktop side-by-side + mobile tabs, CSS-toggled) and both instances consumed `?highlightMsg`; since Radix dialogs portal to the body, both modals were visible. Only the viewport-matching instance now handles the deep-link.
