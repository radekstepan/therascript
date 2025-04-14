import { chatRepository } from '../repositories/chatRepository.js';
import { loadTranscriptContent } from '../services/fileService.js';
import { generateChatResponse } from '../services/ollamaService.js';
import { NotFoundError, InternalServerError, ApiError } from '../errors.js';
// No need for explicit context types here, rely on Elysia's inference

// GET /:sessionId/chats/:chatId - Get details of a specific chat
// Let Elysia infer the context, including 'chatData' from the derive block
export const getChatDetails = ({ chatData, set }: any) => { // Using 'any' for simplicity, Elysia infers
    if (!chatData) {
        throw new NotFoundError(`Chat details not found in context.`);
    }
    // Ensure chatData includes messages as expected by the schema
    // If findChatById doesn't include messages, fetch them here (but it does now)
    set.status = 200;
    return chatData;
};

// POST /:sessionId/chats - Create a new chat
// Let Elysia infer the context, including 'sessionData'
export const createChat = ({ sessionData, set }: any) => { // Using 'any', becomes sync
    const sessionId = sessionData.id;
    try {
        const newChat = chatRepository.createChat(sessionId); // Sync call
        console.log(`[API] Created new chat ${newChat.id} in session ${sessionId}`);
        const { messages, ...chatMetadata } = newChat;
        set.status = 201;
        return chatMetadata; // Matches ChatMetadataResponseSchema
    } catch (error) {
        console.error(`[API Error] createChat (Session ID: ${sessionId}):`, error);
        throw new InternalServerError('Failed to create chat', error instanceof Error ? error : undefined);
    }
};

// POST /:sessionId/chats/:chatId/messages - Send message, get AI response
// Let Elysia infer context, including 'sessionData', 'chatData', 'body'
export const addChatMessage = async ({ sessionData, chatData, body, set }: any) => { // Using 'any', remains async
    const { text } = body; // Body is validated by schema
    const trimmedText = text.trim();

    if (!chatData) {
        throw new NotFoundError(`Chat not found in context for adding message.`);
    }

    try {
        const userMessage = chatRepository.addMessage(chatData.id, 'user', trimmedText); // Sync

        const transcriptContent = await loadTranscriptContent(sessionData.id); // Async
        if (transcriptContent === null || transcriptContent === undefined) {
             throw new InternalServerError(`Transcript for session ${sessionData.id} could not be loaded.`);
        }

        const currentMessages = chatRepository.findMessagesByChatId(chatData.id); // Sync
        if (currentMessages.length === 0) {
             throw new InternalServerError(`CRITICAL: Chat ${chatData.id} has no messages.`);
        }

        console.log(`[API] Sending context (transcript + ${currentMessages.length} messages) to Ollama...`);
        const aiResponseText = await generateChatResponse(transcriptContent, currentMessages); // Async
        console.log(`[API] Received Ollama response.`);

        const aiMessage = chatRepository.addMessage(chatData.id, 'ai', aiResponseText); // Sync

        console.log(`[API] Added user (${userMessage.id}) and AI (${aiMessage.id}) messages.`);
        set.status = 201;
        return { userMessage, aiMessage }; // Matches AddMessageResponseSchema

    } catch (error) {
         console.error(`[API Error] addChatMessage (Chat ID: ${chatData?.id}, Session ID: ${sessionData?.id}):`, error);
         if (error instanceof ApiError) throw error;
         throw new InternalServerError('Failed to process chat message', error instanceof Error ? error : undefined);
    }
};

// PATCH /:sessionId/chats/:chatId/name - Rename a chat
// Let Elysia infer context
export const renameChat = ({ chatData, body, set }: any) => { // Using 'any', becomes sync
    const { name } = body; // Body validated by schema
    // Ensure name is string or null for the repository
    const nameToSave = (typeof name === 'string' && name.trim() !== '') ? name.trim() : null;

    if (!chatData) {
        throw new NotFoundError(`Chat not found in context for rename.`);
    }

    try {
        // Pass string | null to the repository function
        const updatedChat = chatRepository.updateChatName(chatData.id, nameToSave); // Sync call
        if (!updatedChat) {
            throw new NotFoundError(`Chat with ID ${chatData.id} not found during update.`);
        }
        console.log(`[API] Renamed chat ${chatData.id} to "${updatedChat.name || '(no name)'}"`);

        const { messages, ...chatMetadata } = updatedChat;
        set.status = 200;
        return chatMetadata; // Matches ChatMetadataResponseSchema

    } catch (error) {
        console.error(`[API Error] renameChat (Chat ID: ${chatData?.id}):`, error);
        if (error instanceof ApiError) throw error;
        throw new InternalServerError('Failed to rename chat', error instanceof Error ? error : undefined);
    }
};

// DELETE /:sessionId/chats/:chatId - Delete a chat
// Let Elysia infer context
export const deleteChat = ({ chatData, set }: any) => { // Using 'any', becomes sync
    if (!chatData) {
        throw new NotFoundError(`Chat not found in context for delete.`);
    }
    try {
        const deleted = chatRepository.deleteChatById(chatData.id); // Sync call
        if (!deleted) {
            throw new NotFoundError(`Chat with ID ${chatData.id} not found during deletion.`);
        }
        console.log(`[API] Deleted chat ${chatData.id}`);
        set.status = 200;
        return { message: `Chat ${chatData.id} deleted successfully.` }; // Matches DeleteChatResponseSchema
    } catch (error) {
        console.error(`[API Error] deleteChat (Chat ID: ${chatData?.id}):`, error);
        if (error instanceof ApiError) throw error;
        throw new InternalServerError('Failed to delete chat', error instanceof Error ? error : undefined);
    }
};
