// packages/api/src/api/sessionChatHandler.ts
import {
  chatRepository,
  transcriptRepository,
  messageRepository,
  usageRepository,
  templateRepository,
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
  BackendSession,
} from '@therascript/domain';
import { TransformStream } from 'node:stream/web';
import { TextEncoder } from 'node:util';
import {
  getElasticsearchClient,
  MESSAGES_INDEX,
  indexDocument,
  deleteByQuery,
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
import { type ChatRequest, chatRequestSchema } from '@therascript/domain';

const esClient = getElasticsearchClient(config.elasticsearch.url);

type SessionChatMetadataResponse = Omit<ChatMetadata, 'tags'> & {
  sessionId: number;
};
type ApiChatMessageResponse = BackendChatMessage;
type FullSessionChatApiResponse = SessionChatMetadataResponse & {
  messages: ApiChatMessageResponse[];
};

interface ElysiaHandlerContext {
  body: unknown;
  params: Record<string, string | undefined>;
  query: Record<string, string | undefined>;
  set: { status?: number | string; headers?: Record<string, string> };
  request: Request;
  sessionData: BackendSession;
  chatData?: BackendChatSession;
  messageData?: BackendChatMessage;
}

export const createSessionChat = ({
  sessionData,
  set,
}: ElysiaHandlerContext): SessionChatMetadataResponse => {
  const sessionId = sessionData.id;
  try {
    const newChat = chatRepository.createChat(sessionId);
    console.log(`[API] Created new chat ${newChat.id} in session ${sessionId}`);
    const { messages, ...chatMetadata } = newChat;
    set.status = 201;
    if (chatMetadata.sessionId === null) {
      throw new InternalServerError(
        'Created session chat has null sessionId, which is unexpected.'
      );
    }
    const { tags, ...responseMetadata } = chatMetadata;
    return responseMetadata as SessionChatMetadataResponse;
  } catch (error) {
    console.error(
      `[API Error] createSessionChat (Session ID: ${sessionId}):`,
      error
    );
    throw new InternalServerError(
      'Failed to create session chat',
      error instanceof Error ? error : undefined
    );
  }
};

export const addSessionChatMessage = async ({
  sessionData,
  chatData,
  body,
  set,
  request,
}: ElysiaHandlerContext): Promise<Response> => {
  const validatedBody = chatRequestSchema.parse(body);
  const trimmedText = validatedBody.text.trim();
  let userMessage: BackendChatMessage;

  if (!chatData) {
    throw new NotFoundError(
      `Chat context not found for adding message. This should not happen if derive hook is correct.`
    );
  }
  if (chatData.sessionId !== sessionData.id) {
    throw new ApiError(
      403,
      `Chat ${chatData.id} does not belong to session ${sessionData.id}.`
    );
  }

  try {
    userMessage = messageRepository.addMessage(
      chatData.id,
      'user',
      trimmedText
    );

    await indexDocument(esClient, MESSAGES_INDEX, String(userMessage.id), {
      message_id: String(userMessage.id),
      chat_id: userMessage.chatId,
      session_id: sessionData.id,
      sender: userMessage.sender,
      text: userMessage.text,
      timestamp: userMessage.timestamp,
      client_name: sessionData.clientName,
      session_name: sessionData.sessionName,
      chat_name: null,
      tags: null,
    });
    console.log(
      `[API ES] Indexed User message ${userMessage.id} for session chat ${chatData.id}.`
    );

    const transcriptString = transcriptRepository.getTranscriptTextForSession(
      sessionData.id,
      sessionData.showSpeakers !== 0
    );
    const currentMessages = messageRepository.findMessagesByChatId(chatData.id);
    if (currentMessages.length === 0) {
      throw new InternalServerError(
        `CRITICAL: Chat ${chatData.id} has no messages immediately after adding one.`
      );
    }

    const showSpeakers = sessionData.showSpeakers !== 0;
    let systemPromptText =
      templateRepository.findByTitle('system_prompt')?.text ||
      'You are a helpful assistant.';

    if (!showSpeakers) {
      const instructionToStrip =
        'Always refer to speakers using the exact labels present in the transcript (e.g. "John:", "SPEAKER_01:"). Do not substitute generic terms like "Therapist" or "Patient" unless those exact labels appear in the transcript.';
      systemPromptText = systemPromptText
        .replace(instructionToStrip, '')
        .trim();
      systemPromptText +=
        '\n\nSpeaker labels are disabled for this transcript. Do not invent or use speaker names (like "SPEAKER_01" or "John"). Refer to speakers descriptively (e.g., "the therapist" or "the patient") without using explicit names or labels.';
    }

    const systemPromptMsg: BackendChatMessage = {
      id: 0,
      chatId: chatData.id,
      sender: 'system',
      text: systemPromptText,
      timestamp: Date.now(),
    };

    const previousHistory = currentMessages.slice(0, -1).map((msg) => {
      if (!showSpeakers && msg.sender === 'ai') {
        const cleanedText = msg.text.replace(
          /((?:SPEAKER_\d+)|(?:[A-Z][A-Za-z]+)):\s/g,
          ''
        );
        return { ...msg, text: cleanedText };
      }
      return msg;
    });

    const latestUserMessage = currentMessages[currentMessages.length - 1];

    // Combine transcript context with user prompt into a single user message
    // Prevents "user -> user" sequence which breaks Llama 3 ChatML format causing premature EOS
    const combinedUserMessageText = `CONTEXT TRANSCRIPT:\n"""\n${transcriptString || 'No transcript available.'}\n"""\n\nUSER QUESTION:\n${latestUserMessage.text}`;

    const combinedUserMessage: BackendChatMessage = {
      ...latestUserMessage,
      text: combinedUserMessageText,
    };

    const streamMessages = [
      systemPromptMsg,
      ...previousHistory,
      combinedUserMessage,
    ];

    const configured = getConfiguredContextSize();
    const recommendedContext = recommendContextSize({
      transcriptTokens: sessionData.transcriptTokenCount ?? null,
      modelDefaultMax: null,
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
      streamMessages,
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
            isStandalone: false,
            sessionData,
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
                session_id: sessionData.id,
                sender: aiMessage.sender,
                text: aiMessage.text,
                timestamp: aiMessage.timestamp,
                promptTokens: aiMessage.promptTokens,
                completionTokens: aiMessage.completionTokens,
                isTruncated: isTruncated,
                client_name: sessionData.clientName,
                session_name: sessionData.sessionName,
                chat_name: null,
                tags: null,
              }
            );
            console.log(
              `[API ES] Indexed AI message ${aiMessage.id} for session chat ${chatData.id}.`
            );
            console.log(
              `[API ProcessStream Finally ${chatData.id}] Saved AI message (length: ${cleanedAiText.length}) to DB.`
            );

            try {
              usageRepository.insertUsageLog({
                type: 'llm',
                source: 'session_chat',
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
      `[API Error] addSessionChatMessage setup failed (Chat ID: ${chatData?.id}, Session ID: ${sessionData?.id}):`,
      error
    );
    if (error instanceof ApiError) throw error;
    throw new InternalServerError(
      'Failed to setup chat message stream',
      error instanceof Error ? error : undefined
    );
  }
};

export const getSessionChatDetails = ({
  chatData,
  sessionData,
  set,
}: ElysiaHandlerContext): FullSessionChatApiResponse => {
  if (!chatData) throw new NotFoundError(`Chat details not found in context.`);
  if (chatData.sessionId !== sessionData.id)
    throw new ApiError(
      403,
      `Chat ${chatData.id} does not belong to session ${sessionData.id}.`
    );
  set.status = 200;
  const messages = (chatData.messages ?? []).map((m: BackendChatMessage) => m);
  const { messages: _m, tags, ...metadata } = chatData; // tags are not part of SessionChatMetadataResponse
  return {
    ...metadata,
    sessionId: metadata.sessionId as number,
    messages: messages,
  };
};

interface RenameBody {
  name?: string | null;
}

export const renameSessionChat = ({
  chatData,
  sessionData,
  body,
  set,
}: ElysiaHandlerContext): SessionChatMetadataResponse => {
  const { name } = body as RenameBody;
  const nameToSave =
    typeof name === 'string' && name.trim() !== '' ? name.trim() : null;
  if (!chatData)
    throw new NotFoundError(`Chat not found in context for rename.`);
  if (chatData.sessionId !== sessionData.id)
    throw new ApiError(
      403,
      `Chat ${chatData.id} does not belong to session ${sessionData.id}.`
    );
  try {
    // Session chats don't have tags, so pass null for tags
    const updatedChatMetadata = chatRepository.updateChatDetails(
      chatData.id,
      nameToSave,
      null
    );
    if (!updatedChatMetadata)
      throw new NotFoundError(
        `Chat with ID ${chatData.id} not found during update.`
      );
    console.log(
      `[API] Renamed session chat ${chatData.id} to "${updatedChatMetadata.name || '(no name)'}"`
    );
    set.status = 200;
    if (updatedChatMetadata.sessionId === null)
      throw new InternalServerError(
        'Renamed session chat resulted in null sessionId!'
      );
    const { tags: _t, ...responseMetadata } = updatedChatMetadata; // Ensure tags are excluded from the response
    return responseMetadata as SessionChatMetadataResponse;
  } catch (error) {
    console.error(
      `[API Error] renameSessionChat (Chat ID: ${chatData?.id}):`,
      error
    );
    if (error instanceof ApiError) throw error;
    throw new InternalServerError(
      'Failed to rename session chat',
      error instanceof Error ? error : undefined
    );
  }
};

export const deleteSessionChat = async ({
  chatData,
  sessionData,
  set,
}: ElysiaHandlerContext): Promise<{ message: string }> => {
  if (!chatData)
    throw new NotFoundError(`Chat not found in context for delete.`);
  if (chatData.sessionId !== sessionData.id)
    throw new ApiError(
      403,
      `Chat ${chatData.id} does not belong to session ${sessionData.id}.`
    );
  try {
    const deleted = chatRepository.deleteChatById(chatData.id);
    if (!deleted)
      throw new NotFoundError(
        `Chat with ID ${chatData.id} not found during deletion.`
      );

    // Delete associated messages from Elasticsearch
    await deleteByQuery(esClient, MESSAGES_INDEX, {
      term: { chat_id: chatData.id },
    });
    console.log(
      `[API ES] Deleted Elasticsearch messages for session chat ${chatData.id}.`
    );

    console.log(`[API] Deleted session chat ${chatData.id}`);
    set.status = 200;
    return { message: `Chat ${chatData.id} deleted successfully.` };
  } catch (error) {
    console.error(
      `[API Error] deleteSessionChat (Chat ID: ${chatData?.id}):`,
      error
    );
    if (error instanceof ApiError) throw error;
    throw new InternalServerError(
      'Failed to delete session chat',
      error instanceof Error ? error : undefined
    );
  }
};
