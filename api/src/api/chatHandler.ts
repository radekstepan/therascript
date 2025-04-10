// src/api/chatHandler.ts
import { Request, Response, NextFunction } from 'express';
// --- Corrected Relative Imports ---
import { chatRepository } from '../repositories/chatRepository.js';
// Keep sessionRepository import if you need to access session details beyond what middleware provides
import { sessionRepository } from '../repositories/sessionRepository.js';
// --- Other Imports ---
import { loadTranscriptContent } from '../services/fileService.js';
import { generateChatResponse } from '../services/ollamaService.js';
import type { BackendSession, BackendChatSession, BackendChatMessage } from '../types/index.js';

// POST /:sessionId/chats - Create a new chat
export const createChat = (req: Request, res: Response, next: NextFunction): void => {
    const session: BackendSession = (req as any).sessionData; // Session guaranteed by middleware
    const sessionId: number = session.id;
    try {
        // Create the chat record in the database
        const newChat = chatRepository.createChat(sessionId);
        console.log(`[API] Created new chat ${newChat.id} in session ${sessionId}`);
        // Return metadata of the newly created chat (ID, timestamp, sessionId, name)
        const { messages, ...chatMetadata } = newChat; // Exclude the empty messages array
        res.status(201).json(chatMetadata);
    } catch (error) {
        console.error(`[API Error] createChat (Session ID: ${sessionId}):`, error);
        next(error); // Pass DB errors
    }
};

// POST /:sessionId/chats/:chatId/messages - Send message, get AI response
export const addChatMessage = async (req: Request, res: Response, next: NextFunction): Promise<void | Response> => {
    const session: BackendSession = (req as any).sessionData; // Session guaranteed by middleware
    const chat: BackendChatSession = (req as any).chatData;   // Chat guaranteed by middleware
    const { text } = req.body;

    // --- Input Validation ---
    if (!text || typeof text !== 'string' || text.trim() === '') {
        return res.status(400).json({ error: 'Message text cannot be empty.' });
    }
    const trimmedText = text.trim();
    // Consider adding length validation if necessary
    // --- End Input Validation ---

    try {
        // 1. Add User Message to DB
        const userMessage = chatRepository.addMessage(chat.id, 'user', trimmedText);

        // 2. Load Transcript Content (Error handled within service, throws if critical)
        const transcriptContent = await loadTranscriptContent(session.id);
        if (transcriptContent === null || transcriptContent === undefined) {
             throw new Error(`Transcript for session ${session.id} could not be loaded or is missing.`);
        }

        // 3. Get Current Chat History from DB (including the new user message)
        // This ensures Ollama gets the most up-to-date context
        const currentMessages = chatRepository.findMessagesByChatId(chat.id);
        if (currentMessages.length === 0) {
             // This indicates a potential race condition or DB issue
             throw new Error(`CRITICAL: Chat ${chat.id} has no messages immediately after adding one.`);
        }

        // 4. Generate AI Response via Ollama Service
        console.log(`[API] Sending context (transcript + ${currentMessages.length} messages) to Ollama for chat ${chat.id}...`);
        const aiResponseText = await generateChatResponse(transcriptContent, currentMessages);
        console.log(`[API] Received Ollama response for chat ${chat.id}.`);

        // 5. Add AI Message to DB
        const aiMessage = chatRepository.addMessage(chat.id, 'ai', aiResponseText);

        console.log(`[API] Added user (${userMessage.id}) and AI (${aiMessage.id}) messages to chat ${chat.id}.`);
        // Return *only* the newly added messages (user + AI)
        res.status(201).json({ userMessage, aiMessage });

    } catch (error) {
         // Log errors from DB, file loading, or Ollama
         console.error(`[API Error] addChatMessage (Chat ID: ${chat?.id}, Session ID: ${session?.id}):`, error);
         // Note: User message persists even if AI fails. Implement rollback logic if desired.
        next(error); // Pass error to central handler
    }
};

// PATCH /:sessionId/chats/:chatId/name - Rename a chat
export const renameChat = (req: Request, res: Response, next: NextFunction): void | Response => {
    const chat: BackendChatSession = (req as any).chatData; // Chat guaranteed by middleware
    const { name } = req.body;

    // --- Input Validation ---
    // Allow undefined or null to signify removing the name
    if (name !== undefined && name !== null && typeof name !== 'string') {
        return res.status(400).json({ error: 'Invalid body: "name" must be a string, null, or omitted.' });
    }
    // --- End Input Validation ---

    // Determine the name to save: undefined if empty/null/undefined, otherwise the trimmed string
    const nameToSave = (typeof name === 'string' && name.trim() !== '') ? name.trim() : undefined;

    try {
        // Update name in the repository
        const updatedChat = chatRepository.updateChatName(chat.id, nameToSave);
        // Check if update was successful
        if (!updatedChat) {
            // This implies chat was deleted between middleware load and handler execution
            return res.status(404).json({ error: `Chat with ID ${chat.id} not found during update attempt.` });
        }
        console.log(`[API] Renamed chat ${chat.id} to "${updatedChat.name || '(no name)'}"`);

        // Return updated chat metadata (excluding potentially large messages array)
        const { messages, ...chatMetadata } = updatedChat;
        res.status(200).json(chatMetadata);

    } catch (error) {
        console.error(`[API Error] renameChat (Chat ID: ${chat?.id}):`, error);
        next(error); // Pass DB errors
    }
};

// DELETE /:sessionId/chats/:chatId - Delete a chat
export const deleteChat = (req: Request, res: Response, next: NextFunction): void | Response => {
    const chat: BackendChatSession = (req as any).chatData; // Chat guaranteed by middleware
    try {
        // Attempt to delete the chat (DB cascade handles messages)
        const deleted = chatRepository.deleteChatById(chat.id);
        // Check if deletion was successful
        if (!deleted) {
            // This implies chat was deleted between middleware load and handler execution
            return res.status(404).json({ error: `Chat with ID ${chat.id} not found during deletion attempt.` });
        }
        console.log(`[API] Deleted chat ${chat.id}`);
        // Send success confirmation
        res.status(200).json({ message: `Chat ${chat.id} deleted successfully.` });
    } catch (error) {
        console.error(`[API Error] deleteChat (Chat ID: ${chat?.id}):`, error);
        next(error); // Pass DB errors
    }
};
