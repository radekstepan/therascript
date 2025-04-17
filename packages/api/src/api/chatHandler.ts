import { chatRepository } from '../repositories/chatRepository.js';
import { loadTranscriptContent } from '../services/fileService.js';
import { generateChatResponse } from '../services/ollamaService.js';
import { NotFoundError, InternalServerError, ApiError } from '../errors.js';
import type { StructuredTranscript, TranscriptParagraphData, BackendChatMessage } from '../types/index.js'; // Added BackendChatMessage

// GET /:sessionId/chats/:chatId - Get details of a specific chat
export const getChatDetails = ({ chatData, set }: any) => {
    if (!chatData) throw new NotFoundError(`Chat details not found in context.`);
    // Ensure chatData includes messages as expected by the schema
    // If findChatById doesn't include messages, fetch them here (but it does now)
    set.status = 200;
    return chatData;
};

// POST /:sessionId/chats - Create a new chat
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
export const addChatMessage = async ({ sessionData, chatData, body, set }: any) => { // Using 'any', remains async
    const { text } = body; // Body is validated by schema
    const trimmedText = text.trim();

    if (!chatData) {
        throw new NotFoundError(`Chat not found in context for adding message.`);
    }

    try {
        // 1. Add user message to DB (no tokens)
        const userMessage: BackendChatMessage = chatRepository.addMessage(chatData.id, 'user', trimmedText);

        // 2. Load Structured Transcript Content
        console.log(`[API addChatMessage] Loading transcript for session ${sessionData.id}...`); // DEBUG LOG
        const structuredTranscript: StructuredTranscript = await loadTranscriptContent(sessionData.id); // Async, returns StructuredTranscript
        console.log(`[API addChatMessage] Loaded ${structuredTranscript.length} paragraphs for session ${sessionData.id}.`); // DEBUG LOG

        // 3. Convert structured transcript to a single string for the LLM context
        // Simple join with double newlines between paragraphs
        const transcriptString = structuredTranscript.map(p => p.text).join('\n\n');
        console.log(`[API addChatMessage DEBUG] Transcript string length: ${transcriptString.length}`); // DEBUG LOG
        // console.log(`[API addChatMessage DEBUG] Transcript string (first 300 chars): "${transcriptString.substring(0,300).replace(/\n/g, '\\n')}"`); // Optional VERBOSE log

        // *** CHECK IF transcriptString IS EMPTY ***
        if (!transcriptString) {
             // Log a warning but proceed, the LLM prompt handles empty transcript case
             console.warn(`[API addChatMessage] Transcript for session ${sessionData.id} resulted in an EMPTY STRING after processing. Passing this to LLM.`);
        } else {
             console.log(`[API addChatMessage] Transcript string is NOT empty. Length: ${transcriptString.length}`);
        }

        // 4. Get current chat messages from DB (including the one just added)
        const currentMessages = chatRepository.findMessagesByChatId(chatData.id); // Sync
        if (currentMessages.length === 0) {
             // This should theoretically not happen as we just added a message
             throw new InternalServerError(`CRITICAL: Chat ${chatData.id} has no messages immediately after adding one.`);
        }
        console.log(`[API addChatMessage] Found ${currentMessages.length} messages in chat history for chat ${chatData.id}.`); // DEBUG LOG

        // 5. Generate AI response using the stringified transcript and chat history (now returns object with tokens)
        console.log(`[API addChatMessage] Sending context (transcript string length ${transcriptString.length} + ${currentMessages.length} messages) to Ollama...`);
        const aiResponse = await generateChatResponse(transcriptString, currentMessages); // Returns { content, promptTokens?, completionTokens? }
        console.log(`[API addChatMessage] Received Ollama response.`);

        // 6. Add AI response message to DB (passing tokens)
        const aiMessage: BackendChatMessage = chatRepository.addMessage(
            chatData.id,
            'ai',
            aiResponse.content,
            aiResponse.promptTokens, // Pass promptTokens
            aiResponse.completionTokens // Pass completionTokens
        );

        console.log(`[API] Added user (${userMessage.id}) and AI (${aiMessage.id}) messages to chat ${chatData.id}.`);
        set.status = 201;
        // Return both messages; aiMessage will include tokens if provided by ollamaService
        return { userMessage, aiMessage };

    } catch (error) {
         console.error(`[API Error] addChatMessage (Chat ID: ${chatData?.id}, Session ID: ${sessionData?.id}):`, error);
         if (error instanceof ApiError) throw error;
         throw new InternalServerError('Failed to process chat message', error instanceof Error ? error : undefined);
    }
};

// PATCH /:sessionId/chats/:chatId/name - Rename a chat
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
            // Should not happen if chatData was found, but good practice
            throw new NotFoundError(`Chat with ID ${chatData.id} not found during update attempt.`);
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
export const deleteChat = ({ chatData, set }: any) => { // Using 'any', becomes sync
    if (!chatData) {
        throw new NotFoundError(`Chat not found in context for delete.`);
    }
    try {
        const deleted = chatRepository.deleteChatById(chatData.id); // Sync call
        if (!deleted) {
             // Should not happen if chatData was found, but good practice
            throw new NotFoundError(`Chat with ID ${chatData.id} not found during deletion attempt.`);
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
