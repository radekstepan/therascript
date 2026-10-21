---
'@therascript/ui': patch
---

Remove top chrome from the Fact Check modal and drop the show/hide-verified toggle from session chat. The modal no longer renders the previous/next statement steppers and counter next to the close button (statement stepping stays available via the bottom Prev/Next buttons and arrow keys). The "Show verified"/"Hide verified" toggle is gone entirely, including its state and supported-claim highlight gate, so all verified claims — including supported ones — stay highlighted in chat at all times.
