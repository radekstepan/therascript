/* packages/api/src/api/standaloneChatHandler.ts */
import { chatRepository } from '../repositories/chatRepository.js';
import { streamChatResponse } from '../services/ollamaService.js';
import { NotFoundError, InternalServerError, ApiError, BadRequestError } from '../errors.js';
import type { BackendChatMessage, ChatMetadata, BackendChatSession } from '../types/index.js'; // Added BackendChatSession back for type safety
import { TransformStream } from 'node:stream/web';
import { TextEncoder } from 'node:util';

// Define precise return types matching the schemas where needed
// Add tags to metadata response
type StandaloneChatMetadataResponse = ChatMetadata & { sessionId: null; tags: string[] | null };
type ApiChatMessageResponse = Omit<BackendChatMessage, 'starred'> & { starred: boolean };
type FullStandaloneChatApiResponse = StandaloneChatMetadataResponse & { messages: ApiChatMessageResponse[] };


// POST /api/chats - Create a new standalone chat
export const createStandaloneChat = ({ set }: any): StandaloneChatMetadataResponse => {
    try {
        const newChat: BackendChatSession = chatRepository.createChat(null); // Repo func returns BackendChatSession
        console.log(`[API] Created new standalone chat ${newChat.id}`);
        const { messages, sessionId: _ignoredSessionId, ...chatMetadata } = newChat;
        set.status = 201;
        // Construct the response type correctly, including tags
        const response: StandaloneChatMetadataResponse = {
            id: chatMetadata.id,
            sessionId: null,
            timestamp: chatMetadata.timestamp,
            name: chatMetadata.name ?? null,
            tags: chatMetadata.tags ?? null // Ensure tags is present
        };
        return response;
    } catch (error) {
        console.error(`[API Error] createStandaloneChat:`, error);
        throw new InternalServerError('Failed to create standalone chat', error instanceof Error ? error : undefined);
    }
};

// GET /api/chats - List all standalone chats (metadata only)
export const listStandaloneChats = ({ set }: any): StandaloneChatMetadataResponse[] => {
    try {
        // Repository function now returns the correct type including tags
        const chats = chatRepository.findStandaloneChats();
        set.status = 200;
        // Map to ensure correct final type if needed
        return chats.map(chat => ({
            ...chat, // Spread the chat metadata which includes tags
            sessionId: null, // Ensure sessionId is null
            tags: chat.tags ?? null // Ensure tags is null if missing from repo somehow
        }));
    } catch (error) {
        console.error('[API Error] listStandaloneChats:', error);
        throw new InternalServerError('Failed to list standalone chats', error instanceof Error ? error : undefined);
    }
};


// GET /api/chats/:chatId - Get details of a specific standalone chat
export const getStandaloneChatDetails = ({ chatData, set }: any): FullStandaloneChatApiResponse => {
    // chatData comes from derive hook and should be BackendChatSession type already
    if (!chatData) throw new NotFoundError(`Standalone chat not found in context.`);
    if (chatData.sessionId !== null) {
         console.error(`[API Error] getStandaloneChatDetails: Chat ${chatData.id} has sessionId ${chatData.sessionId}, expected null.`);
         throw new InternalServerError(`Chat ${chatData.id} is not a standalone chat.`);
    }
    set.status = 200;
    const messages = (chatData.messages ?? []).map((m: BackendChatMessage) => ({
        ...m,
        starred: !!m.starred,
        starredName: m.starredName === undefined ? undefined : m.starredName,
    }));
    // chatData already includes tags, separate messages
    const { messages: _m, ...metadata } = chatData;
    // Construct the response ensuring all fields match FullStandaloneChatApiResponse
    const response: FullStandaloneChatApiResponse = {
        id: metadata.id,
        sessionId: null, // Explicitly null
        timestamp: metadata.timestamp,
        name: metadata.name ?? null,
        tags: metadata.tags ?? null, // Include tags
        messages: messages
    };
    return response;
};

// POST /api/chats/:chatId/messages - Add message to standalone chat (Streaming)
export const addStandaloneChatMessage = async ({ chatData, body, set }: any): Promise<Response> => {
    const { text } = body;
    const trimmedText = text.trim();
    let userMessage: BackendChatMessage;
    if (!chatData) throw new NotFoundError(`Standalone chat not found in context.`);
    try {
        userMessage = chatRepository.addMessage(chatData.id, 'user', trimmedText);
        const currentMessages = chatRepository.findMessagesByChatId(chatData.id);
        if (currentMessages.length === 0) throw new InternalServerError(`CRITICAL: Chat ${chatData.id} has no messages after adding one.`);

        const ollamaStream = await streamChatResponse(null, currentMessages); // Pass null for transcript

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
                 throw e; // Re-throw to be caught by processStream's catch
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
                        // No break needed here, the stream ends naturally
                    }
                }
                console.log("[API addStandaloneChatMessage] Stream finished successfully.");

            } catch (streamError) {
                console.error("[API addStandaloneChatMessage] Error processing Ollama stream:", streamError);
                try { await writeSseEvent({ error: 'Stream processing failed on server.' }); } catch {}
                // Abort the writer, which signals an error to the Response stream consumer
                await writer.abort(streamError).catch(e => console.error("Error aborting writer:", e)); // Don't let abort error stop cleanup
                console.error("Aborted writer due to stream error.");
                // Don't re-throw here, let finally handle DB save
            } finally {
                 // Close the writer if it hasn't been closed or aborted already
                  if (!writer.closed && writer.desiredSize !== null) { // Check if it's still lockable
                       try { await writer.close(); } catch(e) { console.warn("Error closing writer in finally (might be expected if aborted):", e); }
                  }
                  // Save the message regardless of stream error, as some content might have been generated
                  if (fullAiText.trim()) {
                     chatRepository.addMessage(
                         chatData.id, 'ai', fullAiText.trim(),
                         finalPromptTokens, finalCompletionTokens // Pass potentially undefined tokens
                     );
                     console.log(`[API addStandaloneChatMessage] Saved AI message (potentially partial) after stream end/error.`);
                 } else {
                      console.warn("[API addStandaloneChatMessage] Stream finished or errored, AI response was empty, not saving.");
                 }
            }
        };

        // Don't await processStream, let it run in the background
        processStream().catch(err => {
             console.error("[API addStandaloneChatMessage] Uncaught background stream processing error:", err);
             // Error is handled within processStream's finally block now
        });

        // Return the readable side of the passthrough stream immediately
        return new Response(passthrough.readable as ReadableStream<Uint8Array>, { status: 200, headers });

    } catch (error) {
        console.error(`[API Error] addStandaloneChatMessage setup failed (Chat ID: ${chatData?.id}):`, error);
        if (error instanceof ApiError) throw error;
        throw new InternalServerError('Failed to setup standalone chat message stream', error instanceof Error ? error : undefined);
    }
};

// PATCH /api/chats/:chatId/messages/:messageId - Update message star status
export const updateStandaloneChatMessageStarStatus = ({ chatData, messageData, body, set }: any): ApiChatMessageResponse => {
    const { starred, starredName } = body;
    if (typeof starred !== 'boolean') throw new BadRequestError("Missing or invalid 'starred' field (boolean).");
    if (starred && typeof starredName !== 'string') throw new BadRequestError("Missing or invalid 'starredName' field (string when starring).");
    if (!starred && starredName !== undefined) console.warn("[API Star] 'starredName' provided but 'starred' is false. Name will be ignored/nulled.");
    if (messageData.sender !== 'user') throw new BadRequestError("Only user messages can be starred.");
    try {
        console.log(`[API Star] Updating msg ${messageData.id} in standalone chat ${chatData.id} to starred=${starred}, name=${starredName}`);
        const updatedMessage = chatRepository.updateMessageStarStatus(messageData.id, starred, starredName);
        if (!updatedMessage) throw new NotFoundError(`Message ${messageData.id} not found during update.`);
        set.status = 200;
        const { starred: starredNum, ...rest } = updatedMessage;
        return { ...rest, starred: !!starredNum, starredName: rest.starredName === undefined ? undefined : rest.starredName };
    } catch (error) {
        console.error(`[API Err] updateStandaloneStar ${messageData?.id}:`, error);
        if (error instanceof ApiError) throw error;
        throw new InternalServerError('Failed update msg star status', error instanceof Error ? error : undefined);
    }
};


// PATCH /api/chats/:chatId/details - Edit chat name and tags
export const editStandaloneChatDetails = ({ chatData, body, set }: any): StandaloneChatMetadataResponse => {
    const { name, tags } = body;
    const nameToSave = (typeof name === 'string' && name.trim() !== '') ? name.trim() : null;
    const validatedTags = Array.isArray(tags) && tags.every(t => typeof t === 'string' && t.trim())
        ? tags.map(t => t.trim()).filter(t => t.length > 0 && t.length <= 50)
        : null;

    if (validatedTags && validatedTags.length > 10) {
        throw new BadRequestError("Cannot save more than 10 tags.");
    }

    // Sort tags alphabetically before saving
    const tagsToSave = validatedTags ? [...validatedTags].sort((a, b) => a.localeCompare(b)) : null;

    try {
        // Pass sorted tags to the repository
        const updatedChatMetadata = chatRepository.updateChatDetails(chatData.id, nameToSave, tagsToSave);
        if (!updatedChatMetadata) throw new NotFoundError(`Chat with ID ${chatData.id} not found during update.`);
        console.log(`[API] Updated details chat ${chatData.id}. Name:"${updatedChatMetadata.name||''}", Tags:${JSON.stringify(updatedChatMetadata.tags)}`);
        set.status = 200;
        // Construct response ensuring correct type (repo returns parsed+sorted tags)
        const response: StandaloneChatMetadataResponse = {
            id: updatedChatMetadata.id,
            sessionId: null,
            timestamp: updatedChatMetadata.timestamp,
            name: updatedChatMetadata.name ?? null,
            tags: updatedChatMetadata.tags ?? null // Use tags from repo response
        };
        return response;
    } catch (error) {
        console.error(`[API Err] editStandaloneDetails ${chatData?.id}:`, error);
        if (error instanceof ApiError) throw error;
        throw new InternalServerError('Failed update standalone chat details', error instanceof Error ? error : undefined);
    }
};

// DELETE /api/chats/:chatId - Delete a standalone chat
export const deleteStandaloneChat = ({ chatData, set }: any): { message: string } => {
    try {
        const deleted = chatRepository.deleteChatById(chatData.id);
        if (!deleted) throw new NotFoundError(`Chat ${chatData.id} not found during deletion.`);
        console.log(`[API] Deleted standalone chat ${chatData.id}`);
        set.status = 200;
        return { message: `Chat ${chatData.id} deleted successfully.` }; // Adjusted message
    } catch (error) {
        console.error(`[API Err] deleteStandaloneChat ${chatData?.id}:`, error);
        if (error instanceof ApiError) throw error;
        throw new InternalServerError('Failed delete standalone chat', error instanceof Error ? error : undefined);
    }
};
