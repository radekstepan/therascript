---
'@therascript/data': patch
'@therascript/ui': patch
---

Fix per-session fact accuracy rendering as a fraction of a percent (e.g. 0.8% instead of 80%). The session summaries returned `averageAccuracy` on the 0-1 scale while every other accuracy field in the payload (`overallAccuracyPercent`, per-model/per-day `accuracyPercent`) and the UI are percent-scaled; the backend now returns `averageAccuracy` on the 0-100 scale. The Transcripts coverage table also gains a tooltip explaining the number: mean per-response fact accuracy (supported claims plus half credit for partials, over extracted claims plus omissions).
