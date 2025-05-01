// =========================================
// File: packages/api/src/api/standaloneChatHandler.ts
// (Refined processStream function)
// =========================================
/* packages/api/src/api/standaloneChatHandler.ts */
import { chatRepository } from '../repositories/chatRepository.js';
import { messageRepository } from '../repositories/messageRepository.js'; // <-- Import Message Repo
import { streamChatResponse } from '../services/ollamaService.js';
import {
  NotFoundError,
  InternalServerError,
  ApiError,
  BadRequestError,
} from '../errors.js';
import type {
  BackendChatMessage,
  ChatMetadata,
  BackendChatSession,
} from '../types/index.js'; // Added BackendChatSession back for type safety
import { TransformStream } from 'node:stream/web';
import { TextEncoder } from 'node:util';

// Define precise return types matching the schemas where needed
// Add tags to metadata response
type StandaloneChatMetadataResponse = ChatMetadata & {
  sessionId: null;
  tags: string[] | null;
};
type ApiChatMessageResponse = Omit<BackendChatMessage, 'starred'> & {
  starred: boolean;
};
type FullStandaloneChatApiResponse = StandaloneChatMetadataResponse & {
  messages: ApiChatMessageResponse[];
};

// POST /api/chats - Create a new standalone chat
export const createStandaloneChat = ({
  set,
}: any): StandaloneChatMetadataResponse => {
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
      tags: chatMetadata.tags ?? null, // Ensure tags is present
    };
    return response;
  } catch (error) {
    console.error(`[API Error] createStandaloneChat:`, error);
    throw new InternalServerError(
      'Failed to create standalone chat',
      error instanceof Error ? error : undefined
    );
  }
};

// GET /api/chats - List all standalone chats (metadata only)
export const listStandaloneChats = ({
  set,
}: any): StandaloneChatMetadataResponse[] => {
  try {
    // Repository function now returns the correct type including tags
    const chats = chatRepository.findStandaloneChats();
    set.status = 200;
    // Map to ensure correct final type if needed
    return chats.map((chat) => ({
      ...chat, // Spread the chat metadata which includes tags
      sessionId: null, // Ensure sessionId is null
      tags: chat.tags ?? null, // Ensure tags is null if missing from repo somehow
    }));
  } catch (error) {
    console.error('[API Error] listStandaloneChats:', error);
    throw new InternalServerError(
      'Failed to list standalone chats',
      error instanceof Error ? error : undefined
    );
  }
};

// GET /api/chats/:chatId - Get details of a specific standalone chat
export const getStandaloneChatDetails = ({
  chatData,
  set,
}: any): FullStandaloneChatApiResponse => {
  // chatData comes from derive hook and should be BackendChatSession type already
  if (!chatData)
    throw new NotFoundError(`Standalone chat not found in context.`);
  if (chatData.sessionId !== null) {
    console.error(
      `[API Error] getStandaloneChatDetails: Chat ${chatData.id} has sessionId ${chatData.sessionId}, expected null.`
    );
    throw new InternalServerError(
      `Chat ${chatData.id} is not a standalone chat.`
    );
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
    messages: messages,
  };
  return response;
};

// POST /api/chats/:chatId/messages - Add message to standalone chat (Streaming)
export const addStandaloneChatMessage = async ({
  chatData,
  body,
  set,
}: any): Promise<Response> => {
  const { text } = body;
  const trimmedText = text.trim();
  let userMessage: BackendChatMessage;
  if (!chatData)
    throw new NotFoundError(`Standalone chat not found in context.`);
  try {
    userMessage = messageRepository.addMessage(
      chatData.id,
      'user',
      trimmedText
    ); // <-- Use messageRepository
    const currentMessages = messageRepository.findMessagesByChatId(chatData.id); // <-- Use messageRepository
    if (currentMessages.length === 0)
      throw new InternalServerError(
        `CRITICAL: Chat ${chatData.id} has no messages after adding one.`
      );

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
        // Check if writer is already closed or closing before writing
        await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      } catch (e) {
        console.warn(
          `[API SSE Write Error ${chatData.id}]: Failed to write to stream (client likely disconnected):`,
          e
        );
        throw new Error('SSE write failed, aborting stream processing.');
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
        console.log(
          `[API ProcessStream ${chatData.id}] Starting Ollama stream processing...`
        );
        for await (const chunk of ollamaStream) {
          if (chunk.message?.content) {
            const textChunk = chunk.message.content;
            fullAiText += textChunk;
            await writeSseEvent({ chunk: textChunk });
          }
          if (chunk.done) {
            finalPromptTokens = chunk.prompt_eval_count;
            finalCompletionTokens = chunk.eval_count;
            console.log(
              `[API ProcessStream ${chatData.id}] Ollama stream 'done' signal received. Tokens: C=${finalCompletionTokens}, P=${finalPromptTokens}`
            );
            await writeSseEvent({
              done: true,
              promptTokens: finalPromptTokens,
              completionTokens: finalCompletionTokens,
            });
          }
        }
        console.log(
          `[API ProcessStream ${chatData.id}] Finished iterating Ollama stream successfully.`
        );
      } catch (streamError: any) {
        ollamaStreamError =
          streamError instanceof Error
            ? streamError
            : new Error(String(streamError));
        console.error(
          `[API ProcessStream ${chatData.id}] Error DURING Ollama stream iteration:`,
          ollamaStreamError
        );
        try {
          await writeSseEvent({
            error: 'Stream processing failed on server during LLM interaction.',
          });
        } catch {}
      } finally {
        console.log(
          `[API ProcessStream Finally ${chatData.id}] Cleaning up. Ollama stream errored: ${!!ollamaStreamError}`
        );
        // --- Database Saving ---
        if (fullAiText.trim()) {
          try {
            messageRepository.addMessage(
              // <-- Use messageRepository
              chatData.id,
              'ai',
              fullAiText.trim(),
              finalPromptTokens,
              finalCompletionTokens // Pass potentially undefined tokens
            );
            console.log(
              `[API ProcessStream Finally ${chatData.id}] Saved AI message (length: ${fullAiText.trim().length}) to DB.`
            );
          } catch (dbError) {
            console.error(
              `[API ProcessStream Finally ${chatData.id}] CRITICAL: Failed to save AI message to DB:`,
              dbError
            );
            ollamaStreamError =
              ollamaStreamError ||
              new InternalServerError(
                'Failed to save AI response to database.',
                dbError instanceof Error ? dbError : undefined
              );
            try {
              await writeSseEvent({
                error: 'Failed to save final AI response.',
              });
            } catch {}
          }
        } else {
          console.warn(
            `[API ProcessStream Finally ${chatData.id}] No AI text generated or saved.`
          );
        }
        // --- Ensure Writer Closure ---
        if (ollamaStreamError) {
          console.log(
            `[API ProcessStream Finally ${chatData.id}] Aborting writer due to error.`
          );
          await writer
            .abort(ollamaStreamError)
            .catch((e) =>
              console.warn(
                `[API ProcessStream Finally ${chatData.id}] Error aborting writer (may be expected):`,
                e
              )
            );
        } else {
          console.log(
            `[API ProcessStream Finally ${chatData.id}] Closing writer normally.`
          );
          await writer
            .close()
            .catch((e) =>
              console.warn(
                `[API ProcessStream Finally ${chatData.id}] Error closing writer (may be expected):`,
                e
              )
            );
        }
        console.log(
          `[API ProcessStream Finally ${chatData.id}] Writer cleanup attempt finished.`
        );
      }
    };
    // --- End Refined processStream ---

    // Run processStream in the background, don't await it here
    processStream().catch((err) => {
      console.error(
        `[API AddMsg ${chatData.id}] UNHANDLED error from background stream processing task:`,
        err
      );
      if (writer && !writer.closed) {
        writer
          .abort(err)
          .catch((abortErr) =>
            console.error('Error aborting writer in outer catch:', abortErr)
          );
      }
    });

    // Return the readable side of the passthrough stream immediately
    return new Response(passthrough.readable as ReadableStream<Uint8Array>, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error(
      `[API Error] addStandaloneChatMessage setup failed (Chat ID: ${chatData?.id}):`,
      error
    );
    if (error instanceof ApiError) throw error;
    throw new InternalServerError(
      'Failed to setup standalone chat message stream',
      error instanceof Error ? error : undefined
    );
  }
};

// PATCH /api/chats/:chatId/messages/:messageId - Update message star status
export const updateStandaloneChatMessageStarStatus = ({
  chatData,
  messageData,
  body,
  set,
}: any): ApiChatMessageResponse => {
  const { starred, starredName } = body;
  if (typeof starred !== 'boolean')
    throw new BadRequestError("Missing or invalid 'starred' field (boolean).");
  if (starred && typeof starredName !== 'string')
    throw new BadRequestError(
      "Missing or invalid 'starredName' field (string when starring)."
    );
  if (!starred && starredName !== undefined)
    console.warn(
      "[API Star] 'starredName' provided but 'starred' is false. Name will be ignored/nulled."
    );
  if (messageData.sender !== 'user')
    throw new BadRequestError('Only user messages can be starred.');
  try {
    console.log(
      `[API Star] Updating msg ${messageData.id} in standalone chat ${chatData.id} to starred=${starred}, name=${starredName}`
    );
    const updatedMessage = messageRepository.updateMessageStarStatus(
      messageData.id,
      starred,
      starredName
    ); // <-- Use messageRepository
    if (!updatedMessage)
      throw new NotFoundError(
        `Message ${messageData.id} not found during update.`
      );
    set.status = 200;
    const { starred: starredNum, ...rest } = updatedMessage;
    return {
      ...rest,
      starred: !!starredNum,
      starredName:
        rest.starredName === undefined ? undefined : rest.starredName,
    };
  } catch (error) {
    console.error(`[API Err] updateStandaloneStar ${messageData?.id}:`, error);
    if (error instanceof ApiError) throw error;
    throw new InternalServerError(
      'Failed update msg star status',
      error instanceof Error ? error : undefined
    );
  }
};

// PATCH /api/chats/:chatId/details - Edit chat name and tags
export const editStandaloneChatDetails = ({
  chatData,
  body,
  set,
}: any): StandaloneChatMetadataResponse => {
  const { name, tags } = body;
  const nameToSave =
    typeof name === 'string' && name.trim() !== '' ? name.trim() : null;
  const validatedTags =
    Array.isArray(tags) && tags.every((t) => typeof t === 'string' && t.trim())
      ? tags.map((t) => t.trim()).filter((t) => t.length > 0 && t.length <= 50)
      : null;

  if (validatedTags && validatedTags.length > 10) {
    throw new BadRequestError('Cannot save more than 10 tags.');
  }

  // Sort tags alphabetically before saving
  const tagsToSave = validatedTags
    ? [...validatedTags].sort((a, b) => a.localeCompare(b))
    : null;

  try {
    // Pass sorted tags to the repository
    const updatedChatMetadata = chatRepository.updateChatDetails(
      chatData.id,
      nameToSave,
      tagsToSave
    );
    if (!updatedChatMetadata)
      throw new NotFoundError(
        `Chat with ID ${chatData.id} not found during update.`
      );
    console.log(
      `[API] Updated details chat ${chatData.id}. Name:"${updatedChatMetadata.name || ''}", Tags:${JSON.stringify(updatedChatMetadata.tags)}`
    );
    set.status = 200;
    // Construct response ensuring correct type (repo returns parsed+sorted tags)
    const response: StandaloneChatMetadataResponse = {
      id: updatedChatMetadata.id,
      sessionId: null,
      timestamp: updatedChatMetadata.timestamp,
      name: updatedChatMetadata.name ?? null,
      tags: updatedChatMetadata.tags ?? null, // Use tags from repo response
    };
    return response;
  } catch (error) {
    console.error(`[API Err] editStandaloneDetails ${chatData?.id}:`, error);
    if (error instanceof ApiError) throw error;
    throw new InternalServerError(
      'Failed update standalone chat details',
      error instanceof Error ? error : undefined
    );
  }
};

// DELETE /api/chats/:chatId - Delete a standalone chat
export const deleteStandaloneChat = ({
  chatData,
  set,
}: any): { message: string } => {
  try {
    const deleted = chatRepository.deleteChatById(chatData.id);
    if (!deleted)
      throw new NotFoundError(`Chat ${chatData.id} not found during deletion.`);
    console.log(`[API] Deleted standalone chat ${chatData.id}`);
    set.status = 200;
    return { message: `Chat ${chatData.id} deleted successfully.` }; // Adjusted message
  } catch (error) {
    console.error(`[API Err] deleteStandaloneChat ${chatData?.id}:`, error);
    if (error instanceof ApiError) throw error;
    throw new InternalServerError(
      'Failed delete standalone chat',
      error instanceof Error ? error : undefined
    );
  }
};
