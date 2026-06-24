// packages/ui/src/mocks/handlers/sessionChats.ts
//
// /api/sessions/:sessionId/chats/* — session chat fetch, streaming
// send-message (SSE), context-usage. Includes the hardcoded fixtures
// for chat 10 (the chat spec's auto-redirect target) and the generic
// handlers for any other chat id (chat-navigation.spec.ts uses 11).
//
// Owned spec files: session-chat.spec.ts, chat-navigation.spec.ts.
import { http, HttpResponse } from 'msw';
import {
  MOCK_CHAT_ID,
  appendMockChatMessages,
  mockActiveModel,
  mockChatMessages,
  mockMessageCounter,
  setMockMessageCounter,
} from '../state';

export const sessionChatsHandlers = [
  // Context-usage snapshot for the active chat. Non-zero prompt/percent
  // so the ChatPanelHeader progress bar renders and the chat e2e spec
  // can assert it is visible.
  http.get('/api/sessions/1/chats/10/context-usage', () =>
    HttpResponse.json({
      model: {
        name: mockActiveModel || 'mock-model',
        configuredContextSize: 8192,
        defaultContextSize: 8192,
        effectiveContextSize: 8192,
      },
      breakdown: {
        systemTokens: 312,
        transcriptTokens: 1234,
        chatHistoryTokens: 0,
        inputDraftTokens: 6,
      },
      reserved: { outputTokens: 1024 },
      totals: {
        promptTokens: 1552,
        percentUsed: 0.19,
        remainingForPrompt: 5616,
        remainingForOutput: 1024,
      },
      thresholds: { warnAt: 0.6, dangerAt: 0.85 },
    })
  ),

  // Streaming chat message endpoint. Emits a thinking status, two
  // visible chunks ("Hello " then "from the mock LLM"), then a done
  // event with completionTokens + duration so the bubble's tokens/s
  // metric renders. Sets X-User-Message-Id so the optimistic user
  // message gets reconciled by the client. Persists the user + AI
  // messages into mockChatMessages so a subsequent GET /chats/10
  // refetch (triggered by ChatInterface after the stream completes)
  // does not clobber the optimistic insert.
  http.post('/api/sessions/1/chats/10/messages', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as { text?: string };
    const userText = typeof body.text === 'string' ? body.text : '';

    const userMessageId = 100 + mockMessageCounter * 2;
    const aiMessageId = 101 + mockMessageCounter * 2;
    setMockMessageCounter(mockMessageCounter + 1);
    const timestamp = Date.now();

    const encoder = new TextEncoder();
    const sse = (payload: unknown) =>
      encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(sse({ status: 'thinking' }));
        controller.enqueue(sse({ status: 'responding' }));
        controller.enqueue(sse({ chunk: 'Hello ' }));
        controller.enqueue(sse({ chunk: 'from the mock LLM' }));
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

    appendMockChatMessages([
      {
        id: userMessageId,
        chatId: MOCK_CHAT_ID,
        sender: 'user',
        text: userText,
        timestamp,
      },
      {
        id: aiMessageId,
        chatId: MOCK_CHAT_ID,
        sender: 'ai',
        text: 'Hello from the mock LLM',
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

  // GET /api/sessions/:sessionId/chats/:chatId — used by the chat
  // panel when the user navigates between chats. Returns the
  // canned mock transcript from the existing chat spec handler when
  // chatId === 10, otherwise returns an empty chat.
  http.get('/api/sessions/:sessionId/chats/:chatId', ({ params }) => {
    const chatId = parseInt(params.chatId as string, 10);
    if (chatId === 10) {
      return HttpResponse.json({
        id: 10,
        sessionId: 1,
        timestamp: Date.parse('2026-06-23T12:30:00.000Z'),
        name: null,
        messages: mockChatMessages,
      });
    }
    return HttpResponse.json({
      id: chatId,
      sessionId: parseInt(params.sessionId as string, 10),
      timestamp: Date.now(),
      name: null,
      messages: [],
    });
  }),

  // Context-usage for any non-10 session chat (the chat-navigation
  // spec navigates to chat 11). Mirrors the canned chat-10 response
  // but with transcriptTokens=0 since the new chat has no transcript
  // grounded tokens yet.
  http.get('/api/sessions/:sessionId/chats/:chatId/context-usage', () =>
    HttpResponse.json({
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
        inputDraftTokens: 0,
      },
      reserved: { outputTokens: 1024 },
      totals: {
        promptTokens: 312,
        percentUsed: 0.04,
        remainingForPrompt: 6856,
        remainingForOutput: 1024,
      },
      thresholds: { warnAt: 0.6, dangerAt: 0.85 },
    })
  ),
];
