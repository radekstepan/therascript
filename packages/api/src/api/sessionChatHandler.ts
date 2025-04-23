/* packages/api/src/api/sessionChatHandler.ts */
import { chatRepository } from '../repositories/chatRepository.js';
import { loadTranscriptContent } from '../services/fileService.js';
import { streamChatResponse } from '../services/ollamaService.js';
import { NotFoundError, InternalServerError, ApiError } from '../errors.js';
import type { StructuredTranscript, BackendChatMessage, BackendChatSession, ChatMetadata } from '../types/index.js';
import { TransformStream } from 'node:stream/web';
import { TextEncoder } from 'node:util';
// --- Removed explicit Response import ---

// Define precise return types matching the schemas where needed
type SessionChatMetadataResponse = ChatMetadata & { sessionId: number };
type FullSessionChatResponse = SessionChatMetadataResponse & { messages: BackendChatMessage[] };

// --- Session Chat Handlers (used by sessionRoutes) ---

// POST /api/sessions/:sessionId/chats - Create a new chat associated with a session
export const createSessionChat = ({ sessionData, set }: any): SessionChatMetadataResponse => {
    const sessionId = sessionData.id;
    try {
        const newChat = chatRepository.createChat(sessionId);
        console.log(`[API] Created new chat ${newChat.id} in session ${sessionId}`);
        const { messages, ...chatMetadata } = newChat;
        set.status = 201;
        if(chatMetadata.sessionId === null) throw new InternalServerError("Created session chat has null sessionId");
        return chatMetadata as SessionChatMetadataResponse; // Assert sessionId is number
    } catch (error) {
        console.error(`[API Error] createSessionChat (Session ID: ${sessionId}):`, error);
        throw new InternalServerError('Failed to create session chat', error instanceof Error ? error : undefined);
    }
};

// POST /api/sessions/:sessionId/chats/:chatId/messages - Add message to session chat (Streaming)
export const addSessionChatMessage = async ({ sessionData, chatData, body, set }: any): Promise<Response> => {
    const { text } = body;
    const trimmedText = text.trim();
    let userMessage: BackendChatMessage;

    if (!chatData) throw new NotFoundError(`Chat not found in context for adding message.`);
    if (chatData.sessionId !== sessionData.id) throw new ApiError(403, `Chat ${chatData.id} does not belong to session ${sessionData.id}.`);

    try {
        userMessage = chatRepository.addMessage(chatData.id, 'user', trimmedText);
        const structuredTranscript: StructuredTranscript = await loadTranscriptContent(sessionData.id);
        const transcriptString = structuredTranscript.map(p => p.text).join('\n\n');
        const currentMessages = chatRepository.findMessagesByChatId(chatData.id);
        if (currentMessages.length === 0) throw new InternalServerError(`CRITICAL: Chat ${chatData.id} has no messages immediately after adding one.`);

        const ollamaStream = await streamChatResponse(transcriptString, currentMessages);

        const headers = new Headers();
        headers.set('Content-Type', 'text/event-stream; charset=utf-8');
        headers.set('Cache-Control', 'no-cache');
        headers.set('Connection', 'keep-alive');
        headers.set('X-User-Message-Id', String(userMessage.id));

        const passthrough = new TransformStream<Uint8Array, Uint8Array>();
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

        const processStream = async () => {
             let fullAiText = '';
             let finalPromptTokens: number | undefined;
             let finalCompletionTokens: number | undefined;
             try {
                 for await (const chunk of ollamaStream) {
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
                 console.log("[API addSessionChatMessage] Stream finished successfully.");
             } catch (streamError) {
                 console.error("[API addSessionChatMessage] Error processing Ollama stream:", streamError);
                 try { await writeSseEvent({ error: 'Stream processing failed on server.' }); } catch {}
                 await writer.abort(streamError);
                 console.error("Aborted writer due to stream error.");
             } finally {
                  if (!writer.closed && writer.desiredSize !== null) {
                       try { await writer.close(); } catch {}
                  }
                  if (fullAiText.trim()) {
                      chatRepository.addMessage(
                          chatData.id, 'ai', fullAiText.trim(),
                          finalPromptTokens, finalCompletionTokens
                      );
                      console.log(`[API addSessionChatMessage] Saved complete AI message after stream end/error.`);
                  } else {
                       console.warn("[API addSessionChatMessage] Stream finished or errored, AI response empty.");
                  }
             }
        };
        processStream().catch(err => {
            console.error("[API addSessionChatMessage] Uncaught background stream processing error:", err);
        });

        // Use global Response, cast stream if needed
        // The 'as any' cast might be needed if TS still complains about stream compatibility
        return new Response(passthrough.readable as any, { status: 200, headers });

    } catch (error) {
        console.error(`[API Error] addSessionChatMessage setup failed (Chat ID: ${chatData?.id}, Session ID: ${sessionData?.id}):`, error);
        if (error instanceof ApiError) throw error;
        throw new InternalServerError('Failed to setup chat message stream', error instanceof Error ? error : undefined);
    }
};

// GET /api/sessions/:sessionId/chats/:chatId - Get details of a specific session chat
export const getSessionChatDetails = ({ chatData, sessionData, set }: any): FullSessionChatResponse => { // Return type corrected
    if (!chatData) throw new NotFoundError(`Chat details not found in context.`);
    if (chatData.sessionId !== sessionData.id) throw new ApiError(403, `Chat ${chatData.id} does not belong to session ${sessionData.id}.`);
    set.status = 200;
    // Ensure the returned object matches the expected schema structure
    const messages = chatData.messages ?? [];
    const { messages: _m, ...metadata } = chatData;
    return {
        ...metadata,
        sessionId: metadata.sessionId as number, // Assert sessionId is number
        messages: messages // Ensure messages array is present
    };
};

// PATCH /api/sessions/:sessionId/chats/:chatId/name - Rename a session chat
export const renameSessionChat = ({ chatData, sessionData, body, set }: any): SessionChatMetadataResponse => { // Correct return type
    const { name } = body;
    const nameToSave = (typeof name === 'string' && name.trim() !== '') ? name.trim() : null;
    if (!chatData) throw new NotFoundError(`Chat not found in context for rename.`);
    if (chatData.sessionId !== sessionData.id) throw new ApiError(403, `Chat ${chatData.id} does not belong to session ${sessionData.id}.`);
    try {
        const updatedChatMetadata = chatRepository.updateChatName(chatData.id, nameToSave);
        if (!updatedChatMetadata) throw new NotFoundError(`Chat with ID ${chatData.id} not found during update.`);
        console.log(`[API] Renamed session chat ${chatData.id} to "${updatedChatMetadata.name || '(no name)'}"`);
        set.status = 200;
        if(updatedChatMetadata.sessionId === null) {
            console.error(`[API Error] Renamed session chat ${chatData.id} resulted in null sessionId!`);
            throw new InternalServerError("Failed to rename session chat correctly.");
        }
        return updatedChatMetadata as SessionChatMetadataResponse; // Assert sessionId is number
    } catch (error) {
        console.error(`[API Error] renameSessionChat (Chat ID: ${chatData?.id}):`, error);
        if (error instanceof ApiError) throw error;
        throw new InternalServerError('Failed to rename session chat', error instanceof Error ? error : undefined);
    }
};

// DELETE /api/sessions/:sessionId/chats/:chatId - Delete a session chat
export const deleteSessionChat = ({ chatData, sessionData, set }: any): { message: string } => {
    if (!chatData) throw new NotFoundError(`Chat not found in context for delete.`);
    if (chatData.sessionId !== sessionData.id) throw new ApiError(403, `Chat ${chatData.id} does not belong to session ${sessionData.id}.`);
    try {
        const deleted = chatRepository.deleteChatById(chatData.id);
        if (!deleted) throw new NotFoundError(`Chat with ID ${chatData.id} not found during deletion.`);
        console.log(`[API] Deleted session chat ${chatData.id}`);
        set.status = 200;
        return { message: `Chat ${chatData.id} deleted successfully.` };
    } catch (error) {
        console.error(`[API Error] deleteSessionChat (Chat ID: ${chatData?.id}):`, error);
        if (error instanceof ApiError) throw error;
        throw new InternalServerError('Failed to delete session chat', error instanceof Error ? error : undefined);
    }
};
