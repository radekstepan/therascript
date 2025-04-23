import { Elysia, t } from 'elysia';
import { chatRepository } from '../repositories/chatRepository.js';
import {
    createStandaloneChat, listStandaloneChats, getStandaloneChatDetails,
    addStandaloneChatMessage, renameStandaloneChat, deleteStandaloneChat
} from '../api/chatHandler.js'; // Import standalone handlers
import { NotFoundError, BadRequestError } from '../errors.js';
import type { BackendChatSession, BackendChatMessage, ChatMetadata } from '../types/index.js'; // Import types


// --- Schemas ---
const ChatIdParamSchema = t.Object({
    chatId: t.String({ pattern: '^[0-9]+$', error: "Chat ID must be a positive number" })
});
const ChatMessageBodySchema = t.Object({
    text: t.String({ minLength: 1, error: "Message text cannot be empty" })
});
const ChatRenameBodySchema = t.Object({
    name: t.Optional(t.Union([t.String({ minLength: 1 }), t.Null()]))
});

// Standalone chat metadata has sessionId as null
const StandaloneChatMetadataResponseSchema = t.Object({
    id: t.Number(),
    sessionId: t.Null(), // Explicitly null for standalone
    timestamp: t.Number(),
    name: t.Optional(t.Union([t.String(), t.Null()]))
});

const StandaloneChatListResponseSchema = t.Array(StandaloneChatMetadataResponseSchema);

// Full standalone chat includes messages
const ChatMessageResponseSchema = t.Object({ // Assume same structure
    id: t.Number(),
    chatId: t.Number(),
    sender: t.Union([t.Literal('user'), t.Literal('ai')]),
    text: t.String(),
    timestamp: t.Number(),
    promptTokens: t.Optional(t.Union([t.Number(), t.Null()])),
    completionTokens: t.Optional(t.Union([t.Number(), t.Null()])),
});

// Corrected FullStandaloneChatResponseSchema to ensure sessionId is null and messages is always an array
const FullStandaloneChatResponseSchema = t.Intersect([
    StandaloneChatMetadataResponseSchema, // Use the metadata schema which enforces sessionId: null
    t.Object({
        // Ensure messages is always an array in the response schema
        messages: t.Array(ChatMessageResponseSchema)
    })
]);

const DeleteChatResponseSchema = t.Object({ message: t.String() });


// --- Elysia Plugin for Standalone Chat Routes ---
export const standaloneChatRoutes = new Elysia({ prefix: '/api/chats' })
    .model({
        chatIdParam: ChatIdParamSchema,
        chatMessageBody: ChatMessageBodySchema,
        chatRenameBody: ChatRenameBodySchema,
        standaloneChatMetadataResponse: StandaloneChatMetadataResponseSchema,
        standaloneChatListResponse: StandaloneChatListResponseSchema,
        fullStandaloneChatResponse: FullStandaloneChatResponseSchema, // Use corrected schema
        deleteChatResponse: DeleteChatResponseSchema
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
        )
    );
