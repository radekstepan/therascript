---
'@therascript/ui': patch
---

# Add e2e coverage for fact checking on both surfaces

- New `tests/e2e/fact-check.spec.ts`: the `/verification` hub (Issues feed lists the seeded fabricated claim, Transcripts coverage links to the session, deep-link opens the panel at the fabricated statement) and the session transcript page (`/sessions/1/chats/10` — transcript beside chat, severity link opens the docked movable panel, dock position, header drag, Prev/Next stepping, Dismiss confirmation).
- New `POST /api/__e2e/set-fact-check` mock hook seeding chat messages, chat-scoped verifications, and the flagged-statements feed, plus mock `POST .../dismiss` (409 on stale tokens, like the backend) and `DELETE .../messages/:messageId` handlers. Fixtures live in `localStorage` (readiness-flag precedent): MSW v2 resolves handlers in the page realm, so module state is wiped by full document loads between seeding and asserting.
