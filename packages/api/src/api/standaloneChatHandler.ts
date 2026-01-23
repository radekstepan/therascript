// packages/api/src/api/standaloneChatHandler.ts
import {
  chatRepository,
  messageRepository,
  usageRepository,
} from '@therascript/data';
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
} from '@therascript/domain';
import { TransformStream } from 'node:stream/web';
import { TextEncoder } from 'node:util';
import {
  getElasticsearchClient,
  MESSAGES_INDEX,
  indexDocument,
  deleteByQuery,
  bulkIndexDocuments,
} from '@therascript/elasticsearch-client';
import config from '@therascript/config';
// ============================= FIX START ==============================
import { cleanLlmOutput } from '@therascript/services';
// ============================== FIX END ===============================
import {
  computeContextUsageForChat,
  recommendContextSize,
} from '../services/contextUsageService.js';
import {
  getConfiguredContextSize,
  getActiveModel,
} from '../services/activeModelService.js';
import {
  type ChatRequest,
  type RenameChatRequest,
  chatRequestSchema,
  renameChatRequestSchema,
} from '@therascript/domain';

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

// Define a type for Elysia context with proper typing
interface ElysiaHandlerContext {
  body: unknown;
  params: Record<string, string | undefined>;
  query: Record<string, string | undefined>;
  set: { status?: number | string; headers?: Record<string, string> };
  signal?: AbortSignal;
  chatData?: BackendChatSession;
  messageData?: BackendChatMessage;
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
  signal,
}: ElysiaHandlerContext): Promise<Response> => {
  const validatedBody = chatRequestSchema.parse(body);
  const trimmedText = validatedBody.text.trim();
  let userMessage: BackendChatMessage;

  if (!chatData) {
    throw new NotFoundError(`Standalone chat not found for adding message.`);
  }

  try {
    // ============================= FIX START ==============================
    // Fix the history concatenation bug by only saving the new message text.
    userMessage = messageRepository.addMessage(
      chatData.id,
      'user',
      trimmedText
    );
    // ============================== FIX END ===============================

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

    // Standalone: If no configured context size, apply a reasonable default recommendation (e.g., 4096)
    const configured = getConfiguredContextSize();
    const recommendedContext = recommendContextSize({
      transcriptTokens: 0,
      modelDefaultMax: null, // stream layer may still cap to model internally
    });

    const ollamaStream = await streamChatResponse(
      null,
      currentMessages,
      configured == null && recommendedContext != null
        ? { contextSize: recommendedContext, signal }
        : { signal }
    ); // Pass null for transcript context

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
      let llmStartTime = 0;
      let llmDuration = 0;

      try {
        console.log(
          `[API ProcessStream ${chatData.id}] Starting Ollama stream processing...`
        );
        // Emit early usage estimate for UI meter (LM Studio–style)
        try {
          const usage = await computeContextUsageForChat({
            isStandalone: true,
            messages: currentMessages,
          });
          await writeSseEvent({ usage });
        } catch (usageErr) {
          console.warn(
            `[API ProcessStream ${chatData.id}] Failed to compute early usage:`,
            usageErr
          );
        }
        llmStartTime = Date.now();
        for await (const chunk of ollamaStream) {
          if (chunk.message?.content) {
            const textChunk = chunk.message.content;
            fullAiText += textChunk;
            await writeSseEvent({ chunk: textChunk });
          }
          if (chunk.done) {
            finalPromptTokens = chunk.prompt_eval_count;
            finalCompletionTokens = chunk.eval_count;
            llmDuration = Date.now() - llmStartTime;
            console.log(
              `[API ProcessStream ${chatData.id}] Ollama stream 'done'. Tokens: C=${finalCompletionTokens}, P=${finalPromptTokens}, Duration: ${llmDuration}ms`
            );
            await writeSseEvent({
              done: true,
              promptTokens: finalPromptTokens,
              completionTokens: finalCompletionTokens,
              duration: llmDuration,
            });
          }
        }
        console.log(
          `[API ProcessStream ${chatData.id}] Finished iterating Ollama stream successfully.`
        );
      } catch (streamError) {
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
            // ============================= FIX START ==============================
            // Clean the final AI response before saving to database.
            const cleanedAiText = cleanLlmOutput(fullAiText);
            const aiMessage = messageRepository.addMessage(
              chatData.id,
              'ai',
              cleanedAiText,
              finalPromptTokens,
              finalCompletionTokens,
              ollamaStreamError ? null : llmDuration
            );
            // ============================== FIX END ===============================

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

            try {
              usageRepository.insertUsageLog({
                type: 'llm',
                source: 'standalone_chat',
                model: getActiveModel(),
                promptTokens: aiMessage.promptTokens,
                completionTokens: aiMessage.completionTokens,
                duration: llmDuration,
              });
            } catch (err) {
              console.warn(
                `[API ProcessStream Finally ${chatData.id}] Failed to log usage:`,
                err
              );
            }
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

export const editStandaloneChatDetails = async ({
  chatData,
  body,
  set,
}: ElysiaHandlerContext): Promise<StandaloneChatMetadataResponse> => {
  const validatedBody = renameChatRequestSchema.parse(body);
  const { name, tags } = validatedBody;
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
    const esError = error as {
      meta?: { body?: { error?: { type?: string } } };
    };
    if (
      esError.meta?.body?.error?.type === 'version_conflict_engine_exception'
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
