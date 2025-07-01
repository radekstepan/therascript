// packages/api/src/api/sessionChatHandler.ts
import { chatRepository } from '../repositories/chatRepository.js';
import { transcriptRepository } from '../repositories/transcriptRepository.js';
import { messageRepository } from '../repositories/messageRepository.js';
import { streamChatResponse } from '../services/vllmService.js';
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
} from '@therascript/elasticsearch-client';
import config from '../config/index.js';

const esClient = getElasticsearchClient(config.elasticsearch.url);

type SessionChatMetadataResponse = Omit<ChatMetadata, 'tags'> & {
  sessionId: number;
};
type ApiChatMessageResponse = BackendChatMessage;
type FullSessionChatApiResponse = SessionChatMetadataResponse & {
  messages: ApiChatMessageResponse[];
};

// Define a type for Elysia context if not already available globally
// This needs to match what Elysia actually provides to your handlers
interface ElysiaHandlerContext {
  body: any; // This will be typed by Elysia based on schema
  params: Record<string, string | undefined>; // Params are strings initially
  query: Record<string, string | undefined>;
  set: { status?: number | string; headers?: Record<string, string> };
  // These are added by 'derive' hooks
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
    const { messages, ...chatMetadata } = newChat; // messages is an array in BackendChatSession, fine to destructure
    set.status = 201;
    if (chatMetadata.sessionId === null) {
      // Should not happen for session chats
      throw new InternalServerError(
        'Created session chat has null sessionId, which is unexpected.'
      );
    }
    // Session chats do not have their own tags in the current model, so excluding 'tags' property
    const { tags, ...responseMetadata } = chatMetadata;
    return responseMetadata as SessionChatMetadataResponse; // Cast after ensuring sessionId is not null
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
}: ElysiaHandlerContext): Promise<Response> => {
  const { text } = body as { text: string }; // Type assertion for body
  const trimmedText = text.trim();
  let userMessage: BackendChatMessage;

  if (!chatData) {
    throw new NotFoundError(
      `Chat context not found for adding message. This should not happen if derive hook is correct.`
    );
  }
  if (chatData.sessionId !== sessionData.id) {
    // This check should ideally be redundant if derive hooks are set up correctly
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
    // Index user message into Elasticsearch
    await indexDocument(esClient, MESSAGES_INDEX, String(userMessage.id), {
      message_id: String(userMessage.id),
      chat_id: userMessage.chatId,
      session_id: sessionData.id,
      sender: userMessage.sender,
      text: userMessage.text,
      timestamp: userMessage.timestamp,
      client_name: sessionData.clientName,
      session_name: sessionData.sessionName,
      // chat_name and tags are null for session-based chat messages
      chat_name: null,
      tags: null,
    });
    console.log(
      `[API ES] Indexed User message ${userMessage.id} for session chat ${chatData.id}.`
    );

    const transcriptString = transcriptRepository.getTranscriptTextForSession(
      sessionData.id
    );
    const currentMessages = messageRepository.findMessagesByChatId(chatData.id);
    if (currentMessages.length === 0) {
      throw new InternalServerError(
        `CRITICAL: Chat ${chatData.id} has no messages immediately after adding one.`
      );
    }

    const vllmStream = await streamChatResponse(
      transcriptString,
      currentMessages
    );

    const headers = new Headers({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    headers.set('X-User-Message-Id', String(userMessage.id)); // Send actual user message ID

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
      let vllmStreamError: Error | null = null;

      try {
        console.log(
          `[API ProcessStream ${chatData.id}] Starting vLLM stream processing...`
        );
        for await (const chunk of vllmStream) {
          const contentChunk = chunk.choices[0]?.delta?.content;
          if (contentChunk) {
            fullAiText += contentChunk;
            await writeSseEvent({ chunk: contentChunk });
          }
          if (chunk.choices[0]?.finish_reason === 'stop') {
            finalPromptTokens = chunk.usage?.prompt_tokens;
            finalCompletionTokens = chunk.usage?.completion_tokens;
            console.log(
              `[API ProcessStream ${chatData.id}] vLLM stream 'done'. Tokens: C=${finalCompletionTokens}, P=${finalPromptTokens}`
            );
            await writeSseEvent({
              done: true,
              promptTokens: finalPromptTokens,
              completionTokens: finalCompletionTokens,
            });
          }
        }
        console.log(
          `[API ProcessStream ${chatData.id}] Finished iterating vLLM stream successfully.`
        );
      } catch (streamError: any) {
        vllmStreamError =
          streamError instanceof Error
            ? streamError
            : new Error(String(streamError));
        console.error(
          `[API ProcessStream ${chatData.id}] Error DURING vLLM stream iteration:`,
          vllmStreamError
        );
        try {
          await writeSseEvent({
            error: 'Stream processing failed on server during LLM interaction.',
          });
        } catch {}
      } finally {
        console.log(
          `[API ProcessStream Finally ${chatData.id}] Cleaning up. vLLM stream errored: ${!!vllmStreamError}`
        );
        if (fullAiText.trim()) {
          try {
            const aiMessage = messageRepository.addMessage(
              chatData.id,
              'ai',
              fullAiText.trim(),
              finalPromptTokens,
              finalCompletionTokens
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
                client_name: sessionData.clientName,
                session_name: sessionData.sessionName,
                chat_name: null,
                tags: null,
              }
            );
            console.log(
              `[API ES] Indexed AI message ${aiMessage.id} for session chat ${chatData.id}.`
            );
          } catch (dbError) {
            console.error(
              `[API ProcessStream Finally ${chatData.id}] CRITICAL: Failed to save AI message to DB:`,
              dbError
            );
            vllmStreamError =
              vllmStreamError ||
              new InternalServerError(
                'Failed to save AI response to database.',
                dbError instanceof Error ? dbError : undefined
              );
          }
        } else {
          console.warn(
            `[API ProcessStream Finally ${chatData.id}] No AI text generated or saved.`
          );
        }
        if (vllmStreamError) {
          await writer.abort(vllmStreamError).catch(() => {});
        } else {
          await writer.close().catch(() => {});
        }
      }
    };

    processStream().catch((err) => {
      console.error(
        `[API AddMsg ${chatData.id}] UNHANDLED error from background stream processing task:`,
        err
      );
    });

    return new Response(passthrough.readable as any, { status: 200, headers });
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

export const renameSessionChat = ({
  chatData,
  sessionData,
  body,
  set,
}: ElysiaHandlerContext): SessionChatMetadataResponse => {
  const { name } = body as { name?: string | null };
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
