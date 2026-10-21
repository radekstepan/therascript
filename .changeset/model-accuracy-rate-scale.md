---
'@therascript/ui': patch
---

Fix fabricated/contradicted rates over 100% in the Accuracy by Authoring LLM card (e.g. 357.1%). The backend already returns fabricationRate/contradictionRate pooled across messages and percent-scaled (fabricated/total*100, like accuracyPercent), but the card multiplied them by 100 a second time. The card now renders the rates as-is, matching the backend and MSW percent-scale contract.
