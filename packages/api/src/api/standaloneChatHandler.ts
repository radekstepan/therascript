// packages/api/src/api/standaloneChatHandler.ts
import { chatRepository } from '../repositories/chatRepository.js';
import { messageRepository } from '../repositories/messageRepository.js';
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
  BackendSession,
} from '../types/index.js'; // Added BackendSession
import { TransformStream } from 'node:stream/web';
import { TextEncoder } from 'node:util';
import {
  getElasticsearchClient,
  MESSAGES_INDEX,
  indexDocument,
  deleteByQuery,
  bulkIndexDocuments, // For updating multiple messages on chat detail change
} from '@therascript/elasticsearch-client';
import config from '../config/index.js';
import { cleanLlmOutput } from '../utils/helpers.js';

const esClient = getElasticsearchClient(config.elasticsearch.url);

// Define precise return types matching the schemas where needed
type StandaloneChatMetadataResponse = ChatMetadata & {
  sessionId: null;
  tags: string[] | null;
};
type ApiChatMessageResponse = BackendChatMessage;
type FullStandaloneChatApiResponse = StandaloneChatMetadataResponse & {
  messages: ApiChatMessageResponse[];
};

// Define a type for Elysia context if not already available globally in your project
interface ElysiaHandlerContext {
  body: any;
  params: Record<string, string | undefined>;
  query: Record<string, string | undefined>;
  set: { status?: number | string; headers?: Record<string, string> };
  // These are added by 'derive' hooks if used for these routes
  chatData?: BackendChatSession;
  messageData?: BackendChatMessage;
  // sessionData is not typically used in standalone chat handlers
}

export const createStandaloneChat = ({
  set,
}: ElysiaHandlerContext): StandaloneChatMetadataResponse => {
  try {
    const newChat: BackendChatSession = chatRepository.createChat(null); // sessionId is null for standalone
    console.log(`[API] Created new standalone chat ${newChat.id}`);
    // Destructure messages and sessionId (which will be null) to get the metadata
    const { messages, sessionId: _ignoredSessionId, ...chatMetadata } = newChat;
    set.status = 201;
    // Construct the response type correctly, including tags
    const response: StandaloneChatMetadataResponse = {
      id: chatMetadata.id,
      sessionId: null, // Explicitly null for standalone
      timestamp: chatMetadata.timestamp,
      name: chatMetadata.name ?? null, // Handle potential undefined from repo
      tags: chatMetadata.tags ?? null, // Ensure tags is present, defaulting to null
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

export const listStandaloneChats = ({
  set,
}: ElysiaHandlerContext): StandaloneChatMetadataResponse[] => {
  try {
    const chats = chatRepository.findStandaloneChats(); // This should return the correct type including tags
    set.status = 200;
    // Map to ensure correct final type, especially sessionId being null
    return chats.map((chat) => ({
      ...chat, // Spread the chat metadata which includes tags
      sessionId: null, // Ensure sessionId is explicitly null
      tags: chat.tags ?? null, // Default to null if undefined
    }));
  } catch (error) {
    console.error('[API Error] listStandaloneChats:', error);
    throw new InternalServerError(
      'Failed to list standalone chats',
      error instanceof Error ? error : undefined
    );
  }
};

export const getStandaloneChatDetails = ({
  chatData,
  set,
}: ElysiaHandlerContext): FullStandaloneChatApiResponse => {
  if (!chatData) {
    // This should ideally be caught by a derive hook if chatData is expected
    throw new NotFoundError(`Standalone chat not found in context.`);
  }
  if (chatData.sessionId !== null) {
    // Defensive check, should also be handled by how chatData is derived/fetched
    console.error(
      `[API Error] getStandaloneChatDetails: Chat ${chatData.id} has sessionId ${chatData.sessionId}, expected null.`
    );
    throw new InternalServerError(
      `Chat ${chatData.id} is not a standalone chat.`
    );
  }
  set.status = 200;
  const messages = (chatData.messages ?? []).map((m: BackendChatMessage) => m);
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

export const addStandaloneChatMessage = async ({
  chatData,
  body,
  set,
}: ElysiaHandlerContext): Promise<Response> => {
  const { text } = body as { text: string }; // Type assertion for body
  const trimmedText = text.trim();
  let userMessage: BackendChatMessage;

  if (!chatData) {
    throw new NotFoundError(`Standalone chat not found for adding message.`);
  }

  try {
    userMessage = messageRepository.addMessage(
      chatData.id,
      'user',
      trimmedText
    );
    // Index user message into Elasticsearch
    await indexDocument(esClient, MESSAGES_INDEX, String(userMessage.id), {
      message_id: String(userMessage.id),
      chat_id: userMessage.chatId,
      session_id: null, // Standalone chats have no session_id
      sender: userMessage.sender,
      text: userMessage.text,
      timestamp: userMessage.timestamp,
      // For standalone chats, include chat_name and tags if available from chatData
      chat_name: chatData.name ?? null,
      tags: chatData.tags ?? null,
      // client_name and session_name are null for standalone chats
      client_name: null,
      session_name: null,
    });
    console.log(
      `[API ES] Indexed User message ${userMessage.id} for standalone chat ${chatData.id}.`
    );

    const currentMessages = messageRepository.findMessagesByChatId(chatData.id);
    if (currentMessages.length === 0) {
      throw new InternalServerError(
        `CRITICAL: Chat ${chatData.id} has no messages immediately after adding one.`
      );
    }

    const ollamaStream = await streamChatResponse(null, currentMessages); // Pass null for transcript context

    const headers = new Headers({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    headers.set('X-User-Message-Id', String(userMessage.id));

    const passthrough = new TransformStream<Uint8Array, Uint8Array>();
    const writer = passthrough.writable.getWriter();
    const encoder = new TextEncoder();

    const writeSseEvent = async (data: object) => {
      try {
        await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      } catch (e) {
        console.warn(
          `[API SSE Write Error ${chatData.id}]: Failed to write to stream (client likely disconnected):`,
          e
        );
        throw new Error('SSE write failed, aborting stream processing.');
      }
    };

    const processStream = async () => {
      let fullAiText = '';
      let finalPromptTokens: number | undefined;
      let finalCompletionTokens: number | undefined;
      let ollamaStreamError: Error | null = null;

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
              `[API ProcessStream ${chatData.id}] Ollama stream 'done'. Tokens: C=${finalCompletionTokens}, P=${finalPromptTokens}`
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
        if (fullAiText.trim()) {
          try {
            const cleanedAiText = cleanLlmOutput(fullAiText);
            const aiMessage = messageRepository.addMessage(
              chatData.id,
              'ai',
              cleanedAiText,
              finalPromptTokens,
              finalCompletionTokens
            );
            // Index AI message into Elasticsearch
            await indexDocument(
              esClient,
              MESSAGES_INDEX,
              String(aiMessage.id),
              {
                message_id: String(aiMessage.id),
                chat_id: aiMessage.chatId,
                session_id: null,
                sender: aiMessage.sender,
                text: aiMessage.text,
                timestamp: aiMessage.timestamp,
                promptTokens: aiMessage.promptTokens,
                completionTokens: aiMessage.completionTokens,
                chat_name: chatData.name ?? null,
                tags: chatData.tags ?? null,
                client_name: null,
                session_name: null,
              }
            );
            console.log(
              `[API ES] Indexed AI message ${aiMessage.id} for standalone chat ${chatData.id}.`
            );
            console.log(
              `[API ProcessStream Finally ${chatData.id}] Saved AI message (length: ${cleanedAiText.length}) to DB.`
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

        if (ollamaStreamError) {
          await writer
            .abort(ollamaStreamError)
            .catch((e) =>
              console.warn(
                `[API ProcessStream Finally ${chatData.id}] Error aborting writer:`,
                e
              )
            );
        } else {
          await writer
            .close()
            .catch((e) =>
              console.warn(
                `[API ProcessStream Finally ${chatData.id}] Error closing writer:`,
                e
              )
            );
        }
        console.log(
          `[API ProcessStream Finally ${chatData.id}] Writer cleanup attempt finished.`
        );
      }
    };

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

    return new Response(passthrough.readable as any, { status: 200, headers });
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

export const editStandaloneChatDetails = async ({
  chatData,
  body,
  set,
}: ElysiaHandlerContext): Promise<StandaloneChatMetadataResponse> => {
  const { name, tags } = body as {
    name?: string | null;
    tags?: string[] | null;
  };
  const nameToSave =
    typeof name === 'string' && name.trim() !== '' ? name.trim() : null;
  const validatedTags =
    Array.isArray(tags) && tags.every((t) => typeof t === 'string' && t.trim())
      ? tags.map((t) => t.trim()).filter((t) => t.length > 0 && t.length <= 50)
      : null;

  if (validatedTags && validatedTags.length > 10) {
    throw new BadRequestError('Cannot save more than 10 tags.');
  }
  const tagsToSave = validatedTags
    ? [...validatedTags].sort((a, b) => a.localeCompare(b))
    : null;

  if (!chatData) {
    throw new NotFoundError('Chat data context missing for edit.');
  }

  try {
    const originalChatName = chatData.name ?? null;
    const originalChatTags = chatData.tags ?? null;

    const updatedChatMetadata = chatRepository.updateChatDetails(
      chatData.id,
      nameToSave,
      tagsToSave
    );
    if (!updatedChatMetadata) {
      throw new NotFoundError(
        `Chat with ID ${chatData.id} not found during update.`
      );
    }

    // Update Elasticsearch documents for this chat if name or tags changed
    const nameChanged = nameToSave !== originalChatName;
    const tagsChanged =
      JSON.stringify(tagsToSave) !==
      JSON.stringify(
        originalChatTags?.sort((a, b) => a.localeCompare(b)) ?? null
      );

    if (nameChanged || tagsChanged) {
      console.log(
        `[API ES Update] Standalone chat metadata changed for ${chatData.id}, re-indexing messages.`
      );
      const messages = messageRepository.findMessagesByChatId(chatData.id);
      const updateOps = messages
        .map((m) => [
          { update: { _index: MESSAGES_INDEX, _id: String(m.id) } },
          {
            doc: {
              chat_name: updatedChatMetadata.name,
              tags: updatedChatMetadata.tags,
            },
          },
        ])
        .flat();

      if (updateOps.length > 0) {
        await esClient.bulk({ refresh: true, operations: updateOps });
        console.log(
          `[API ES Update] Updated ${messages.length} messages in ES for chat ${chatData.id}.`
        );
      }
    }

    console.log(
      `[API] Updated details chat ${chatData.id}. Name:"${updatedChatMetadata.name || ''}", Tags:${JSON.stringify(updatedChatMetadata.tags)}`
    );
    set.status = 200;
    const response: StandaloneChatMetadataResponse = {
      id: updatedChatMetadata.id,
      sessionId: null,
      timestamp: updatedChatMetadata.timestamp,
      name: updatedChatMetadata.name ?? null,
      tags: updatedChatMetadata.tags ?? null,
    };
    return response;
  } catch (error) {
    console.error(`[API Err] editStandaloneDetails ${chatData?.id}:`, error);
    if (
      (error as any).meta?.body?.error?.type ===
      'version_conflict_engine_exception'
    ) {
      console.warn(`[API ES Update] Version conflict for chat ${chatData?.id}`);
    }
    if (error instanceof ApiError) throw error;
    throw new InternalServerError(
      'Failed update standalone chat details',
      error instanceof Error ? error : undefined
    );
  }
};

export const deleteStandaloneChat = async ({
  chatData,
  set,
}: ElysiaHandlerContext): Promise<{ message: string }> => {
  if (!chatData) {
    throw new NotFoundError('Chat data context missing for delete.');
  }
  try {
    const deleted = chatRepository.deleteChatById(chatData.id);
    if (!deleted) {
      throw new NotFoundError(`Chat ${chatData.id} not found during deletion.`);
    }

    // Delete associated messages from Elasticsearch
    await deleteByQuery(esClient, MESSAGES_INDEX, {
      term: { chat_id: chatData.id },
    });
    console.log(
      `[API ES] Deleted Elasticsearch messages for standalone chat ${chatData.id}.`
    );

    console.log(`[API] Deleted standalone chat ${chatData.id}`);
    set.status = 200;
    return { message: `Chat ${chatData.id} deleted successfully.` };
  } catch (error) {
    console.error(`[API Err] deleteStandaloneChat ${chatData?.id}:`, error);
    if (error instanceof ApiError) throw error;
    throw new InternalServerError(
      'Failed delete standalone chat',
      error instanceof Error ? error : undefined
    );
  }
};
