import { Elysia, t } from 'elysia';
import { chatRepository } from '../repositories/chatRepository.js';
import {
    createStandaloneChat, listStandaloneChats, getStandaloneChatDetails,
    addStandaloneChatMessage, renameStandaloneChat, deleteStandaloneChat,
    updateStandaloneChatMessageStarStatus // <-- Import star handler
} from '../api/standaloneChatHandler.js'; // <-- Import standalone handlers
import { NotFoundError, BadRequestError, ApiError } from '../errors.js';
import type { BackendChatSession, BackendChatMessage, ChatMetadata } from '../types/index.js'; // Import types


// --- Schemas ---
const ChatIdParamSchema = t.Object({
    chatId: t.String({ pattern: '^[0-9]+$', error: "Chat ID must be a positive number" })
});
const MessageIdParamSchema = t.Object({ // New
    messageId: t.String({ pattern: '^[0-9]+$', error: "Message ID must be a positive number" })
});
const ChatAndMessageParamsSchema = t.Intersect([ChatIdParamSchema, MessageIdParamSchema]); // New

const ChatMessageBodySchema = t.Object({
    text: t.String({ minLength: 1, error: "Message text cannot be empty" })
});
const ChatRenameBodySchema = t.Object({
    name: t.Optional(t.Union([t.String({ minLength: 1 }), t.Null()]))
});
// --- New Schema for Star Update ---
const MessageStarUpdateBodySchema = t.Object({
    starred: t.Boolean({ error: "'starred' field (boolean) is required" }),
    starredName: t.Optional(t.Union([t.String({ minLength: 1 }), t.Null()]))
});

// Standalone chat metadata has sessionId as null
const StandaloneChatMetadataResponseSchema = t.Object({
    id: t.Number(),
    sessionId: t.Null(), // Explicitly null for standalone
    timestamp: t.Number(),
    name: t.Optional(t.Union([t.String(), t.Null()]))
});

const StandaloneChatListResponseSchema = t.Array(StandaloneChatMetadataResponseSchema);

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
    starredName: t.Optional(t.Union([t.String(), t.Null()])) // <-- Added
});

// Corrected FullStandaloneChatResponseSchema to ensure sessionId is null and messages is always an array
const FullStandaloneChatResponseSchema = t.Intersect([
    StandaloneChatMetadataResponseSchema, // Use the metadata schema which enforces sessionId: null
    t.Object({
        // Ensure messages is always an array in the response schema
        messages: t.Array(ChatMessageResponseSchema) // Uses updated message schema
    })
]);

const DeleteChatResponseSchema = t.Object({ message: t.String() });


// --- Elysia Plugin for Standalone Chat Routes ---
export const standaloneChatRoutes = new Elysia({ prefix: '/api/chats' })
    .model({
        chatIdParam: ChatIdParamSchema,
        messageIdParam: MessageIdParamSchema, // New
        chatAndMessageParams: ChatAndMessageParamsSchema, // New
        chatMessageBody: ChatMessageBodySchema,
        chatRenameBody: ChatRenameBodySchema,
        messageStarUpdateBody: MessageStarUpdateBodySchema, // New
        standaloneChatMetadataResponse: StandaloneChatMetadataResponseSchema,
        standaloneChatListResponse: StandaloneChatListResponseSchema,
        fullStandaloneChatResponse: FullStandaloneChatResponseSchema, // Use corrected schema
        deleteChatResponse: DeleteChatResponseSchema,
        chatMessageResponse: ChatMessageResponseSchema // Added for star update response
    })
    .group('', { detail: { tags: ['Standalone Chat'] } }, (app) => app
        // POST /api/chats - Create a new standalone chat
        .post('/', createStandaloneChat, {
            response: { 201: 'standaloneChatMetadataResponse' },
            detail: { summary: 'Create a new standalone chat' }
        })

        // GET /api/chats - List all standalone chats (metadata only)
        .get('/', listStandaloneChats, {
            response: { 200: 'standaloneChatListResponse' },
            detail: { summary: 'List all standalone chats (metadata only)' }
        })

        // --- Routes requiring :chatId for standalone chats ---
        .guard({ params: 'chatIdParam' }, (app) => app
            .derive(({ params }) => { // Ensure chat exists and IS standalone
                console.log(`[Derive Standalone Chat] Received Chat ID Param: ${params.chatId}`);
                const chatId = parseInt(params.chatId, 10);
                if (isNaN(chatId)) throw new BadRequestError('Invalid chat ID format');
                const chat = chatRepository.findChatById(chatId);
                console.log(`[Derive Standalone Chat] Found chat? ${!!chat}. Is it standalone? ${chat?.sessionId === null}`);
                // Ensure chat exists AND is standalone (sessionId is NULL)
                if (!chat || chat.sessionId !== null) {
                     if (!chat) console.error(`[Derive Standalone Chat] Error: Chat ${chatId} not found.`);
                     else console.error(`[Derive Standalone Chat] Error: Chat ${chatId} found, but belongs to session ${chat.sessionId}.`);
                    throw new NotFoundError(`Standalone Chat ${chatId}`);
                }
                return { chatData: chat };
            })

            // GET /:chatId - Get full standalone chat details
            .get('/:chatId', getStandaloneChatDetails, {
                response: { 200: 'fullStandaloneChatResponse' }, // Use corrected schema
                detail: { summary: 'Get full details for a specific standalone chat' }
            })

            // POST /:chatId/messages - Add message to standalone chat (Streaming)
            .post('/:chatId/messages', addStandaloneChatMessage, {
                body: 'chatMessageBody',
                // No specific 200 body for stream, handler returns Response
                detail: {
                    summary: 'Add user message & get AI response for standalone chat (stream)',
                    produces: ['text/event-stream'],
                }
            })

            // PATCH /:chatId/name - Rename standalone chat
            .patch('/:chatId/name', renameStandaloneChat, {
                body: 'chatRenameBody',
                response: { 200: 'standaloneChatMetadataResponse' }, // Use correct schema
                detail: { summary: 'Rename a standalone chat' }
            })

            // DELETE /:chatId - Delete standalone chat
            .delete('/:chatId', deleteStandaloneChat, {
                 response: { 200: 'deleteChatResponse' },
                 detail: { summary: 'Delete a standalone chat and its messages' }
            })

            // --- Routes requiring :messageId ---
            .guard({ params: 'chatAndMessageParams' }, (app) => app // Nested guard for message ID
                .derive(({ params, chatData }) => {
                    console.log(`[Derive Standalone Message] Received Message ID Param: ${params.messageId} for Chat ID: ${params.chatId}`);
                    const messageId = parseInt(params.messageId, 10);
                    if (isNaN(messageId)) throw new BadRequestError('Invalid message ID format');
                    const message = chatRepository.findMessageById(messageId);
                    console.log(`[Derive Standalone Message] Found message? ${!!message}. Does it belong to chat ${chatData.id}? ${message?.chatId === chatData.id}`);
                    if (!message || message.chatId !== chatData.id) {
                        if (!message) console.error(`[Derive Standalone Message] Error: Message ${messageId} not found.`);
                        else console.error(`[Derive Standalone Message] Error: Message ${messageId} found, but belongs to chat ${message.chatId}, not ${chatData.id}.`);
                        throw new NotFoundError(`Message ${messageId} in chat ${chatData.id}`);
                    }
                    return { messageData: message };
                })
                 // PATCH /:chatId/messages/:messageId - Update message star status
                .patch('/:chatId/messages/:messageId', updateStandaloneChatMessageStarStatus, {
                    body: 'messageStarUpdateBody',
                    response: { 200: 'chatMessageResponse' }, // Return the updated message
                    detail: { summary: 'Update star status/name for a standalone chat message' }
                })
            ) // End message guard
        ) // End chat guard
    ); // End main group
