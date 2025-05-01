// =========================================
// File: packages/api/src/routes/chatRoutes.ts
// =========================================
/* packages/api/src/routes/chatRoutes.ts */
import { Elysia, t } from 'elysia';
import { chatRepository } from '../repositories/chatRepository.js';
import { messageRepository } from '../repositories/messageRepository.js'; // <-- Import Message Repo
import { sessionRepository } from '../repositories/sessionRepository.js';
import {
  createSessionChat,
  addSessionChatMessage,
  renameSessionChat,
  deleteSessionChat,
  getSessionChatDetails,
  updateSessionChatMessageStarStatus, // <-- Import star handler
} from '../api/sessionChatHandler.js'; // <-- Use session-specific handlers
import { NotFoundError, BadRequestError, ApiError } from '../errors.js';
import type {
  BackendChatSession,
  BackendChatMessage,
  ChatMetadata,
} from '../types/index.js'; // Import types

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
const MessageIdParamSchema = t.Object({
  messageId: t.String({
    pattern: '^[0-9]+$',
    error: 'Message ID must be a positive number',
  }),
});
const SessionAndChatParamsSchema = t.Intersect([
  SessionIdParamSchema,
  ChatIdParamSchema,
]); // Corrected Intersect usage
const SessionChatAndMessageParamsSchema = t.Intersect([
  SessionIdParamSchema,
  ChatIdParamSchema,
  MessageIdParamSchema,
]);

const ChatMessageBodySchema = t.Object({
  text: t.String({ minLength: 1, error: 'Message text cannot be empty' }),
});
const ChatRenameBodySchema = t.Object({
  name: t.Optional(t.Union([t.String({ minLength: 1 }), t.Null()])),
});
// --- New Schema for Star Update ---
const MessageStarUpdateBodySchema = t.Object({
  starred: t.Boolean({ error: "'starred' field (boolean) is required" }),
  starredName: t.Optional(t.Union([t.String({ minLength: 1 }), t.Null()])),
});

// Use specific type for Session Chat Metadata response
const SessionChatMetadataResponseSchema = t.Object({
  id: t.Number(),
  sessionId: t.Number(), // Session chats always have a non-null sessionId
  timestamp: t.Number(),
  name: t.Optional(t.Union([t.String(), t.Null()])),
});

// Updated message response schema to include starred fields
const ChatMessageResponseSchema = t.Object({
  id: t.Number(),
  chatId: t.Number(),
  sender: t.Union([t.Literal('user'), t.Literal('ai')]),
  text: t.String(),
  timestamp: t.Number(),
  promptTokens: t.Optional(t.Union([t.Number(), t.Null()])),
  completionTokens: t.Optional(t.Union([t.Number(), t.Null()])),
  starred: t.Boolean(), // <-- Changed to Boolean
  starredName: t.Optional(t.Union([t.String(), t.Null()])), // <-- Added
});

// Use specific type for Full Session Chat response
const FullSessionChatResponseSchema = t.Object({
  id: t.Number(),
  sessionId: t.Number(), // Must be number
  timestamp: t.Number(),
  name: t.Optional(t.Union([t.String(), t.Null()])),
  // Ensure messages is always an array in the response schema
  messages: t.Array(ChatMessageResponseSchema), // Uses updated message schema
});

const DeleteChatResponseSchema = t.Object({ message: t.String() });

// --- Elysia Plugin for Session Chat Routes ---
export const chatRoutes = new Elysia({
  prefix: '/api/sessions/:sessionId/chats',
})
  .model({
    // Keep existing model definitions
    sessionIdParam: SessionIdParamSchema,
    chatIdParam: ChatIdParamSchema,
    messageIdParam: MessageIdParamSchema, // New
    sessionAndChatParams: SessionAndChatParamsSchema, // Added combined schema
    sessionChatAndMessageParams: SessionChatAndMessageParamsSchema, // New
    chatMessageBody: ChatMessageBodySchema,
    chatRenameBody: ChatRenameBodySchema,
    messageStarUpdateBody: MessageStarUpdateBodySchema, // New
    sessionChatMetadataResponse: SessionChatMetadataResponseSchema, // Use specific schema name
    chatMessageResponse: ChatMessageResponseSchema, // Use updated schema
    fullSessionChatResponse: FullSessionChatResponseSchema, // Use updated schema
    deleteChatResponse: DeleteChatResponseSchema,
  })
  // Apply session loading and tagging to all routes in this group
  .guard(
    { params: 'sessionIdParam' },
    (app) =>
      app
        .derive(({ params }) => {
          console.log(
            `[Derive Session] Received Session ID Param: ${params.sessionId}`
          );
          const sessionId = parseInt(params.sessionId, 10);
          if (isNaN(sessionId))
            throw new BadRequestError('Invalid session ID format');
          const session = sessionRepository.findById(sessionId);
          console.log(`[Derive Session] Found session? ${!!session}`);
          if (!session) throw new NotFoundError(`Session with ID ${sessionId}`);
          return { sessionData: session };
        })
        .group(
          '',
          { detail: { tags: ['Chat'] } },
          (app) =>
            app
              // POST /api/sessions/:sessionId/chats - Create a new chat for this session
              .post('/', createSessionChat, {
                response: { 201: 'sessionChatMetadataResponse' }, // Use specific schema
                detail: { summary: 'Create a new chat within a session' },
              })

              // --- Routes requiring :chatId ---
              .guard(
                { params: 'sessionAndChatParams' },
                (app) =>
                  app // *** FIX: Use combined schema name ***
                    .derive(({ params, sessionData }) => {
                      console.log(
                        `[Derive Session Chat] Received Chat ID Param: ${params.chatId} for Session ID: ${params.sessionId}`
                      );
                      const chatId = parseInt(params.chatId, 10); // Now chatId is guaranteed
                      if (isNaN(chatId))
                        throw new BadRequestError('Invalid chat ID format');
                      const chat = chatRepository.findChatById(chatId);
                      console.log(
                        `[Derive Session Chat] Found chat? ${!!chat}. Does it belong to session ${sessionData.id}? ${chat?.sessionId === sessionData.id}`
                      );
                      // Ensure chat exists AND belongs to the correct session
                      if (!chat || chat.sessionId !== sessionData.id) {
                        if (!chat)
                          console.error(
                            `[Derive Session Chat] Error: Chat ${chatId} not found.`
                          );
                        else
                          console.error(
                            `[Derive Session Chat] Error: Chat ${chatId} found, but belongs to session ${chat.sessionId}, not ${sessionData.id}.`
                          );
                        throw new NotFoundError(
                          `Chat ${chatId} in session ${sessionData.id}`
                        );
                      }
                      return { chatData: chat };
                    })

                    // GET /:chatId - Get full session chat details
                    .get('/:chatId', getSessionChatDetails, {
                      response: { 200: 'fullSessionChatResponse' }, // Use specific schema
                      detail: {
                        summary: 'Get full details for a specific session chat',
                      },
                    })

                    // POST /:chatId/messages - Add message to session chat (Streaming)
                    .post('/:chatId/messages', addSessionChatMessage, {
                      body: 'chatMessageBody',
                      // No specific 200 body for stream, handler returns Response
                      detail: {
                        summary:
                          'Add user message & get AI response for session chat (stream)',
                        produces: ['text/event-stream'],
                      },
                    })

                    // PATCH /:chatId/name - Rename session chat
                    .patch('/:chatId/name', renameSessionChat, {
                      body: 'chatRenameBody',
                      response: { 200: 'sessionChatMetadataResponse' }, // Use specific schema
                      detail: { summary: 'Rename a session chat' },
                    })

                    // DELETE /:chatId - Delete session chat
                    .delete('/:chatId', deleteSessionChat, {
                      response: { 200: 'deleteChatResponse' },
                      detail: {
                        summary: 'Delete a session chat and its messages',
                      },
                    })

                    // --- Routes requiring :messageId ---
                    .guard({ params: 'sessionChatAndMessageParams' }, (app) =>
                      app // Nested guard for message ID
                        .derive(({ params, chatData }) => {
                          console.log(
                            `[Derive Session Message] Received Message ID Param: ${params.messageId} for Chat ID: ${params.chatId}`
                          );
                          const messageId = parseInt(params.messageId, 10);
                          if (isNaN(messageId))
                            throw new BadRequestError(
                              'Invalid message ID format'
                            );
                          // Use the messageRepository function here
                          const message =
                            messageRepository.findMessageById(messageId);
                          console.log(
                            `[Derive Session Message] Found message? ${!!message}. Does it belong to chat ${chatData.id}? ${message?.chatId === chatData.id}`
                          );
                          if (!message || message.chatId !== chatData.id) {
                            if (!message)
                              console.error(
                                `[Derive Session Message] Error: Message ${messageId} not found.`
                              );
                            else
                              console.error(
                                `[Derive Session Message] Error: Message ${messageId} found, but belongs to chat ${message.chatId}, not ${chatData.id}.`
                              );
                            throw new NotFoundError(
                              `Message ${messageId} in chat ${chatData.id}`
                            );
                          }
                          return { messageData: message };
                        })
                        // PATCH /:chatId/messages/:messageId - Update message star status
                        .patch(
                          '/:chatId/messages/:messageId',
                          updateSessionChatMessageStarStatus,
                          {
                            body: 'messageStarUpdateBody',
                            response: { 200: 'chatMessageResponse' }, // Return the updated message
                            detail: {
                              summary: 'Update star status/name for a message',
                            },
                          }
                        )
                    ) // End message guard
              ) // End chat guard
        ) // End /chats group
  ); // End initial guard
