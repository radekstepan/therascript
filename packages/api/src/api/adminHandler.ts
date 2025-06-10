import {
  getElasticsearchClient,
  initializeIndices,
  deleteIndex,
  bulkIndexDocuments,
  TRANSCRIPTS_INDEX,
  MESSAGES_INDEX,
  type TranscriptSource,
  type MessageSource,
} from '@therascript/elasticsearch-client';
import config from '../config/index.js';
import { sessionRepository } from '../repositories/sessionRepository.js';
import { transcriptRepository } from '../repositories/transcriptRepository.js';
import { chatRepository } from '../repositories/chatRepository.js';
import { messageRepository } from '../repositories/messageRepository.js';
import { InternalServerError } from '../errors.js';
import type {
  BackendSession,
  TranscriptParagraphData,
  BackendChatMessage,
} from '../types/index.js';

const esClient = getElasticsearchClient(config.elasticsearch.url);

interface ReindexResult {
  message: string;
  transcriptsIndexed: number;
  messagesIndexed: number;
  errors: string[];
}

export const handleReindexElasticsearch = async ({
  set,
}: any): Promise<ReindexResult> => {
  console.log('[API Admin] Received request to re-index Elasticsearch data.');
  const errors: string[] = [];
  let transcriptsIndexed = 0;
  let messagesIndexed = 0;

  try {
    // 1. Delete existing indices
    console.log('[API Admin] Deleting existing Elasticsearch indices...');
    try {
      await deleteIndex(esClient, TRANSCRIPTS_INDEX);
      console.log(`[API Admin] Index ${TRANSCRIPTS_INDEX} deleted.`);
    } catch (e: any) {
      const msg = `Error deleting index ${TRANSCRIPTS_INDEX}: ${e.message || String(e)}`;
      console.error(msg);
      if (!e.message?.includes('index_not_found_exception')) {
        // Only add error if it's not "not found"
        errors.push(msg);
      }
    }
    try {
      await deleteIndex(esClient, MESSAGES_INDEX);
      console.log(`[API Admin] Index ${MESSAGES_INDEX} deleted.`);
    } catch (e: any) {
      const msg = `Error deleting index ${MESSAGES_INDEX}: ${e.message || String(e)}`;
      console.error(msg);
      if (!e.message?.includes('index_not_found_exception')) {
        // Only add error if it's not "not found"
        errors.push(msg);
      }
    }

    // 2. Re-initialize indices (create them with current mappings)
    console.log('[API Admin] Initializing Elasticsearch indices...');
    await initializeIndices(esClient);
    console.log('[API Admin] Elasticsearch indices initialized.');

    // 3. Fetch all data from SQLite and re-index
    console.log('[API Admin] Fetching data from SQLite for re-indexing...');
    const allSessions: BackendSession[] = sessionRepository.findAll();
    const esTranscriptDocsToBulk: Array<{
      id: string;
      document: Partial<TranscriptSource>;
    }> = [];
    const esMessageDocsToBulk: Array<{
      id: string;
      document: Partial<MessageSource>;
    }> = [];

    for (const session of allSessions) {
      if (session.status === 'completed') {
        const paragraphs: TranscriptParagraphData[] =
          transcriptRepository.findParagraphsBySessionId(session.id);
        for (const p of paragraphs) {
          esTranscriptDocsToBulk.push({
            id: `${session.id}_${p.id}`,
            document: {
              paragraph_id: `${session.id}_${p.id}`,
              session_id: session.id,
              paragraph_index: p.id,
              text: p.text,
              timestamp_ms: p.timestamp,
              client_name: session.clientName,
              session_name: session.sessionName,
              session_date: session.date,
              session_type: session.sessionType,
              therapy_type: session.therapy,
            },
          });
        }
      }

      const chats = chatRepository.findChatsBySessionId(session.id);
      for (const chat of chats) {
        const messages: BackendChatMessage[] =
          messageRepository.findMessagesByChatId(chat.id);
        for (const m of messages) {
          esMessageDocsToBulk.push({
            id: String(m.id),
            document: {
              message_id: String(m.id),
              chat_id: m.chatId,
              session_id: session.id,
              sender: m.sender,
              text: m.text,
              timestamp: m.timestamp,
              client_name: session.clientName,
              session_name: session.sessionName,
              chat_name: null,
              tags: null,
            },
          });
        }
      }
    }

    const standaloneChats = chatRepository.findStandaloneChats();
    for (const chat of standaloneChats) {
      const messages: BackendChatMessage[] =
        messageRepository.findMessagesByChatId(chat.id);
      for (const m of messages) {
        esMessageDocsToBulk.push({
          id: String(m.id),
          document: {
            message_id: String(m.id),
            chat_id: m.chatId,
            session_id: null,
            sender: m.sender,
            text: m.text,
            timestamp: m.timestamp,
            chat_name: chat.name,
            tags: chat.tags,
            client_name: null,
            session_name: null,
          },
        });
      }
    }

    if (esTranscriptDocsToBulk.length > 0) {
      console.log(
        `[API Admin] Bulk indexing ${esTranscriptDocsToBulk.length} transcript documents...`
      );
      await bulkIndexDocuments(
        esClient,
        TRANSCRIPTS_INDEX,
        esTranscriptDocsToBulk
      );
      transcriptsIndexed = esTranscriptDocsToBulk.length;
    }

    if (esMessageDocsToBulk.length > 0) {
      console.log(
        `[API Admin] Bulk indexing ${esMessageDocsToBulk.length} message documents...`
      );
      await bulkIndexDocuments(esClient, MESSAGES_INDEX, esMessageDocsToBulk);
      messagesIndexed = esMessageDocsToBulk.length;
    }

    const resultMessage = `Elasticsearch re-indexing process completed. Transcripts: ${transcriptsIndexed}, Messages: ${messagesIndexed}. Errors: ${errors.length > 0 ? errors.join('; ') : 'None'}`;
    console.log(`[API Admin] ${resultMessage}`);
    set.status = errors.length > 0 ? 207 : 200; // Multi-Status if errors occurred
    return {
      message: resultMessage,
      transcriptsIndexed,
      messagesIndexed,
      errors,
    };
  } catch (error: any) {
    const errorMessage = `Critical error during Elasticsearch re-index: ${error.message || String(error)}`;
    console.error(`[API Admin] ${errorMessage}`, error);
    errors.push(errorMessage); // Add the critical error to the list
    // Don't throw here if we want to return a 207 or 500 with the errors array
    // Instead, ensure the status code reflects the failure.
    set.status = 500;
    return {
      message: 'Elasticsearch re-indexing failed critically.',
      transcriptsIndexed,
      messagesIndexed,
      errors,
    };
  }
};
