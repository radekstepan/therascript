// packages/api/src/routes/chatRoutes.ts
import { Elysia, t, type Static, type Cookie } from 'elysia';
import { chatRepository } from '../repositories/chatRepository.js';
import { messageRepository } from '../repositories/messageRepository.js';
import { sessionRepository } from '../repositories/sessionRepository.js';
import {
  createSessionChat,
  addSessionChatMessage,
  renameSessionChat,
  deleteSessionChat,
  getSessionChatDetails,
} from '../api/sessionChatHandler.js';
import { NotFoundError, BadRequestError, ApiError } from '../errors.js';
import type {
  BackendChatSession,
  BackendChatMessage,
  ChatMetadata,
  BackendSession,
} from '../types/index.js'; // Added BackendChatSession
import { computeContextUsageForChat } from '../services/contextUsageService.js';

// --- Schemas ---
const SessionIdParamSchema = t.Object({
  sessionId: t.String({
    pattern: '^[0-9]+$',
    error: 'Session ID must be a positive number',
  }),
});

const ChatIdParamSchema = t.Object({
  chatId: t.String({
    pattern: '^[0-9]+$',
    error: 'Chat ID must be a positive number',
  }),
});

const SessionAndChatParamsSchema = t.Intersect([
  SessionIdParamSchema,
  ChatIdParamSchema,
]);

const ChatMessageBodySchema = t.Object({
  text: t.String({ minLength: 1, error: 'Message text cannot be empty' }),
});

const ChatRenameBodySchema = t.Object({
  name: t.Optional(t.Union([t.String({ minLength: 1 }), t.Null()])),
});

const SessionChatMetadataResponseSchema = t.Object({
  id: t.Number(),
  sessionId: t.Number(),
  timestamp: t.Number(),
  name: t.Optional(t.Union([t.String(), t.Null()])),
});

const ChatMessageResponseSchema = t.Object({
  id: t.Number(),
  chatId: t.Number(),
  sender: t.Union([t.Literal('user'), t.Literal('ai'), t.Literal('system')]), // <-- THE FIX IS HERE
  text: t.String(),
  timestamp: t.Number(),
  promptTokens: t.Optional(t.Union([t.Number(), t.Null()])),
  completionTokens: t.Optional(t.Union([t.Number(), t.Null()])),
});

const FullSessionChatResponseSchema = t.Object({
  id: t.Number(),
  sessionId: t.Number(),
  timestamp: t.Number(),
  name: t.Optional(t.Union([t.String(), t.Null()])),
  messages: t.Array(ChatMessageResponseSchema),
});

const DeleteChatResponseSchema = t.Object({ message: t.String() });

// --- NEW: Context Usage Schemas ---
const NullableNumber = t.Union([t.Number(), t.Null()]);
const ContextUsageResponseSchema = t.Object({
  model: t.Object({
    name: t.String(),
    configuredContextSize: t.Optional(NullableNumber),
    defaultContextSize: t.Optional(NullableNumber),
    effectiveContextSize: t.Optional(NullableNumber),
  }),
  breakdown: t.Object({
    systemTokens: NullableNumber,
    transcriptTokens: NullableNumber,
    chatHistoryTokens: NullableNumber,
    inputDraftTokens: NullableNumber,
  }),
  reserved: t.Object({ outputTokens: t.Number() }),
  totals: t.Object({
    promptTokens: NullableNumber,
    percentUsed: NullableNumber,
    remainingForPrompt: NullableNumber,
    remainingForOutput: NullableNumber,
  }),
  thresholds: t.Object({ warnAt: t.Number(), dangerAt: t.Number() }),
});

export const chatRoutes = new Elysia({
  prefix: '/api/sessions/:sessionId/chats',
})
  .model({
    sessionIdParam: SessionIdParamSchema,
    chatIdParam: ChatIdParamSchema,
    sessionAndChatParams: SessionAndChatParamsSchema,
    chatMessageBody: ChatMessageBodySchema,
    chatRenameBody: ChatRenameBodySchema,
    sessionChatMetadataResponse: SessionChatMetadataResponseSchema,
    chatMessageResponse: ChatMessageResponseSchema,
    fullSessionChatResponse: FullSessionChatResponseSchema,
    deleteChatResponse: DeleteChatResponseSchema,
    contextUsageResponse: ContextUsageResponseSchema,
  })
  .guard(
    { params: 'sessionIdParam' }, // Ensures params.sessionId is a string and matches pattern
    (app) =>
      app
        // Derive sessionData for all routes within this guard
        .derive((context) => {
          // Elysia infers context type
          const { params } = context;
          // params.sessionId is guaranteed to be a string by the guard's schema
          const sessionIdNum = parseInt(params.sessionId!, 10);
          if (isNaN(sessionIdNum)) {
            // This case should technically be caught by the param schema regex, but defense in depth
            throw new BadRequestError('Invalid session ID format in path.');
          }
          const session = sessionRepository.findById(sessionIdNum);
          if (!session) {
            throw new NotFoundError(`Session with ID ${sessionIdNum}`);
          }
          return { sessionData: session }; // Adds sessionData to the context
        })
        .group(
          '', // No additional prefix for this group
          { detail: { tags: ['Chat'] } },
          (app) =>
            app
              .post('/', (context) => createSessionChat(context as any), {
                // Using 'as any' for context, relying on Elysia's inference
                response: { 201: 'sessionChatMetadataResponse' },
                detail: { summary: 'Create a new chat within a session' },
              })
              .guard(
                { params: 'sessionAndChatParams' }, // Ensures params.sessionId and params.chatId are strings
                (app) =>
                  app
                    .derive((context) => {
                      // Elysia infers context
                      const { params, sessionData } = context; // sessionData comes from the outer derive
                      const chatIdNum = parseInt(params.chatId!, 10);
                      if (isNaN(chatIdNum)) {
                        throw new BadRequestError(
                          'Invalid chat ID format in path.'
                        );
                      }
                      const chat = chatRepository.findChatById(chatIdNum);
                      if (!chat || chat.sessionId !== sessionData.id) {
                        throw new NotFoundError(
                          `Chat ${chatIdNum} not found in session ${sessionData.id}`
                        );
                      }
                      return { chatData: chat }; // Adds chatData to the context
                    })
                    .get(
                      '/:chatId',
                      (context) => getSessionChatDetails(context as any),
                      {
                        response: { 200: 'fullSessionChatResponse' },
                        detail: {
                          summary:
                            'Get full details for a specific session chat',
                        },
                      }
                    )
                    .get(
                      '/:chatId/context-usage',
                      async (context) => {
                        const { chatData, sessionData, query } = context as any;
                        const inputDraft = query?.inputDraft ?? null;
                        const reservedOutputTokens = query?.reservedOutputTokens
                          ? parseInt(String(query.reservedOutputTokens), 10)
                          : undefined;
                        const messages = chatData
                          ? (chatData.messages as BackendChatMessage[])
                          : [];
                        const usage = await computeContextUsageForChat({
                          isStandalone: false,
                          sessionData,
                          messages,
                          inputDraft,
                          reservedOutputTokens,
                        });
                        return usage;
                      },
                      {
                        query: t.Optional(
                          t.Object({
                            inputDraft: t.Optional(t.String()),
                            reservedOutputTokens: t.Optional(t.String()),
                          })
                        ),
                        response: { 200: 'contextUsageResponse' },
                        detail: {
                          summary:
                            'Estimate context usage for this session chat (LM Studio–style)',
                        },
                      }
                    )
                    .post(
                      '/:chatId/messages',
                      (context) => addSessionChatMessage(context as any),
                      {
                        body: 'chatMessageBody',
                        detail: {
                          summary:
                            'Add user message & get AI response for session chat (stream)',
                          produces: ['text/event-stream'],
                        },
                      }
                    )
                    .patch(
                      '/:chatId/name',
                      (context) => renameSessionChat(context as any),
                      {
                        body: 'chatRenameBody',
                        response: { 200: 'sessionChatMetadataResponse' },
                        detail: { summary: 'Rename a session chat' },
                      }
                    )
                    .delete(
                      '/:chatId',
                      (context) => deleteSessionChat(context as any),
                      {
                        response: { 200: 'deleteChatResponse' },
                        detail: {
                          summary: 'Delete a session chat and its messages',
                        },
                      }
                    )
              ) // End chat-specific guard
        ) // End group for /api/sessions/:sessionId/chats
  ); // End sessionID guard
