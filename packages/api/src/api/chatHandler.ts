/* packages/api/src/api/chatHandler.ts */
import { chatRepository } from '../repositories/chatRepository.js';
import { loadTranscriptContent } from '../services/fileService.js';
// Import the streaming function, remove the non-streaming one if no longer needed internally
import { streamChatResponse } from '../services/ollamaService.js';
import { NotFoundError, InternalServerError, ApiError } from '../errors.js';
import type { StructuredTranscript, TranscriptParagraphData, BackendChatMessage } from '../types/index.js';
import { TransformStream } from 'node:stream/web'; // Required for creating the passthrough stream
import { TextEncoder } from 'node:util'; // Required for SSE encoding

// GET /:sessionId/chats/:chatId - Get details of a specific chat
export const getChatDetails = ({ chatData, set }: any) => {
    if (!chatData) throw new NotFoundError(`Chat details not found in context.`);
    set.status = 200;
    return chatData;
};

// POST /:sessionId/chats - Create a new chat
export const createChat = ({ sessionData, set }: any) => {
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

// POST /:sessionId/chats/:chatId/messages - Send message, get AI response (Streaming)
export const addChatMessage = async ({ sessionData, chatData, body, set }: any) => {
    const { text } = body;
    const trimmedText = text.trim();
    let userMessage: BackendChatMessage; // Define outside try block

    if (!chatData) {
        // This error will be caught by the main handler and returned as JSON
        throw new NotFoundError(`Chat not found in context for adding message.`);
    }

    try {
        // --- Step 1: Perform all potentially failing operations BEFORE setting SSE headers ---
        // 1a. Add user message to DB
        userMessage = chatRepository.addMessage(chatData.id, 'user', trimmedText);

        // 1b. Load Structured Transcript Content
        console.log(`[API addChatMessage] Loading transcript for session ${sessionData.id}...`);
        const structuredTranscript: StructuredTranscript = await loadTranscriptContent(sessionData.id);
        console.log(`[API addChatMessage] Loaded ${structuredTranscript.length} paragraphs for session ${sessionData.id}.`);

        // 1c. Convert transcript to string
        const transcriptString = structuredTranscript.map(p => p.text).join('\n\n');
        if (!transcriptString) {
            console.warn(`[API addChatMessage] Transcript for session ${sessionData.id} resulted in an EMPTY STRING. Passing this to LLM.`);
        } else {
            console.log(`[API addChatMessage] Transcript string length: ${transcriptString.length}`);
        }

        // 1d. Get current chat messages from DB (including the one just added)
        const currentMessages = chatRepository.findMessagesByChatId(chatData.id);
        if (currentMessages.length === 0) {
             throw new InternalServerError(`CRITICAL: Chat ${chatData.id} has no messages immediately after adding one.`);
        }
        console.log(`[API addChatMessage] Found ${currentMessages.length} messages in chat history for chat ${chatData.id}.`);

        // 1e. Initiate the stream from Ollama service
        console.log(`[API addChatMessage] Initiating stream (transcript length ${transcriptString.length} + ${currentMessages.length} messages)...`);
        const stream = await streamChatResponse(transcriptString, currentMessages);

        // --- Step 2: If all previous steps succeeded, set up and return the SSE stream ---
        set.headers['Content-Type'] = 'text/event-stream; charset=utf-8';
        set.headers['Cache-Control'] = 'no-cache';
        set.headers['Connection'] = 'keep-alive';
        set.headers['X-User-Message-Id'] = String(userMessage.id); // Use the created user message ID
        set.status = 200;

        const passthrough = new TransformStream();
        const writer = passthrough.writable.getWriter();
        const encoder = new TextEncoder();

        const writeSseEvent = async (data: object) => {
            try {
                const jsonData = JSON.stringify(data);
                await writer.write(encoder.encode(`data: ${jsonData}\n\n`));
            } catch (e) {
                console.error("SSE Write Error:", e);
                throw e;
            }
        };

        // Asynchronous stream processing
        const processStream = async () => {
            let fullAiText = '';
            let finalPromptTokens: number | undefined;
            let finalCompletionTokens: number | undefined;
            try {
                for await (const chunk of stream) {
                    if (chunk.message?.content) {
                        const textChunk = chunk.message.content;
                        fullAiText += textChunk;
                        await writeSseEvent({ chunk: textChunk });
                    }
                    if (chunk.done) {
                        finalPromptTokens = chunk.prompt_eval_count;
                        finalCompletionTokens = chunk.eval_count;
                        await writeSseEvent({
                            done: true,
                            promptTokens: finalPromptTokens,
                            completionTokens: finalCompletionTokens
                        });
                    }
                }
                console.log("[API addChatMessage] Stream finished successfully.");

            } catch (streamError) {
                console.error("[API addChatMessage] Error processing Ollama stream:", streamError);
                try { await writeSseEvent({ error: 'Stream processing failed on server.' }); } catch {}
                throw streamError;

            } finally {
                 try { await writer.close(); } catch { try { await writer.abort(); } catch {} }
                 if (fullAiText.trim()) {
                     chatRepository.addMessage(
                         chatData.id, 'ai', fullAiText.trim(),
                         finalPromptTokens, finalCompletionTokens
                     );
                     console.log(`[API addChatMessage] Saved complete AI message after stream.`);
                 } else {
                      console.warn("[API addChatMessage] Stream finished or errored, AI response empty.");
                 }
            }
        };

        processStream().catch(err => {
             console.error("[API addChatMessage] Background stream processing failed:", err);
             writer.abort(err).catch(() => {});
        });

        return passthrough.readable;

    } catch (error) {
        // This now catches errors only from the setup phase (steps 1a-1e)
        console.error(`[API Error] addChatMessage setup failed (Chat ID: ${chatData?.id}, Session ID: ${sessionData?.id}):`, error);
        // Since headers haven't been set, we can throw the error and let the global handler return JSON
        if (error instanceof ApiError) throw error;
        throw new InternalServerError('Failed to setup chat message stream', error instanceof Error ? error : undefined);
    }
};


// PATCH /:sessionId/chats/:chatId/name - Rename a chat
export const renameChat = ({ chatData, body, set }: any) => {
    const { name } = body;
    const nameToSave = (typeof name === 'string' && name.trim() !== '') ? name.trim() : null;
    if (!chatData) throw new NotFoundError(`Chat not found in context for rename.`);
    try {
        const updatedChat = chatRepository.updateChatName(chatData.id, nameToSave);
        if (!updatedChat) throw new NotFoundError(`Chat with ID ${chatData.id} not found during update.`);
        console.log(`[API] Renamed chat ${chatData.id} to "${updatedChat.name || '(no name)'}"`);
        const { messages, ...chatMetadata } = updatedChat;
        set.status = 200;
        return chatMetadata;
    } catch (error) {
        console.error(`[API Error] renameChat (Chat ID: ${chatData?.id}):`, error);
        if (error instanceof ApiError) throw error;
        throw new InternalServerError('Failed to rename chat', error instanceof Error ? error : undefined);
    }
};

// DELETE /:sessionId/chats/:chatId - Delete a chat
export const deleteChat = ({ chatData, set }: any) => {
    if (!chatData) throw new NotFoundError(`Chat not found in context for delete.`);
    try {
        const deleted = chatRepository.deleteChatById(chatData.id);
        if (!deleted) throw new NotFoundError(`Chat with ID ${chatData.id} not found during deletion.`);
        console.log(`[API] Deleted chat ${chatData.id}`);
        set.status = 200;
        return { message: `Chat ${chatData.id} deleted successfully.` };
    } catch (error) {
        console.error(`[API Error] deleteChat (Chat ID: ${chatData?.id}):`, error);
        if (error instanceof ApiError) throw error;
        throw new InternalServerError('Failed to delete chat', error instanceof Error ? error : undefined);
    }
};
