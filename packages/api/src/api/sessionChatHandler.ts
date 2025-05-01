// =========================================
// File: packages/api/src/api/sessionChatHandler.ts
// (Refined processStream function)
// =========================================
import { chatRepository } from '../repositories/chatRepository.js';
import { transcriptRepository } from '../repositories/transcriptRepository.js';
import { messageRepository } from '../repositories/messageRepository.js';
import { streamChatResponse } from '../services/ollamaService.js';
import { NotFoundError, InternalServerError, ApiError, BadRequestError } from '../errors.js';
import type { StructuredTranscript, BackendChatMessage, ChatMetadata } from '../types/index.js';
import { TransformStream } from 'node:stream/web';
import { TextEncoder } from 'node:util';

// Define precise return types matching the schemas where needed
type SessionChatMetadataResponse = Omit<ChatMetadata, 'tags'> & { sessionId: number };
type ApiChatMessageResponse = Omit<BackendChatMessage, 'starred'> & { starred: boolean };
type FullSessionChatApiResponse = SessionChatMetadataResponse & { messages: ApiChatMessageResponse[] };


// POST /api/sessions/:sessionId/chats - Create a new chat associated with a session
export const createSessionChat = ({ sessionData, set }: any): SessionChatMetadataResponse => {
    const sessionId = sessionData.id;
    try {
        const newChat = chatRepository.createChat(sessionId);
        console.log(`[API] Created new chat ${newChat.id} in session ${sessionId}`);
        const { messages, ...chatMetadata } = newChat;
        set.status = 201;
        if(chatMetadata.sessionId === null) throw new InternalServerError("Created session chat has null sessionId");
        const { tags, ...responseMetadata } = chatMetadata;
        return responseMetadata as SessionChatMetadataResponse;
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
        userMessage = messageRepository.addMessage(chatData.id, 'user', trimmedText);
        const transcriptString = transcriptRepository.getTranscriptTextForSession(sessionData.id);
        const currentMessages = messageRepository.findMessagesByChatId(chatData.id);
        if (currentMessages.length === 0) throw new InternalServerError(`CRITICAL: Chat ${chatData.id} has no messages immediately after adding one.`);

        const ollamaStream = await streamChatResponse(transcriptString, currentMessages);

        const headers = new Headers({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-User-Message-Id': String(userMessage.id) });
        const passthrough = new TransformStream<Uint8Array, Uint8Array>();
        const writer = passthrough.writable.getWriter();
        const encoder = new TextEncoder();

        const writeSseEvent = async (data: object) => {
             try {
                 // Check if writer is already closed or closing before writing
                 // Note: There isn't a perfect cross-platform way to check if a writer is locked/closed
                 // without potentially causing an error. We rely on catching the error.
                 await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
             } catch (e) {
                 // If write fails, it likely means the client disconnected or the stream errored.
                 console.warn(`[API SSE Write Error ${chatData.id}]: Failed to write to stream (client likely disconnected):`, e);
                 // We should abort further processing if we can't write
                 throw new Error("SSE write failed, aborting stream processing.");
             }
         };

        // --- Refined processStream ---
        const processStream = async () => {
            let fullAiText = '';
            let finalPromptTokens: number | undefined;
            let finalCompletionTokens: number | undefined;
            let ollamaStreamError: Error | null = null;

            // Wrap the Ollama stream iteration in its own try/catch
            try {
                console.log(`[API ProcessStream ${chatData.id}] Starting Ollama stream processing...`);
                for await (const chunk of ollamaStream) {
                    // Send chunk to client
                    if (chunk.message?.content) {
                        const textChunk = chunk.message.content;
                        fullAiText += textChunk;
                        await writeSseEvent({ chunk: textChunk });
                    }
                    // Check for final 'done' data from Ollama
                    if (chunk.done) {
                        finalPromptTokens = chunk.prompt_eval_count;
                        finalCompletionTokens = chunk.eval_count;
                        console.log(`[API ProcessStream ${chatData.id}] Ollama stream 'done' signal received. Tokens: C=${finalCompletionTokens}, P=${finalPromptTokens}`);
                        // Send final 'done' event to client
                        await writeSseEvent({ done: true, promptTokens: finalPromptTokens, completionTokens: finalCompletionTokens });
                    }
                }
                console.log(`[API ProcessStream ${chatData.id}] Finished iterating Ollama stream successfully.`);
            } catch (streamError: any) {
                 ollamaStreamError = streamError instanceof Error ? streamError : new Error(String(streamError));
                 console.error(`[API ProcessStream ${chatData.id}] Error DURING Ollama stream iteration:`, ollamaStreamError);
                 // Attempt to inform the client about the error before closing
                 try { await writeSseEvent({ error: 'Stream processing failed on server during LLM interaction.' }); } catch {}
            } finally {
                 console.log(`[API ProcessStream Finally ${chatData.id}] Cleaning up. Ollama stream errored: ${!!ollamaStreamError}`);
                 // --- Database Saving ---
                 // Attempt to save even if Ollama stream errored, as we might have partial text
                 if (fullAiText.trim()) {
                    try {
                        messageRepository.addMessage(chatData.id, 'ai', fullAiText.trim(), finalPromptTokens, finalCompletionTokens);
                        console.log(`[API ProcessStream Finally ${chatData.id}] Saved AI message (length: ${fullAiText.trim().length}) to DB.`);
                    } catch (dbError) {
                         console.error(`[API ProcessStream Finally ${chatData.id}] CRITICAL: Failed to save AI message to DB:`, dbError);
                         // If DB save fails, it's a server error, but we still need to close the client connection.
                         ollamaStreamError = ollamaStreamError || new InternalServerError("Failed to save AI response to database.", dbError instanceof Error ? dbError : undefined);
                         // Attempt to inform client if possible
                         try { await writeSseEvent({ error: 'Failed to save final AI response.' }); } catch {}
                    }
                 } else {
                     console.warn(`[API ProcessStream Finally ${chatData.id}] No AI text generated or saved.`);
                 }

                 // --- Ensure Writer Closure ---
                 // Use abort if there was any error, otherwise close.
                 if (ollamaStreamError) {
                     console.log(`[API ProcessStream Finally ${chatData.id}] Aborting writer due to error.`);
                     // Use catch because aborting a potentially already closed writer can throw
                     await writer.abort(ollamaStreamError).catch(e => console.warn(`[API ProcessStream Finally ${chatData.id}] Error aborting writer (may be expected):`, e));
                 } else {
                      console.log(`[API ProcessStream Finally ${chatData.id}] Closing writer normally.`);
                      // Use catch because closing an already closed writer can throw
                      await writer.close().catch(e => console.warn(`[API ProcessStream Finally ${chatData.id}] Error closing writer (may be expected):`, e));
                 }
                 console.log(`[API ProcessStream Finally ${chatData.id}] Writer cleanup attempt finished.`);
            }
        };
        // --- End Refined processStream ---

        // Run processStream in the background, don't await it here
        processStream().catch(err => {
            // This catch is for unexpected errors *outside* the processStream's try/catch/finally
            console.error(`[API AddMsg ${chatData.id}] UNHANDLED error from background stream processing task:`, err);
            // Ensure writer is cleaned up if an error occurred *before* finally block in processStream ran
             if (writer && !writer.closed) {
                 writer.abort(err).catch(abortErr => console.error("Error aborting writer in outer catch:", abortErr));
             }
        });

        return new Response(passthrough.readable as any, { status: 200, headers });

    } catch (error) {
        console.error(`[API Error] addSessionChatMessage setup failed (Chat ID: ${chatData?.id}, Session ID: ${sessionData?.id}):`, error);
        if (error instanceof ApiError) throw error;
        throw new InternalServerError('Failed to setup chat message stream', error instanceof Error ? error : undefined);
    }
};

// PATCH /api/sessions/:sessionId/chats/:chatId/messages/:messageId - Update message star status
// (No changes needed here regarding types)
export const updateSessionChatMessageStarStatus = ({ sessionData, chatData, messageData, body, set }: any): ApiChatMessageResponse => {
    const { starred, starredName } = body;
    if (typeof starred !== 'boolean') throw new BadRequestError("Missing or invalid 'starred' field (boolean).");
    if (starred && typeof starredName !== 'string') throw new BadRequestError("Missing or invalid 'starredName' field (string when starring).");
    if (!starred && starredName !== undefined) console.warn("[API Star] 'starredName' provided but 'starred' is false. Name will be ignored/nulled.");
     if (messageData.sender !== 'user') throw new BadRequestError("Only user messages can be starred.");

    try {
        console.log(`[API Star] Updating star status for message ${messageData.id} in chat ${chatData.id} (session ${sessionData.id}) to starred=${starred}, name=${starredName}`);
        const updatedMessage = messageRepository.updateMessageStarStatus(messageData.id, starred, starredName); // <-- Use messageRepository
        if (!updatedMessage) throw new NotFoundError(`Message ${messageData.id} not found during update.`);
        set.status = 200;
        const { starred: starredNum, ...rest } = updatedMessage;
        return { ...rest, starred: !!starredNum, starredName: rest.starredName === undefined ? undefined : rest.starredName };
    } catch (error) {
        console.error(`[API Error] updateSessionChatMessageStarStatus (Message ID: ${messageData?.id}):`, error);
        if (error instanceof ApiError) throw error;
        throw new InternalServerError('Failed to update message star status', error instanceof Error ? error : undefined);
    }
};


// GET /api/sessions/:sessionId/chats/:chatId - Get details of a specific session chat
export const getSessionChatDetails = ({ chatData, sessionData, set }: any): FullSessionChatApiResponse => {
    if (!chatData) throw new NotFoundError(`Chat details not found in context.`);
    if (chatData.sessionId !== sessionData.id) throw new ApiError(403, `Chat ${chatData.id} does not belong to session ${sessionData.id}.`);
    set.status = 200;
    const messages = (chatData.messages ?? []).map((m: BackendChatMessage) => ({ ...m, starred: !!m.starred, starredName: m.starredName === undefined ? undefined : m.starredName }));
    // --- FIX: Exclude tags from the response ---
    const { messages: _m, tags, ...metadata } = chatData;
    // --- END FIX ---
    return {
        ...metadata,
        sessionId: metadata.sessionId as number, // Assert sessionId is number
        messages: messages
    };
};

// PATCH /api/sessions/:sessionId/chats/:chatId/name - Rename a session chat
export const renameSessionChat = ({ chatData, sessionData, body, set }: any): SessionChatMetadataResponse => {
    const { name } = body; // Session chats don't have tags currently
    const nameToSave = (typeof name === 'string' && name.trim() !== '') ? name.trim() : null;
    if (!chatData) throw new NotFoundError(`Chat not found in context for rename.`);
    if (chatData.sessionId !== sessionData.id) throw new ApiError(403, `Chat ${chatData.id} does not belong to session ${sessionData.id}.`);
    try {
        // --- FIX: Use updated repo function, passing null for tags ---
        const updatedChatMetadata = chatRepository.updateChatDetails(chatData.id, nameToSave, null);
        // --- END FIX ---
        if (!updatedChatMetadata) throw new NotFoundError(`Chat with ID ${chatData.id} not found during update.`);
        console.log(`[API] Renamed session chat ${chatData.id} to "${updatedChatMetadata.name || '(no name)'}"`);
        set.status = 200;
        if(updatedChatMetadata.sessionId === null) { console.error(`[API Error] Renamed session chat ${chatData.id} resulted in null sessionId!`); throw new InternalServerError("Failed to rename session chat correctly."); }
        // --- FIX: Exclude tags from response ---
        const { tags: _t, ...responseMetadata } = updatedChatMetadata;
        // --- END FIX ---
        return responseMetadata as SessionChatMetadataResponse; // Assert sessionId is number, tags excluded
    } catch (error) {
        console.error(`[API Error] renameSessionChat (Chat ID: ${chatData?.id}):`, error);
        if (error instanceof ApiError) throw error;
        throw new InternalServerError('Failed to rename session chat', error instanceof Error ? error : undefined);
    }
};

// DELETE /api/sessions/:sessionId/chats/:chatId - Delete a session chat
// (Unchanged)
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
