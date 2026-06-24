// packages/ui/src/mocks/handlers/index.ts
//
// Composes the per-domain MSW handlers into a single array that
// ./browser.ts and ./server.ts consume. The order matters: more
// specific (static-path) handlers must register before more general
// (param) ones, so MSW's route matcher picks the right one. The
// order below matches the original handlers.ts.
import { analysisHandlers } from './analysis';
import { e2eHandlers } from './e2e';
import { llmHandlers } from './llm';
import { readinessHandlers } from './readiness';
import { searchHandlers } from './search';
import { sessionChatsHandlers } from './sessionChats';
import { sessionHandlers } from './sessions';
import { standaloneChatsHandlers } from './standaloneChats';
import { systemHandlers } from './system';
import { templatesHandlers } from './templates';
import { transcriptionHandlers } from './transcription';
import { usageHandlers } from './usage';

export const handlers = [
  // --- Domain handlers (order matches the original handlers.ts) ----
  // 1. Sessions: static (id=1, id=3, upload) before generic (:id).
  ...sessionHandlers,
  // 2. Session chats: static (chat 10 SSE + context-usage) before
  //    generic (:chatId).
  ...sessionChatsHandlers,
  // 3. Standalone chats: static (chat-id SSE) before generic list.
  ...standaloneChatsHandlers,
  // 4. Analysis jobs: static (job 1 detail + stream) before generic
  //    list.
  ...analysisHandlers,
  // 5. LLM: status / set-model / available-models / estimate-vram.
  ...llmHandlers,
  // 6. Usage: history / stats / logs.
  ...usageHandlers,
  // 7. Search.
  ...searchHandlers,
  // 8. Templates: list / create / update / delete.
  ...templatesHandlers,
  // 9. Transcription: status poll.
  ...transcriptionHandlers,
  // 10. System: gpu-stats / jobs / admin.
  ...systemHandlers,
  // 11. Readiness: must be late because most pages fire it on mount.
  ...readinessHandlers,
  // 12. e2e test hooks: register last so production code never hits
  //     them; if a real /api/__e2e/* path is added to production,
  //     these no-op endpoints would shadow it.
  ...e2eHandlers,
];
