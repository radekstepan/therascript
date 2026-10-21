---
'@therascript/ui': patch
---

Rename the Fact Check modal's empty-evidence note from "The Judge did not attach transcript quotes for this statement." to "The Fact Check did not attach transcript quotes for this statement.", completing the Judge Verdict -> Fact Check rename for that string. Investigation of the full evidence flow (judge JSON -> normalizeEvidence -> verified_statements.transcript_evidence_json -> API parsed evidence -> parseStatementEvidence -> modal) found no data loss: empty states appear exactly when the judge returns no usable transcript quotes for a non-fabricated statement, which the prompt permits, so the note is the designed fallback and the data flow is unchanged. Fabricated statements without evidence keep their distinct red "No matching evidence found" callout.
