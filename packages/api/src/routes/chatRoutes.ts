/* packages/api/src/routes/chatRoutes.ts */
import { Elysia, t } from 'elysia';
import { chatRepository } from '../repositories/chatRepository.js';
import { sessionRepository } from '../repositories/sessionRepository.js';
import {
    createChat, addChatMessage, renameChat, deleteChat, getChatDetails
} from '../api/chatHandler.js';
import { NotFoundError, BadRequestError } from '../errors.js';

// --- Schemas ---
const SessionIdParamSchema = t.Object({
    sessionId: t.String({ pattern: '^[0-9]+$', error: "Session ID must be a positive number" })
});
const ChatIdParamSchema = t.Object({
    chatId: t.String({ pattern: '^[0-9]+$', error: "Chat ID must be a positive number" })
});
const SessionAndChatParamsSchema = t.Intersect([SessionIdParamSchema, ChatIdParamSchema]);

const ChatMessageBodySchema = t.Object({
    text: t.String({ minLength: 1, error: "Message text cannot be empty" })
});
const ChatRenameBodySchema = t.Object({
    name: t.Optional(t.Union([t.String({ minLength: 1 }), t.Null()]))
});

const ChatMetadataResponseSchema = t.Object({
    id: t.Number(),
    sessionId: t.Number(),
    timestamp: t.Number(),
    name: t.Optional(t.Union([t.String(), t.Null()]))
});

// Base message schema (doesn't change)
const ChatMessageResponseSchema = t.Object({
    id: t.Number(),
    chatId: t.Number(),
    sender: t.Union([t.Literal('user'), t.Literal('ai')]),
    text: t.String(),
    timestamp: t.Number(),
    promptTokens: t.Optional(t.Union([t.Number(), t.Null()])),
    completionTokens: t.Optional(t.Union([t.Number(), t.Null()])),
});

// Full chat includes array of messages
const FullChatSessionResponseSchema = t.Intersect([
    ChatMetadataResponseSchema,
    t.Object({
        messages: t.Array(ChatMessageResponseSchema)
    })
]);

// Schema for the chat deletion response
const DeleteChatResponseSchema = t.Object({ message: t.String() });


// --- Elysia Plugin for Chat Routes ---
export const chatRoutes = new Elysia({ prefix: '/api/sessions/:sessionId/chats' })
    .model({
        sessionIdParam: SessionIdParamSchema,
        chatIdParam: ChatIdParamSchema,
        sessionAndChatParams: SessionAndChatParamsSchema,
        chatMessageBody: ChatMessageBodySchema,
        chatRenameBody: ChatRenameBodySchema,
        chatMetadataResponse: ChatMetadataResponseSchema,
        chatMessageResponse: ChatMessageResponseSchema,
        fullChatSessionResponse: FullChatSessionResponseSchema,
        deleteChatResponse: DeleteChatResponseSchema
    })
    // Apply session loading and tagging to all routes in this group
    .guard({ params: 'sessionIdParam' }, (app) => app
        .derive(({ params }) => { // Sync derive for session
            console.log(`[Derive Session] Received Session ID Param: ${params.sessionId}`); // Log Param
            const sessionId = parseInt(params.sessionId, 10);
            if (isNaN(sessionId)) throw new BadRequestError('Invalid session ID format');
            const session = sessionRepository.findById(sessionId); // Use sync version
            console.log(`[Derive Session] Found session? ${!!session}`); // Log Result
            if (!session) throw new NotFoundError(`Session with ID ${sessionId}`);
            return { sessionData: session };
        })
        .group('', { detail: { tags: ['Chat'] } }, (app) => app
            // POST /api/sessions/:sessionId/chats - Create a new chat
            .post('/', createChat, {
                response: { 201: 'chatMetadataResponse' },
                detail: { summary: 'Create a new chat' }
            })

            // --- Routes requiring :chatId ---
            .guard({ params: 'sessionAndChatParams' }, (app) => app
                .derive(({ params, sessionData }) => { // Sync derive for chat
                    console.log(`[Derive Chat] Received Chat ID Param: ${params.chatId} for Session ID: ${params.sessionId}`); // Log Param
                    const chatId = parseInt(params.chatId, 10);
                    if (isNaN(chatId)) throw new BadRequestError('Invalid chat ID format');
                    // chatRepository.findChatById is sync
                    const chat = chatRepository.findChatById(chatId);
                    console.log(`[Derive Chat] Found chat? ${!!chat}. Does it belong to session ${sessionData.id}? ${chat?.sessionId === sessionData.id}`); // Log Result
                    if (!chat || chat.sessionId !== sessionData.id) {
                        // Log specific reason for throwing NotFoundError
                        if(!chat) console.error(`[Derive Chat] Error: Chat ${chatId} not found.`);
                        else console.error(`[Derive Chat] Error: Chat ${chatId} found, but belongs to session ${chat.sessionId}, not ${sessionData.id}.`);
                        throw new NotFoundError(`Chat ${chatId} in session ${sessionData.id}`);
                    }
                    return { chatData: chat };
                })

                // GET /:chatId - Get full chat details (including messages)
                .get('/:chatId', getChatDetails, {
                    response: { 200: 'fullChatSessionResponse' },
                    detail: { summary: 'Get full details for a specific chat' }
                })

                // POST /:chatId/messages - Add message (Streaming)
                .post('/:chatId/messages', addChatMessage, {
                    body: 'chatMessageBody',
                    response: { /* No specific 200 body for stream */ },
                    detail: {
                        summary: 'Add user message & get AI response (stream)',
                        produces: ['text/event-stream'],
                    }
                })

                // PATCH /:chatId/name - Rename chat
                .patch('/:chatId/name', renameChat, {
                    body: 'chatRenameBody',
                    response: { 200: 'chatMetadataResponse' },
                    detail: { summary: 'Rename a chat' }
                })

                 // DELETE /:chatId - Delete chat
                 // Performs a hard delete of the chat and associated messages (via ON DELETE CASCADE)
                .delete('/:chatId', deleteChat, {
                     response: { 200: 'deleteChatResponse' },
                     detail: { summary: 'Delete a chat and its messages' }
                })
            )
        )
    );
