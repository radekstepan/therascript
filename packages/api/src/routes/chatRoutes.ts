import { Elysia, t } from 'elysia';
import { chatRepository } from '../repositories/chatRepository.js';
import { sessionRepository } from '../repositories/sessionRepository.js';
import {
    createChat, addChatMessage, renameChat, deleteChat, getChatDetails
} from '../api/chatHandler.js';
import { NotFoundError, BadRequestError } from '../errors.js';

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
const ChatMessageResponseSchema = t.Object({
    id: t.Number(),
    chatId: t.Number(),
    sender: t.Union([t.Literal('user'), t.Literal('ai')]),
    text: t.String(),
    timestamp: t.Number()
});
const FullChatSessionResponseSchema = t.Intersect([
    ChatMetadataResponseSchema,
    t.Object({
        messages: t.Array(ChatMessageResponseSchema)
    })
]);
const AddMessageResponseSchema = t.Object({
    userMessage: ChatMessageResponseSchema,
    aiMessage: ChatMessageResponseSchema
});
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
        fullChatSessionResponse: FullChatSessionResponseSchema,
        addMessageResponse: AddMessageResponseSchema,
        deleteChatResponse: DeleteChatResponseSchema
    })
    // Apply session loading and tagging to all routes in this group
    .guard({ params: 'sessionIdParam' }, (app) => app
        // Make derive block async
        .derive(async ({ params }) => { // Added async
            const sessionId = parseInt(params.sessionId, 10);
            if (isNaN(sessionId)) throw new BadRequestError('Invalid session ID');
            // sessionRepository.findById is now async
            const session = await sessionRepository.findById(sessionId); // Added await
            if (!session) throw new NotFoundError(`Session with ID ${sessionId}`);
            // Return the resolved session
            return { sessionData: session };
        })
        .group('', { detail: { tags: ['Chat'] } }, (app) => app
            // POST /api/sessions/:sessionId/chats - Create a new chat
            // createChat handler is already marked async
            .post('/', createChat, {
                response: { 201: 'chatMetadataResponse' },
                detail: { summary: 'Create a new chat' }
            })

            // --- Routes requiring :chatId ---
            .guard({ params: 'sessionAndChatParams' }, (app) => app
                // Make derive block async
                .derive(async ({ params, sessionData }) => { // Added async
                    const chatId = parseInt(params.chatId, 10);
                    if (isNaN(chatId)) throw new BadRequestError('Invalid chat ID');
                    // chatRepository.findChatById is now async
                    const chat = await chatRepository.findChatById(chatId); // Added await
                    // Check the resolved chat object
                    if (!chat || chat.sessionId !== sessionData.id) {
                        // Access id on resolved sessionData
                        throw new NotFoundError(`Chat ${chatId} in session ${sessionData.id}`);
                    }
                    // Ensure messages are loaded if findChatById didn't guarantee it
                    // (Our current findChatById *does* include messages)
                    // Return the resolved chat object
                    return { chatData: chat };
                })

                // GET /:chatId - Get full chat details (including messages)
                // getChatDetails handler is synchronous, receives resolved chatData
                .get('/:chatId', getChatDetails, {
                    response: { 200: 'fullChatSessionResponse' },
                    detail: { summary: 'Get full details for a specific chat' }
                })

                // POST /:chatId/messages - Add message
                // addChatMessage handler is already marked async
                .post('/:chatId/messages', addChatMessage, {
                    body: 'chatMessageBody',
                    response: { 201: 'addMessageResponse' },
                    detail: { summary: 'Add user message & get AI response' }
                })

                // PATCH /:chatId/name - Rename chat
                // renameChat handler is already marked async
                .patch('/:chatId/name', renameChat, {
                    body: 'chatRenameBody',
                    response: { 200: 'chatMetadataResponse' },
                    detail: { summary: 'Rename a chat' }
                })

                 // DELETE /:chatId - Delete chat
                 // deleteChat handler is already marked async
                .delete('/:chatId', deleteChat, {
                     response: { 200: 'deleteChatResponse' },
                     detail: { summary: 'Delete a chat' }
                })
            )
        )
    );
    