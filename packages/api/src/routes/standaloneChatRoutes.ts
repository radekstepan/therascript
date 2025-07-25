// packages/api/src/routes/standaloneChatRoutes.ts
import { Elysia, t, type Static, type Cookie } from 'elysia';
import { chatRepository } from '../repositories/chatRepository.js';
import { messageRepository } from '../repositories/messageRepository.js';
import {
  createStandaloneChat,
  listStandaloneChats,
  getStandaloneChatDetails,
  addStandaloneChatMessage,
  editStandaloneChatDetails,
  deleteStandaloneChat,
} from '../api/standaloneChatHandler.js';
import { NotFoundError, BadRequestError, ApiError } from '../errors.js';
import type {
  BackendChatSession,
  BackendChatMessage,
  ChatMetadata,
} from '../types/index.js';

// --- Schemas ---
const ChatIdParamSchema = t.Object({
  chatId: t.String({
    pattern: '^[0-9]+$',
    error: 'Chat ID must be a positive number',
  }),
});

const ChatMessageBodySchema = t.Object({
  text: t.String({ minLength: 1, error: 'Message text cannot be empty' }),
});
const ChatEditBodySchema = t.Object({
  name: t.Optional(t.Union([t.String({ minLength: 1 }), t.Null()])),
  tags: t.Optional(
    t.Union([t.Array(t.String({ minLength: 1, maxLength: 50 })), t.Null()])
  ),
});
const StandaloneChatMetadataResponseSchema = t.Object({
  id: t.Number(),
  sessionId: t.Null(),
  timestamp: t.Number(),
  name: t.Optional(t.Union([t.String(), t.Null()])),
  tags: t.Union([t.Array(t.String()), t.Null()]),
});
const StandaloneChatListResponseSchema = t.Array(
  StandaloneChatMetadataResponseSchema
);
const ChatMessageResponseSchema = t.Object({
  id: t.Number(),
  chatId: t.Number(),
  sender: t.Union([t.Literal('user'), t.Literal('ai')]),
  text: t.String(),
  timestamp: t.Number(),
  promptTokens: t.Optional(t.Union([t.Number(), t.Null()])),
  completionTokens: t.Optional(t.Union([t.Number(), t.Null()])),
});
const FullStandaloneChatResponseSchema = t.Intersect([
  StandaloneChatMetadataResponseSchema,
  t.Object({ messages: t.Array(ChatMessageResponseSchema) }),
]);
const DeleteChatResponseSchema = t.Object({ message: t.String() });

// --- Elysia Plugin ---
export const standaloneChatRoutes = new Elysia({ prefix: '/api/chats' })
  .model({
    chatIdParam: ChatIdParamSchema,
    chatMessageBody: ChatMessageBodySchema,
    chatEditBody: ChatEditBodySchema,
    standaloneChatMetadataResponse: StandaloneChatMetadataResponseSchema,
    standaloneChatListResponse: StandaloneChatListResponseSchema,
    fullStandaloneChatResponse: FullStandaloneChatResponseSchema,
    deleteChatResponse: DeleteChatResponseSchema,
    chatMessageResponse: ChatMessageResponseSchema,
  })
  .group('', { detail: { tags: ['Standalone Chat'] } }, (app) =>
    app
      .post('/', (context) => createStandaloneChat(context as any), {
        // Cast context if necessary
        response: { 201: 'standaloneChatMetadataResponse' },
        detail: { summary: 'Create a new standalone chat' },
      })
      .get('/', (context) => listStandaloneChats(context as any), {
        response: { 200: 'standaloneChatListResponse' },
        detail: { summary: 'List all standalone chats (metadata only)' },
      })
      .guard(
        { params: 'chatIdParam' }, // params.chatId will be a string
        (app) =>
          app
            .derive((context) => {
              // Elysia infers context
              const { params } = context;
              const chatIdNum = parseInt(params.chatId!, 10);
              if (isNaN(chatIdNum))
                throw new BadRequestError('Invalid chat ID format');
              const chat = chatRepository.findChatById(chatIdNum);
              if (!chat || chat.sessionId !== null) {
                // Must be standalone
                throw new NotFoundError(`Standalone Chat ${chatIdNum}`);
              }
              return { chatData: chat };
            })
            .get(
              '/:chatId',
              (context) => getStandaloneChatDetails(context as any),
              {
                response: { 200: 'fullStandaloneChatResponse' },
                detail: { summary: 'Get full details for a standalone chat' },
              }
            )
            .post(
              '/:chatId/messages',
              (context) => addStandaloneChatMessage(context as any),
              {
                body: 'chatMessageBody',
                detail: {
                  summary: 'Add message & get AI response (stream)',
                  produces: ['text/event-stream'],
                },
              }
            )
            .patch(
              '/:chatId/details',
              (context) => editStandaloneChatDetails(context as any),
              {
                body: 'chatEditBody',
                response: { 200: 'standaloneChatMetadataResponse' },
                detail: {
                  summary: 'Update name and tags for a standalone chat',
                },
              }
            )
            .delete(
              '/:chatId',
              (context) => deleteStandaloneChat(context as any),
              {
                response: { 200: 'deleteChatResponse' },
                detail: { summary: 'Delete a standalone chat' },
              }
            )
      )
  );
