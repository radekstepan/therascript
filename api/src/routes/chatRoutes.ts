// src/routes/chatRoutes.ts
import { Elysia, t, type Static } from 'elysia';
import { swagger } from '@elysiajs/swagger';
import { chatRepository } from '../repositories/chatRepository.js'; // ADDED .js
import { sessionRepository } from '../repositories/sessionRepository.js'; // ADDED .js
import { loadTranscriptContent } from '../services/fileService.js'; // ADDED .js
import { generateChatResponse } from '../services/ollamaService.js'; // ADDED .js
import { NotFoundError, BadRequestError, InternalServerError } from '../errors.js'; // ADDED .js
import type { BackendSession, BackendChatSession, BackendChatMessage } from '../types/index.js'; // ADDED .js

// --- Define TypeBox Schemas ---
const SessionIdParamSchema = t.Object({ sessionId: t.Numeric({ minimum: 1 }) });
const ChatIdParamSchema = t.Object({ chatId: t.Numeric({ minimum: 1 }) });
const SessionAndChatParamsSchema = t.Intersect([SessionIdParamSchema, ChatIdParamSchema]);

const ChatMessageBodySchema = t.Object({
    text: t.String({ minLength: 1, error: "Message text cannot be empty" })
});
const ChatRenameBodySchema = t.Object({
    name: t.Optional(t.Union([t.String({ minLength: 1 }), t.Null()]))
});

// Response Schemas
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
const AddMessageResponseSchema = t.Object({
    userMessage: ChatMessageResponseSchema,
    aiMessage: ChatMessageResponseSchema
});
const DeleteChatResponseSchema = t.Object({ message: t.String() });


// --- Elysia Plugin for Chat Routes ---
export const chatRoutes = new Elysia({ prefix: '/api/sessions/:sessionId/chats' })
    .model({ // Define models for reuse
        sessionIdParam: SessionIdParamSchema,
        chatIdParam: ChatIdParamSchema,
        sessionAndChatParams: SessionAndChatParamsSchema,
        chatMessageBody: ChatMessageBodySchema,
        chatRenameBody: ChatRenameBodySchema,
        chatMetadataResponse: ChatMetadataResponseSchema,
        addMessageResponse: AddMessageResponseSchema,
        deleteChatResponse: DeleteChatResponseSchema
    })
    // Apply session loading and tagging to all routes in this group
    .guard({ params: 'sessionIdParam' }, (app) => app
        .derive(({ params }) => { // Load session for all chat routes
            const session = sessionRepository.findById(params.sessionId);
            if (!session) throw new NotFoundError(`Session with ID ${params.sessionId}`);
            return { sessionData: session };
        })
        .group('', { detail: { tags: ['Chat'] } }, (app) => app
            // POST /api/sessions/:sessionId/chats - Create a new chat
            .post('/', ({ sessionData, set }) => {
                const newChat = chatRepository.createChat(sessionData.id);
                const { messages, ...chatMetadata } = newChat;
                set.status = 201;
                return chatMetadata;
            }, {
                response: { 201: 'chatMetadataResponse' }, // Reference model name
                detail: { summary: 'Create a new chat' }
            })

            // --- Routes requiring :chatId ---
            .guard({ params: 'chatIdParam' }, (app) => app // Guard for chat-specific routes
                .derive(({ params, sessionData }) => { // Load chat data
                    const chat = chatRepository.findChatById(params.chatId);
                    if (!chat || chat.sessionId !== sessionData.id) {
                        throw new NotFoundError(`Chat ${params.chatId} in session ${sessionData.id}`);
                    }
                    return { chatData: chat };
                })

                // POST /:chatId/messages - Add message
                .post('/:chatId/messages', async ({ sessionData, chatData, body, set }) => {
                     const userMessage = chatRepository.addMessage(chatData.id, 'user', body.text);
                     const transcriptContent = await loadTranscriptContent(sessionData.id);
                     if (transcriptContent === null || transcriptContent === undefined) throw new InternalServerError(`Transcript ${sessionData.id} missing.`);
                     const currentMessages = chatRepository.findMessagesByChatId(chatData.id);
                     if (currentMessages.length === 0) throw new InternalServerError(`Chat ${chatData.id} inconsistency.`);
                     const aiResponseText = await generateChatResponse(transcriptContent, currentMessages);
                     const aiMessage = chatRepository.addMessage(chatData.id, 'ai', aiResponseText);
                     set.status = 201;
                     return { userMessage, aiMessage };
                }, {
                    body: 'chatMessageBody', // Reference model name
                    response: { 201: 'addMessageResponse' }, // Reference model name
                    detail: { summary: 'Add user message & get AI response' }
                })

                // PATCH /:chatId/name - Rename chat
                .patch('/:chatId/name', ({ chatData, body, set }) => {
                     const nameToSave = (typeof body.name === 'string' && body.name.trim() !== '') ? body.name.trim() : undefined;
                     const updatedChat = chatRepository.updateChatName(chatData.id, nameToSave);
                     if (!updatedChat) throw new NotFoundError(`Chat ${chatData.id} during update`);
                     const { messages, ...chatMetadata } = updatedChat;
                     set.status = 200;
                     return chatMetadata;
                }, {
                    body: 'chatRenameBody', // Reference model name
                    response: { 200: 'chatMetadataResponse' }, // Reference model name
                    detail: { summary: 'Rename a chat' }
                })

                // DELETE /:chatId - Delete chat
                .delete('/:chatId', ({ chatData, set }) => {
                     const deleted = chatRepository.deleteChatById(chatData.id);
                     if (!deleted) throw new NotFoundError(`Chat ${chatData.id} during delete`);
                     set.status = 200;
                     return { message: `Chat ${chatData.id} deleted successfully.` };
                }, {
                     response: { 200: 'deleteChatResponse' }, // Reference model name
                     detail: { summary: 'Delete a chat' }
                })
            ) // End guard for routes needing :chatId
        ) // End group with session guard and tag
    ); // End main export
    