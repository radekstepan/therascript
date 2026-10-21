---
'@therascript/ui': patch
---

Fix the Accuracy by Authoring LLM card's double horizontal scrollbar. The table now renders as a plain table using the repo's rt-sticky-table pattern instead of Table.Root (which mounted its own inner ScrollArea), leaving the outer overflow-x div as the single scroll owner with the 720px min-width kept on the table itself.
