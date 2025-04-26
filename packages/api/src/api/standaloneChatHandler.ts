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
// (Unchanged)
export const addStandaloneChatMessage = async ({ chatData, body, set }: any): Promise<Response> => {
    const { text } = body; const trimmedText = text.trim(); let userMessage: BackendChatMessage;
    if (!chatData) throw new NotFoundError(`Standalone chat not found in context.`);
    try { userMessage = chatRepository.addMessage(chatData.id, 'user', trimmedText); const currentMessages = chatRepository.findMessagesByChatId(chatData.id); if (currentMessages.length === 0) throw new InternalServerError(`CRITICAL: Chat ${chatData.id} has no messages after adding one.`); const ollamaStream = await streamChatResponse(null, currentMessages); const headers = new Headers({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-User-Message-Id': String(userMessage.id) }); const passthrough = new TransformStream<Uint8Array, Uint8Array>(); const writer = passthrough.writable.getWriter(); const encoder = new TextEncoder(); const writeSseEvent = async (data: object) => { try { await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); } catch (e) { console.error("SSE Write Error:", e); throw e; } }; const processStream = async () => { let fullAiText = ''; let fPT:number|undefined; let fCT:number|undefined; try { for await (const chunk of ollamaStream) { if(chunk.message?.content){fullAiText+=chunk.message.content; await writeSseEvent({chunk:chunk.message.content});} if(chunk.done){fPT=chunk.prompt_eval_count; fCT=chunk.eval_count; await writeSseEvent({done:true, promptTokens:fPT, completionTokens:fCT});}}} catch (err){console.error("Stream processing error:",err); try{await writeSseEvent({error:'Stream failed'});}catch{} await writer.abort(err);} finally { if(!writer.closed && writer.desiredSize!==null){try{await writer.close();}catch{}} if(fullAiText.trim()){ chatRepository.addMessage(chatData.id, 'ai', fullAiText.trim(), fPT, fCT); }}}; processStream().catch(e => console.error("Uncaught stream processing error:",e)); return new Response(passthrough.readable as any, { status: 200, headers }); } catch (error) { console.error(`[API Err] addStandaloneMsg ${chatData?.id}:`, error); if (error instanceof ApiError) throw error; throw new InternalServerError('Failed setup standalone chat msg stream', error instanceof Error ? error : undefined); }
};

// PATCH /api/chats/:chatId/messages/:messageId - Update message star status
// (Unchanged)
export const updateStandaloneChatMessageStarStatus = ({ chatData, messageData, body, set }: any): ApiChatMessageResponse => {
    const { starred, starredName } = body;
    if (typeof starred !== 'boolean') throw new BadRequestError("Missing/invalid 'starred' (boolean).");
    if (starred && typeof starredName !== 'string') throw new BadRequestError("Missing/invalid 'starredName' (string).");
    if (!starred && starredName !== undefined) console.warn("[API Star] 'starredName' provided but 'starred' false.");
    if (messageData.sender !== 'user') throw new BadRequestError("Only user messages can be starred.");
    try { const updatedMessage = chatRepository.updateMessageStarStatus(messageData.id, starred, starredName); if (!updatedMessage) throw new NotFoundError(`Message ${messageData.id} not found.`); set.status = 200; const { starred: starredNum, ...rest } = updatedMessage; return { ...rest, starred: !!starredNum, starredName: rest.starredName === undefined ? undefined : rest.starredName }; } catch (error) { console.error(`[API Err] updateStandaloneStar ${messageData?.id}:`, error); if (error instanceof ApiError) throw error; throw new InternalServerError('Failed update msg star status', error instanceof Error ? error : undefined); }
};


// PATCH /api/chats/:chatId/details - Edit chat name and tags
export const editStandaloneChatDetails = ({ chatData, body, set }: any): StandaloneChatMetadataResponse => {
    const { name, tags } = body;
    const nameToSave = (typeof name === 'string' && name.trim() !== '') ? name.trim() : null;
    const tagsToSave = Array.isArray(tags) && tags.every(t => typeof t === 'string' && t.trim()) ? tags.map(t => t.trim()).filter(t => t.length > 0 && t.length <= 50) : null;
    if (tagsToSave && tagsToSave.length > 10) throw new BadRequestError("Cannot save more than 10 tags.");

    try {
        const updatedChatMetadata = chatRepository.updateChatDetails(chatData.id, nameToSave, tagsToSave);
        if (!updatedChatMetadata) throw new NotFoundError(`Chat ${chatData.id} not found during update.`);
        console.log(`[API] Updated details chat ${chatData.id}. Name:"${updatedChatMetadata.name||''}", Tags:${JSON.stringify(updatedChatMetadata.tags)}`);
        set.status = 200;
        // Construct response ensuring correct type
        const response: StandaloneChatMetadataResponse = {
            id: updatedChatMetadata.id,
            sessionId: null,
            timestamp: updatedChatMetadata.timestamp,
            name: updatedChatMetadata.name ?? null,
            tags: updatedChatMetadata.tags ?? null
        };
        return response;
    } catch (error) {
        console.error(`[API Err] editStandaloneDetails ${chatData?.id}:`, error);
        if (error instanceof ApiError) throw error;
        throw new InternalServerError('Failed update standalone chat details', error instanceof Error ? error : undefined);
    }
};

// DELETE /api/chats/:chatId - Delete a standalone chat
// (Unchanged)
export const deleteStandaloneChat = ({ chatData, set }: any): { message: string } => {
    try { const deleted = chatRepository.deleteChatById(chatData.id); if (!deleted) throw new NotFoundError(`Chat ${chatData.id} not found.`); console.log(`[API] Deleted standalone chat ${chatData.id}`); set.status = 200; return { message: `Chat ${chatData.id} deleted.` }; } catch (error) { console.error(`[API Err] deleteStandaloneChat ${chatData?.id}:`, error); if (error instanceof ApiError) throw error; throw new InternalServerError('Failed delete standalone chat', error instanceof Error ? error : undefined); }
};
