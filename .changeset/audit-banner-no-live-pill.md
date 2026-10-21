---
'@therascript/ui': patch
---

Remove the Live / Connecting connectivity pill from the Audit in Progress banner. The pill (green Wifi "Live" once the SSE stream connected, gray WifiOff "Connecting…" before that) exposed internal connection state as noise in the progress card. The banner keeps its heading, progress bar, counters, Judge badge, Cancel action, and stream-error notice.
