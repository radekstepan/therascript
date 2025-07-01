// packages/api/src/api/standaloneChatHandler.ts
import { chatRepository } from '../repositories/chatRepository.js';
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
} from '../types/index.js';
import { TransformStream } from 'node:stream/web';
import { TextEncoder } from 'node:util';
import {
  getElasticsearchClient,
  MESSAGES_INDEX,
  indexDocument,
  deleteByQuery,
  bulkIndexDocuments,
} from '@therascript/elasticsearch-client';
import config from '../config/index.js';

const esClient = getElasticsearchClient(config.elasticsearch.url);

type StandaloneChatMetadataResponse = ChatMetadata & {
  sessionId: null;
  tags: string[] | null;
};
type ApiChatMessageResponse = BackendChatMessage;
type FullStandaloneChatApiResponse = StandaloneChatMetadataResponse & {
  messages: ApiChatMessageResponse[];
};

interface ElysiaHandlerContext {
  body: any;
  params: Record<string, string | undefined>;
  query: Record<string, string | undefined>;
  set: { status?: number | string; headers?: Record<string, string> };
  chatData?: BackendChatSession;
  messageData?: BackendChatMessage;
}

export const createStandaloneChat = ({
  set,
}: ElysiaHandlerContext): StandaloneChatMetadataResponse => {
  try {
    const newChat: BackendChatSession = chatRepository.createChat(null);
    const { messages, sessionId: _ignoredSessionId, ...chatMetadata } = newChat;
    set.status = 201;
    const response: StandaloneChatMetadataResponse = {
      id: chatMetadata.id,
      sessionId: null,
      timestamp: chatMetadata.timestamp,
      name: chatMetadata.name ?? null,
      tags: chatMetadata.tags ?? null,
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
    const chats = chatRepository.findStandaloneChats();
    set.status = 200;
    return chats.map((chat) => ({
      ...chat,
      sessionId: null,
      tags: chat.tags ?? null,
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
    throw new InternalServerError(
      `Chat ${chatData.id} is not a standalone chat.`
    );
  }
  set.status = 200;
  const messages = (chatData.messages ?? []).map((m: BackendChatMessage) => m);
  const { messages: _m, ...metadata } = chatData;
  const response: FullStandaloneChatApiResponse = {
    id: metadata.id,
    sessionId: null,
    timestamp: metadata.timestamp,
    name: metadata.name ?? null,
    tags: metadata.tags ?? null,
    messages: messages,
  };
  return response;
};

export const addStandaloneChatMessage = async ({
  chatData,
  body,
  set,
}: ElysiaHandlerContext): Promise<Response> => {
  const { text } = body as { text: string };
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
    await indexDocument(esClient, MESSAGES_INDEX, String(userMessage.id), {
      message_id: String(userMessage.id),
      chat_id: userMessage.chatId,
      session_id: null,
      sender: userMessage.sender,
      text: userMessage.text,
      timestamp: userMessage.timestamp,
      chat_name: chatData.name ?? null,
      tags: chatData.tags ?? null,
      client_name: null,
      session_name: null,
    });

    const currentMessages = messageRepository.findMessagesByChatId(chatData.id);
    if (currentMessages.length === 0) {
      throw new InternalServerError('CRITICAL: No messages after adding one.');
    }

    const vllmStream = await streamChatResponse(null, currentMessages);

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
        console.warn(`[API SSE Write Error ${chatData.id}]:`, e);
        throw new Error('SSE write failed, aborting stream processing.');
      }
    };

    const processStream = async () => {
      let fullAiText = '';
      let finalPromptTokens: number | undefined;
      let finalCompletionTokens: number | undefined;
      let vllmStreamError: Error | null = null;

      try {
        for await (const chunk of vllmStream) {
          const contentChunk = chunk.choices[0]?.delta?.content;
          if (contentChunk) {
            fullAiText += contentChunk;
            await writeSseEvent({ chunk: contentChunk });
          }
          if (chunk.choices[0]?.finish_reason === 'stop') {
            finalPromptTokens = chunk.usage?.prompt_tokens;
            finalCompletionTokens = chunk.usage?.completion_tokens;
            await writeSseEvent({
              done: true,
              promptTokens: finalPromptTokens,
              completionTokens: finalCompletionTokens,
            });
          }
        }
      } catch (streamError: any) {
        vllmStreamError = streamError;
        console.error(`[API Stream Error ${chatData.id}]:`, vllmStreamError);
        try {
          await writeSseEvent({ error: 'Stream processing failed.' });
        } catch {}
      } finally {
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
          } catch (dbError) {
            console.error('Failed to save AI message to DB:', dbError);
            if (!vllmStreamError) {
              vllmStreamError = new InternalServerError(
                'Failed to save AI response.'
              );
            }
          }
        }
        if (vllmStreamError) {
          await writer.abort(vllmStreamError).catch(() => {});
        } else {
          await writer.close().catch(() => {});
        }
      }
    };

    processStream().catch((err) =>
      console.error('Unhandled error in background stream processing:', err)
    );

    return new Response(passthrough.readable as any, { status: 200, headers });
  } catch (error) {
    console.error(
      `[API Error] addStandaloneChatMessage setup (Chat ID: ${chatData?.id}):`,
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
