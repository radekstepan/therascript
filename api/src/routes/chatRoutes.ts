import { Elysia, t } from 'elysia';
import { chatRepository } from '../repositories/chatRepository.js';
import { sessionRepository } from '../repositories/sessionRepository.js';
import {
    createChat, addChatMessage, renameChat, deleteChat, getChatDetails
} from '../api/chatHandler.js';
import { NotFoundError } from '../errors.js';

const SessionIdParamSchema = t.Object({ sessionId: t.Numeric({ minimum: 1 }) });
const ChatIdParamSchema = t.Object({ chatId: t.Numeric({ minimum: 1 }) });
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
        .derive(({ params }) => {
            const session = sessionRepository.findById(params.sessionId);
            if (!session) throw new NotFoundError(`Session with ID ${params.sessionId}`);
            return { sessionData: session };
        })
        .group('', { detail: { tags: ['Chat'] } }, (app) => app
            // POST /api/sessions/:sessionId/chats - Create a new chat
            .post('/', createChat, {
                response: { 201: 'chatMetadataResponse' },
                detail: { summary: 'Create a new chat' }
            })

            // --- Routes requiring :chatId ---
            .guard({ params: 'chatIdParam' }, (app) => app
                .derive(({ params, sessionData }) => {
                    const chat = chatRepository.findChatById(params.chatId);
                    if (!chat || chat.sessionId !== sessionData.id) {
                        throw new NotFoundError(`Chat ${params.chatId} in session ${sessionData.id}`);
                    }
                    // Ensure messages are loaded if findChatById didn't guarantee it
                    // (Our current findChatById *does* include messages)
                    return { chatData: chat };
                })

                // GET /:chatId - Get full chat details (including messages)
                .get('/:chatId', getChatDetails, {
                    response: { 200: 'fullChatSessionResponse' },
                    detail: { summary: 'Get full details for a specific chat' }
                })

                // POST /:chatId/messages - Add message
                .post('/:chatId/messages', addChatMessage, {
                    body: 'chatMessageBody',
                    response: { 201: 'addMessageResponse' },
                    detail: { summary: 'Add user message & get AI response' }
                })

                // PATCH /:chatId/name - Rename chat
                .patch('/:chatId/name', renameChat, {
                    body: 'chatRenameBody',
                    response: { 200: 'chatMetadataResponse' },
                    detail: { summary: 'Rename a chat' }
                })

                 // DELETE /:chatId - Delete chat
                .delete('/:chatId', deleteChat, {
                     response: { 200: 'deleteChatResponse' },
                     detail: { summary: 'Delete a chat' }
                })
            )
        )
    );
    