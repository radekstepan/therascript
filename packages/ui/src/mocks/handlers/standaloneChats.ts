// packages/ui/src/mocks/handlers/standaloneChats.ts
//
// /api/chats/* — standalone chat list/create/get/SSE stream/
// context-usage/edit name+tags/delete. Chat 43 is the seeded target
// for the standalone-chat.spec.ts flow (POST returns id 44, then
// refetch).
//
// Owned spec files: standalone-chat.spec.ts, crud.spec.ts,
// chat-navigation.spec.ts (partial — refetches the seeded chat 42),
// landing.spec.ts.
import { http, HttpResponse } from 'msw';
import {
  e2eStandaloneChats,
  mockActiveModel,
  mockMessageCounter,
  mockStandaloneChatMessages,
  setE2eStandaloneChats,
  setMockMessageCounter,
  setMockStandaloneChatMessages,
} from '../state';

export const standaloneChatsHandlers = [
  http.get('/api/chats/:chatId', ({ params }) => {
    const chatId = parseInt(params.chatId as string, 10);
    return HttpResponse.json({
      id: chatId,
      sessionId: null,
      timestamp: Date.now(),
      name: null,
      tags: null,
      messages: chatId === 43 ? mockStandaloneChatMessages : [],
    });
  }),

  http.get('/api/chats/:chatId/context-usage', () => {
    return HttpResponse.json({
      model: {
        name: mockActiveModel || 'mock-model',
        configuredContextSize: 8192,
        defaultContextSize: 8192,
        effectiveContextSize: 8192,
      },
      breakdown: {
        systemTokens: 312,
        transcriptTokens: 0,
        chatHistoryTokens: 0,
        inputDraftTokens: 6,
      },
      reserved: { outputTokens: 1024 },
      totals: {
        promptTokens: 318,
        percentUsed: 0.04,
        remainingForPrompt: 6850,
        remainingForOutput: 1024,
      },
      thresholds: { warnAt: 0.6, dangerAt: 0.85 },
    });
  }),

  http.post('/api/chats/:chatId/messages', async ({ request, params }) => {
    const body = (await request.json().catch(() => ({}))) as { text?: string };
    const userText = typeof body.text === 'string' ? body.text : '';
    const chatId = parseInt(params.chatId as string, 10);

    const counter = mockMessageCounter;
    const userMessageId = 100 + counter * 2;
    const aiMessageId = 101 + counter * 2;
    setMockMessageCounter(counter + 1);
    const timestamp = Date.now();

    const encoder = new TextEncoder();
    const sse = (payload: unknown) =>
      encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(sse({ status: 'thinking' }));
        controller.enqueue(sse({ status: 'responding' }));
        controller.enqueue(sse({ chunk: 'Hello ' }));
        controller.enqueue(sse({ chunk: 'from standalone mock LLM' }));
        controller.enqueue(
          sse({
            done: true,
            completionTokens: 24,
            thinkingTokens: 0,
            duration: 1200,
            isTruncated: false,
          })
        );
        controller.close();
      },
    });

    setMockStandaloneChatMessages([
      ...mockStandaloneChatMessages,
      {
        id: userMessageId,
        chatId,
        sender: 'user',
        text: userText,
        timestamp,
      },
      {
        id: aiMessageId,
        chatId,
        sender: 'ai',
        text: 'Hello from standalone mock LLM',
        timestamp: timestamp + 1,
        promptTokens: null,
        completionTokens: 24,
        thinkingTokens: 0,
        duration: 1200,
        isTruncated: false,
      },
    ]);

    return new HttpResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'X-User-Message-Id': String(userMessageId),
      },
    });
  }),

  // --- Standalone chat CRUD (crud.spec.ts) -----------------------
  // GET /api/chats — served from the mutable list.
  http.get('/api/chats', () => HttpResponse.json(e2eStandaloneChats)),

  // POST /api/chats — create. Adds a new id 44 by default.
  http.post('/api/chats', () => {
    const newChat = {
      id: 44,
      sessionId: null,
      timestamp: Date.now(),
      name: null,
      tags: null,
    };
    setE2eStandaloneChats([...e2eStandaloneChats, newChat]);
    return HttpResponse.json(newChat, { status: 201 });
  }),

  // PATCH /api/chats/:id/details — edit name + tags.
  http.patch('/api/chats/:id/details', async ({ request, params }) => {
    const id = parseInt(params.id as string, 10);
    const body = (await request.json().catch(() => ({}))) as {
      name?: string | null;
      tags?: string[] | null;
    };
    setE2eStandaloneChats(
      e2eStandaloneChats.map((c) =>
        c.id === id
          ? {
              ...c,
              name: body.name === undefined ? c.name : body.name,
              tags: body.tags === undefined ? c.tags : body.tags,
            }
          : c
      )
    );
    const updated = e2eStandaloneChats.find((c) => c.id === id);
    return HttpResponse.json(updated);
  }),

  // DELETE /api/chats/:id — removes from the list.
  http.delete('/api/chats/:id', ({ params }) => {
    const id = parseInt(params.id as string, 10);
    setE2eStandaloneChats(e2eStandaloneChats.filter((c) => c.id !== id));
    return HttpResponse.json({ message: `Chat ${id} deleted.` });
  }),
];
