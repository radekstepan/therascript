// =========================================
// File: packages/api/src/routes/standaloneChatRoutes.ts
// =========================================
/* packages/api/src/routes/standaloneChatRoutes.ts */
import { Elysia, t } from 'elysia';
import { chatRepository } from '../repositories/chatRepository.js'; // Correct import
import { messageRepository } from '../repositories/messageRepository.js'; // <-- Import Message Repo
import {
  createStandaloneChat,
  listStandaloneChats,
  getStandaloneChatDetails,
  addStandaloneChatMessage,
  editStandaloneChatDetails, // Use renamed edit handler
  deleteStandaloneChat,
  updateStandaloneChatMessageStarStatus,
} from '../api/standaloneChatHandler.js';
import { NotFoundError, BadRequestError, ApiError } from '../errors.js';
import type { ChatMetadata } from '../types/index.js';

// --- Schemas (Updated) ---
const ChatIdParamSchema = t.Object({
  chatId: t.String({
    pattern: '^[0-9]+$',
    error: 'Chat ID must be a positive number',
  }),
});
const MessageIdParamSchema = t.Object({
  messageId: t.String({
    pattern: '^[0-9]+$',
    error: 'Message ID must be a positive number',
  }),
});
const ChatAndMessageParamsSchema = t.Intersect([
  ChatIdParamSchema,
  MessageIdParamSchema,
]);
const ChatMessageBodySchema = t.Object({
  text: t.String({ minLength: 1, error: 'Message text cannot be empty' }),
});
const ChatEditBodySchema = t.Object({
  name: t.Optional(t.Union([t.String({ minLength: 1 }), t.Null()])),
  tags: t.Optional(
    t.Union([t.Array(t.String({ minLength: 1, maxLength: 50 })), t.Null()])
  ),
});
const MessageStarUpdateBodySchema = t.Object({
  starred: t.Boolean({ error: "'starred' field required" }),
  starredName: t.Optional(t.Union([t.String({ minLength: 1 }), t.Null()])),
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
  starred: t.Boolean(),
  starredName: t.Optional(t.Union([t.String(), t.Null()])),
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
    messageIdParam: MessageIdParamSchema,
    chatAndMessageParams: ChatAndMessageParamsSchema,
    chatMessageBody: ChatMessageBodySchema,
    chatEditBody: ChatEditBodySchema,
    messageStarUpdateBody: MessageStarUpdateBodySchema,
    standaloneChatMetadataResponse: StandaloneChatMetadataResponseSchema,
    standaloneChatListResponse: StandaloneChatListResponseSchema,
    fullStandaloneChatResponse: FullStandaloneChatResponseSchema,
    deleteChatResponse: DeleteChatResponseSchema,
    chatMessageResponse: ChatMessageResponseSchema,
  })
  .group(
    '',
    { detail: { tags: ['Standalone Chat'] } },
    (app) =>
      app
        .post('/', createStandaloneChat, {
          response: { 201: 'standaloneChatMetadataResponse' },
          detail: { summary: 'Create a new standalone chat' },
        })
        .get('/', listStandaloneChats, {
          response: { 200: 'standaloneChatListResponse' },
          detail: { summary: 'List all standalone chats (metadata only)' },
        })
        .guard(
          { params: 'chatIdParam' },
          (app) =>
            app
              // --- FIX: Use chatRepository.findChatById ---
              .derive(({ params }) => {
                const chatId = parseInt(params.chatId, 10);
                if (isNaN(chatId))
                  throw new BadRequestError('Invalid chat ID format');
                // Use the correct exported function here
                const chat = chatRepository.findChatById(chatId);
                if (!chat || chat.sessionId !== null) {
                  throw new NotFoundError(`Standalone Chat ${chatId}`);
                }
                return { chatData: chat };
              })
              // --- END FIX ---
              .get('/:chatId', getStandaloneChatDetails, {
                response: { 200: 'fullStandaloneChatResponse' },
                detail: { summary: 'Get full details for a standalone chat' },
              })
              .post('/:chatId/messages', addStandaloneChatMessage, {
                body: 'chatMessageBody',
                detail: {
                  summary: 'Add message & get AI response (stream)',
                  produces: ['text/event-stream'],
                },
              })
              .patch('/:chatId/details', editStandaloneChatDetails, {
                body: 'chatEditBody',
                response: { 200: 'standaloneChatMetadataResponse' },
                detail: {
                  summary: 'Update name and tags for a standalone chat',
                },
              })
              .delete('/:chatId', deleteStandaloneChat, {
                response: { 200: 'deleteChatResponse' },
                detail: { summary: 'Delete a standalone chat' },
              })
              .guard({ params: 'chatAndMessageParams' }, (app) =>
                app
                  .derive(({ params, chatData }) => {
                    const messageId = parseInt(params.messageId, 10);
                    if (isNaN(messageId))
                      throw new BadRequestError('Invalid msg ID');
                    // Use the messageRepository function here
                    const message =
                      messageRepository.findMessageById(messageId);
                    if (!message || message.chatId !== chatData.id) {
                      throw new NotFoundError(
                        `Message ${messageId} in chat ${chatData.id}`
                      );
                    }
                    return { messageData: message };
                  })
                  .patch(
                    '/:chatId/messages/:messageId',
                    updateStandaloneChatMessageStarStatus,
                    {
                      body: 'messageStarUpdateBody',
                      response: { 200: 'chatMessageResponse' },
                      detail: {
                        summary: 'Update star status/name for a message',
                      },
                    }
                  )
              ) // End message guard
        ) // End chat guard
  ); // End main group
