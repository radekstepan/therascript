// src/api/chatHandler.ts
// --- Corrected Relative Imports ---
import { chatRepository } from '../repositories/chatRepository.js';
import { sessionRepository } from '../repositories/sessionRepository.js'; // Keep if needed elsewhere, less direct use here
// --- Other Imports ---
import { loadTranscriptContent } from '../services/fileService.js';
import { generateChatResponse } from '../services/ollamaService.js';
// Import ApiError and other needed error types
import { NotFoundError, BadRequestError, InternalServerError, ApiError } from '../errors.js';
import type { BackendSession, BackendChatSession, BackendChatMessage } from '../types/index.js';
// No need to import Context from 'elysia' if relying on inference

// GET /:sessionId/chats/:chatId - Get details of a specific chat
// Let Elysia infer the context type, which will include chatData from the derivation
export const getChatDetails = ({ chatData, set }: any) => { // Use 'any' or let TS infer ctx
    // chatData should be available due to the derive block in the route
    if (!chatData) {
        throw new NotFoundError(`Chat details not found in context.`);
    }
    set.status = 200;
    return chatData;
};

// POST /:sessionId/chats - Create a new chat
// Let Elysia infer the context type, which will include sessionData
export const createChat = ({ sessionData, set }: any) => { // Use 'any' or let TS infer ctx
    const sessionId = sessionData.id;
    try {
        const newChat = chatRepository.createChat(sessionId);
        console.log(`[API] Created new chat ${newChat.id} in session ${sessionId}`);
        const { messages, ...chatMetadata } = newChat;
        set.status = 201;
        return chatMetadata;
    } catch (error) {
        console.error(`[API Error] createChat (Session ID: ${sessionId}):`, error);
        throw new InternalServerError('Failed to create chat', error instanceof Error ? error : undefined);
    }
};

// POST /:sessionId/chats/:chatId/messages - Send message, get AI response
// Let Elysia infer the context type, which will include sessionData, chatData, and validated body
export const addChatMessage = async ({ sessionData, chatData, body, set }: any) => { // Use 'any' or let TS infer ctx
    // Body type is validated by the schema in the route definition
    const { text } = body;
    const trimmedText = text.trim();

    try {
        // 1. Add User Message to DB
        const userMessage = chatRepository.addMessage(chatData.id, 'user', trimmedText);

        // 2. Load Transcript Content
        const transcriptContent = await loadTranscriptContent(sessionData.id);
        if (transcriptContent === null || transcriptContent === undefined) {
             throw new InternalServerError(`Transcript for session ${sessionData.id} could not be loaded or is missing.`);
        }

        // 3. Get Current Chat History from DB
        const currentMessages = chatRepository.findMessagesByChatId(chatData.id);
        if (currentMessages.length === 0) {
             throw new InternalServerError(`CRITICAL: Chat ${chatData.id} has no messages immediately after adding one.`);
        }

        // 4. Generate AI Response
        console.log(`[API] Sending context (transcript + ${currentMessages.length} messages) to Ollama for chat ${chatData.id}...`);
        const aiResponseText = await generateChatResponse(transcriptContent, currentMessages);
        console.log(`[API] Received Ollama response for chat ${chatData.id}.`);

        // 5. Add AI Message to DB
        const aiMessage = chatRepository.addMessage(chatData.id, 'ai', aiResponseText);

        console.log(`[API] Added user (${userMessage.id}) and AI (${aiMessage.id}) messages to chat ${chatData.id}.`);
        set.status = 201;
        return { userMessage, aiMessage };

    } catch (error) {
         console.error(`[API Error] addChatMessage (Chat ID: ${chatData?.id}, Session ID: ${sessionData?.id}):`, error);
         // Re-throw the error for Elysia's central handler
         if (error instanceof ApiError) throw error; // Check against imported ApiError
         throw new InternalServerError('Failed to process chat message', error instanceof Error ? error : undefined);
    }
};

// PATCH /:sessionId/chats/:chatId/name - Rename a chat
// Let Elysia infer the context type
export const renameChat = ({ chatData, body, set }: any) => { // Use 'any' or let TS infer ctx
    // Body type validated by schema
    const { name } = body;
    const nameToSave = (typeof name === 'string' && name.trim() !== '') ? name.trim() : undefined;

    try {
        const updatedChat = chatRepository.updateChatName(chatData.id, nameToSave);
        if (!updatedChat) {
            throw new NotFoundError(`Chat with ID ${chatData.id} not found during update attempt.`);
        }
        console.log(`[API] Renamed chat ${chatData.id} to "${updatedChat.name || '(no name)'}"`);

        const { messages, ...chatMetadata } = updatedChat;
        set.status = 200;
        return chatMetadata;

    } catch (error) {
        console.error(`[API Error] renameChat (Chat ID: ${chatData?.id}):`, error);
        if (error instanceof ApiError) throw error; // Check against imported ApiError
        throw new InternalServerError('Failed to rename chat', error instanceof Error ? error : undefined);
    }
};

// DELETE /:sessionId/chats/:chatId - Delete a chat
// Let Elysia infer the context type
export const deleteChat = ({ chatData, set }: any) => { // Use 'any' or let TS infer ctx
    try {
        const deleted = chatRepository.deleteChatById(chatData.id);
        if (!deleted) {
            throw new NotFoundError(`Chat with ID ${chatData.id} not found during deletion attempt.`);
        }
        console.log(`[API] Deleted chat ${chatData.id}`);
        set.status = 200;
        return { message: `Chat ${chatData.id} deleted successfully.` };
    } catch (error) {
        console.error(`[API Error] deleteChat (Chat ID: ${chatData?.id}):`, error);
        if (error instanceof ApiError) throw error; // Check against imported ApiError
        throw new InternalServerError('Failed to delete chat', error instanceof Error ? error : undefined);
    }
};
