// packages/api/src/api/standaloneChatHandler.ts
import {
  chatRepository,
  messageRepository,
  usageRepository,
} from '@therascript/data';
import { streamChatResponse } from '../services/llamaCppService.js';
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
import { cleanLlmOutput } from '@therascript/services';
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
  request: Request;
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
    throw new NotFoundError(`Standalone chat not found in context.`);
  }
  if (chatData.sessionId !== null) {
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
  request,
}: ElysiaHandlerContext): Promise<Response> => {
  const validatedBody = chatRequestSchema.parse(body);
  const trimmedText = validatedBody.text.trim();
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

    // Standalone: If no configured context size, apply a reasonable default recommendation (e.g., 4096)
    const configured = getConfiguredContextSize();
    const recommendedContext = recommendContextSize({
      transcriptTokens: 0,
      modelDefaultMax: null, // stream layer may still cap to model internally
    });
    // Effective context size for truncation detection
    const effectiveContextSize = configured ?? recommendedContext ?? 8192;

    // Dedicated abort controller for the LLM fetch connection.
    // request.signal in Elysia/Bun does NOT fire on SSE client disconnect —
    // only this controller, which we abort manually on write failure, will stop
    // the underlying fetch to LM Studio and interrupt generation.
    const llmAbortController = new AbortController();
    request.signal?.addEventListener(
      'abort',
      () => llmAbortController.abort(),
      { once: true }
    );

    const llmStream = await streamChatResponse(
      currentMessages,
      configured == null && recommendedContext != null
        ? {
            contextSize: recommendedContext,
            abortSignal: llmAbortController.signal,
          }
        : { abortSignal: llmAbortController.signal }
    );

    const headers = new Headers({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    headers.set('X-User-Message-Id', String(userMessage.id));

    const encoder = new TextEncoder();
    let sseController: ReadableStreamDefaultController<Uint8Array>;
    let sseStreamClosed = false;

    // ReadableStream with a cancel callback — Bun calls cancel() when the HTTP
    // client closes the SSE connection. This is the only reliable disconnect hook.
    const readable = new ReadableStream<Uint8Array>({
      start(controller) {
        sseController = controller;
      },
      cancel() {
        console.log(
          `[API SSE ${chatData.id}] Client disconnected — aborting LLM generation`
        );
        sseStreamClosed = true;
        llmAbortController.abort();
      },
    });

    const writeSseEvent = (data: object) => {
      if (sseStreamClosed) {
        throw new Error('SSE stream closed, aborting stream processing.');
      }
      try {
        sseController.enqueue(
          encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
        );
      } catch (e) {
        sseStreamClosed = true;
        llmAbortController.abort();
        throw new Error('SSE write failed, aborting stream processing.');
      }
    };

    const processStream = async () => {
      let fullAiText = '';
      let finalPromptTokens: number | undefined;
      let finalCompletionTokens: number | undefined;
      let finalThinkingTokens: number | undefined;
      let isTruncated = false;
      let llmStreamError: Error | null = null;
      let llmStartTime = 0;
      let llmDuration = 0;
      let expectedPromptTokens = 0;
      let hasSentRespondingStatus = false;
      let hasOpenThinkingBlock = false;

      try {
        console.log(
          `[API ProcessStream ${chatData.id}] Starting LLM stream processing...`
        );
        await writeSseEvent({ status: 'thinking' });

        try {
          const usage = await computeContextUsageForChat({
            isStandalone: true,
            messages: currentMessages,
          });
          expectedPromptTokens = usage.totals.promptTokens || 0;
          await writeSseEvent({ usage });
        } catch (usageErr) {
          console.warn(
            `[API ProcessStream ${chatData.id}] Failed to compute early usage:`,
            usageErr
          );
        }

        llmStartTime = Date.now();

        // Manually iterate to capture the returned final result properly
        let iterResult = await (llmStream as AsyncGenerator<any, any>).next();

        while (!iterResult.done) {
          const chunk = iterResult.value;
          if (typeof chunk.thinking === 'string') {
            const thinkingChunk = chunk.thinking;
            if (!hasOpenThinkingBlock) {
              fullAiText += '<think>';
              hasOpenThinkingBlock = true;
            }
            fullAiText += thinkingChunk;
            await writeSseEvent({ thinkingChunk });
          }
          if (typeof chunk.content === 'string') {
            if (!hasSentRespondingStatus) {
              hasSentRespondingStatus = true;
              await writeSseEvent({ status: 'responding' });
            }
            if (hasOpenThinkingBlock) {
              fullAiText += '</think>';
              hasOpenThinkingBlock = false;
            }
            const textChunk = chunk.content;
            fullAiText += textChunk;
            await writeSseEvent({ chunk: textChunk });
          }
          iterResult = await (llmStream as AsyncGenerator<any, any>).next();
        }

        // Iteration complete - process returned stream metadata
        const streamResult = iterResult.value;
        if (hasOpenThinkingBlock) {
          fullAiText += '</think>';
          hasOpenThinkingBlock = false;
        }
        finalPromptTokens = streamResult?.promptTokens;
        finalCompletionTokens = streamResult?.completionTokens;
        finalThinkingTokens = streamResult?.thinkingTokens;
        llmDuration = Date.now() - llmStartTime;

        // More conservative truncation detection:
        // Only flag truncation when:
        // 1. Expected prompt is >80% of context (meaningful context pressure)
        // 2. AND actual tokens are significantly lower (>500 token difference)
        // This avoids false positives from tokenizer differences on small prompts
        if (finalPromptTokens && expectedPromptTokens) {
          const contextPressureRatio =
            expectedPromptTokens / effectiveContextSize;
          const tokenDifference = expectedPromptTokens - finalPromptTokens;
          if (contextPressureRatio > 0.8 && tokenDifference > 500) {
            isTruncated = true;
          }
        }

        console.log(
          `[API ProcessStream ${chatData.id}] LLM stream 'done'. Tokens: C=${finalCompletionTokens}, P=${finalPromptTokens}, Duration: ${llmDuration}ms, isTruncated: ${isTruncated}`
        );
        await writeSseEvent({
          done: true,
          promptTokens: finalPromptTokens,
          completionTokens: finalCompletionTokens,
          thinkingTokens: finalThinkingTokens,
          duration: llmDuration,
          isTruncated,
        });
      } catch (streamError) {
        llmStreamError =
          streamError instanceof Error
            ? streamError
            : new Error(String(streamError));
        // Close the generator to trigger its finally block, which cancels the
        // reader and closes the underlying TCP connection to LM Studio.
        (llmStream as AsyncGenerator<any, any>)
          .return(undefined)
          .catch(() => {});
        console.error(
          `[API ProcessStream ${chatData.id}] Error DURING LLM stream iteration:`,
          llmStreamError
        );
        try {
          await writeSseEvent({
            error: 'Stream processing failed on server during LLM interaction.',
          });
        } catch {}
      } finally {
        console.log(
          `[API ProcessStream Finally ${chatData.id}] Cleaning up. LLM stream errored: ${!!llmStreamError}`
        );
        if (hasOpenThinkingBlock) {
          fullAiText += '</think>';
        }
        if (fullAiText.trim()) {
          try {
            const cleanedAiText = cleanLlmOutput(fullAiText);
            const aiMessage = messageRepository.addMessage(
              chatData.id,
              'ai',
              cleanedAiText,
              finalPromptTokens,
              finalCompletionTokens,
              llmStreamError ? null : llmDuration,
              isTruncated
            );

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
                isTruncated: isTruncated,
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
            llmStreamError =
              llmStreamError ||
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
          // Send a done event with an error so the client can clean up
          try {
            await writeSseEvent({
              error:
                'The model returned an empty response. Try again or reduce the context size.',
            });
            await writeSseEvent({
              done: true,
              promptTokens: finalPromptTokens,
              completionTokens: 0,
              duration: llmDuration,
              isTruncated,
            });
          } catch {}
        }

        if (!sseStreamClosed) {
          try {
            sseController.close();
          } catch {}
        }
        console.log(
          `[API ProcessStream Finally ${chatData.id}] Stream cleanup finished.`
        );
      }
    };

    processStream().catch((err) => {
      console.error(
        `[API AddMsg ${chatData.id}] UNHANDLED error from background stream processing task:`,
        err
      );
      if (!sseStreamClosed) {
        try {
          sseController.close();
        } catch {}
      }
    });

    return new Response(readable, {
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
