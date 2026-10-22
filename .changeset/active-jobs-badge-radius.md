---
'@therascript/ui': patch
---

Render the sidebar Active Jobs count badge as a subtly-rounded rectangle instead of a full-radius oval. Dropping `radius="full"` lets the badge inherit the theme default (`radius="medium"`), matching the badges used elsewhere in the app (Fact Check, Analysis).
