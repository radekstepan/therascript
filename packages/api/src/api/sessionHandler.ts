// packages/api/src/api/sessionHandler.ts
import { sessionRepository } from '../repositories/sessionRepository.js';
import { chatRepository } from '../repositories/chatRepository.js';
import { transcriptRepository } from '../repositories/transcriptRepository.js';
import { messageRepository } from '../repositories/messageRepository.js';
import {
  deleteUploadedAudioFile,
  saveUploadedAudio,
} from '../services/fileService.js';
import { reloadActiveModelContext } from '../services/ollamaService.js';
// Import getStructuredTranscriptionResult from transcriptionService where it's actually exported
import { getStructuredTranscriptionResult } from '../services/transcriptionService.js';
import type {
  BackendSession,
  StructuredTranscript,
  BackendSessionMetadata,
  ApiSearchResultItem,
  TranscriptParagraphData,
} from '../types/index.js';
import {
  NotFoundError,
  BadRequestError,
  InternalServerError,
  ApiError,
  ConflictError,
} from '../errors.js';
import { calculateTokenCount } from '../services/tokenizerService.js';
import {
  getElasticsearchClient,
  TRANSCRIPTS_INDEX,
  MESSAGES_INDEX,
  bulkIndexDocuments,
  indexDocument,
  deleteByQuery,
  deleteDocument,
} from '@therascript/elasticsearch-client';
import config from '../config/index.js';

const esClient = getElasticsearchClient(config.elasticsearch.url);

const dateToIsoString = (dateString: string): string | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    console.warn(
      `[dateToIsoString] Invalid date format received: ${dateString}`
    );
    return null;
  }
  try {
    const dt = new Date(`${dateString}T12:00:00.000Z`);
    if (isNaN(dt.getTime())) {
      throw new Error('Invalid date produced from input string');
    }
    return dt.toISOString();
  } catch (e) {
    console.error(
      `[dateToIsoString] Error converting date string '${dateString}' to ISO:`,
      e
    );
    return null;
  }
};

export const listSessions = ({ set }: any) => {
  try {
    const sessions = sessionRepository.findAll();
    const sessionDTOs = sessions.map((s) => ({
      id: s.id,
      fileName: s.fileName,
      clientName: s.clientName,
      sessionName: s.sessionName,
      date: s.date,
      sessionType: s.sessionType,
      therapy: s.therapy,
      audioPath: s.audioPath,
      status: s.status,
      whisperJobId: s.whisperJobId,
      transcriptTokenCount: s.transcriptTokenCount,
    }));
    set.status = 200;
    return sessionDTOs;
  } catch (error) {
    console.error('[API Error] listSessions:', error);
    throw new InternalServerError(
      'Failed to fetch sessions',
      error instanceof Error ? error : undefined
    );
  }
};

export const getSessionDetails = ({ sessionData, set }: any) => {
  try {
    const chats = chatRepository.findChatsBySessionId(sessionData.id);
    const chatMetadata = chats.map((chat) => ({
      id: chat.id,
      sessionId: chat.sessionId,
      timestamp: chat.timestamp,
      name: chat.name,
    }));

    set.status = 200;
    return {
      id: sessionData.id,
      fileName: sessionData.fileName,
      clientName: sessionData.clientName,
      sessionName: sessionData.sessionName,
      date: sessionData.date,
      sessionType: sessionData.sessionType,
      therapy: sessionData.therapy,
      audioPath: sessionData.audioPath,
      status: sessionData.status,
      whisperJobId: sessionData.whisperJobId,
      transcriptTokenCount: sessionData.transcriptTokenCount,
      chats: chatMetadata,
    };
  } catch (error) {
    console.error(
      `[API Error] getSessionDetails (ID: ${sessionData?.id}):`,
      error
    );
    throw new InternalServerError(
      'Failed to get session details',
      error instanceof Error ? error : undefined
    );
  }
};

export const updateSessionMetadata = async ({
  sessionData,
  body,
  set,
}: any) => {
  const sessionId = sessionData.id;
  const { date: dateInput, ...restOfBody } = body;
  const metadataUpdate: Partial<BackendSession> = { ...restOfBody };

  if (Object.keys(body).length === 0) {
    throw new BadRequestError('No metadata provided for update.');
  }
  if (dateInput) {
    const isoDate = dateToIsoString(dateInput);
    if (!isoDate) {
      throw new BadRequestError(
        `Invalid date format provided: ${dateInput}. Must be YYYY-MM-DD.`
      );
    }
    metadataUpdate.date = isoDate;
  }

  try {
    const originalSession = sessionRepository.findById(sessionId);
    if (!originalSession)
      throw new NotFoundError(`Session ${sessionId} not found.`);

    const updatedSession = sessionRepository.updateMetadata(
      sessionId,
      metadataUpdate
    );
    if (!updatedSession) {
      throw new NotFoundError(
        `Session with ID ${sessionId} not found during update attempt or update failed.`
      );
    }

    const fieldsToCheckForEsUpdate: (keyof BackendSessionMetadata)[] = [
      'clientName',
      'sessionName',
      'date',
      'sessionType',
      'therapy',
    ];
    const esUpdateNeeded = fieldsToCheckForEsUpdate.some(
      (field) =>
        field in metadataUpdate &&
        metadataUpdate[field as keyof typeof metadataUpdate] !==
          originalSession[field as keyof BackendSession]
    );

    if (esUpdateNeeded) {
      console.log(
        `[API ES Update] Session metadata changed for ${sessionId}, preparing to re-index related documents.`
      );
      const paragraphs =
        transcriptRepository.findParagraphsBySessionId(sessionId);
      if (paragraphs.length > 0) {
        const transcriptDocs = paragraphs.map((p: TranscriptParagraphData) => ({
          // Added type for p
          id: `${sessionId}_${p.id}`,
          document: {
            session_id: sessionId,
            paragraph_index: p.id,
            text: p.text,
            timestamp_ms: p.timestamp,
            client_name: updatedSession.clientName,
            session_name: updatedSession.sessionName,
            session_date: updatedSession.date,
            session_type: updatedSession.sessionType,
            therapy_type: updatedSession.therapy,
          },
        }));
        await bulkIndexDocuments(esClient, TRANSCRIPTS_INDEX, transcriptDocs);
        console.log(
          `[API ES Update] Updated ${transcriptDocs.length} transcript documents for session ${sessionId}.`
        );
      }

      const chats = chatRepository.findChatsBySessionId(sessionId);
      const messageDocsToUpdate: Array<{ id: string; document: any }> = [];
      for (const chat of chats) {
        const messages = messageRepository.findMessagesByChatId(chat.id);
        messages.forEach((m) => {
          messageDocsToUpdate.push({
            id: String(m.id),
            document: {
              message_id: String(m.id),
              chat_id: m.chatId,
              session_id: sessionId,
              sender: m.sender,
              text: m.text,
              timestamp: m.timestamp,
              client_name: updatedSession.clientName,
              session_name: updatedSession.sessionName,
            },
          });
        });
      }
      if (messageDocsToUpdate.length > 0) {
        await bulkIndexDocuments(esClient, MESSAGES_INDEX, messageDocsToUpdate);
        console.log(
          `[API ES Update] Updated ${messageDocsToUpdate.length} message documents for session ${sessionId}.`
        );
      }
    }
    console.log(`[API] Updated metadata for session ${sessionId}`);
    set.status = 200;
    return {
      id: updatedSession.id,
      fileName: updatedSession.fileName,
      clientName: updatedSession.clientName,
      sessionName: updatedSession.sessionName,
      date: updatedSession.date,
      sessionType: updatedSession.sessionType,
      therapy: updatedSession.therapy,
      audioPath: updatedSession.audioPath,
      status: updatedSession.status,
      whisperJobId: updatedSession.whisperJobId,
      transcriptTokenCount: updatedSession.transcriptTokenCount,
    };
  } catch (error) {
    console.error(
      `[API Error] updateSessionMetadata (ID: ${sessionId}):`,
      error
    );
    if (
      (error as any).meta?.body?.error?.type ===
      'version_conflict_engine_exception'
    ) {
      console.warn(
        `[API ES Update] Version conflict for session ${sessionId}, likely concurrent update. Client may need to retry or handle.`
      );
    }
    if (error instanceof ApiError) throw error;
    throw new InternalServerError(
      'Failed to update session metadata',
      error instanceof Error ? error : undefined
    );
  }
};

export const getTranscript = async ({
  sessionData,
  set,
}: any): Promise<StructuredTranscript> => {
  const sessionId = sessionData.id;
  if (sessionData.status !== 'completed') {
    console.warn(
      `[API getTranscript] Transcript for session ${sessionId} status is ${sessionData.status}.`
    );
    set.status = 200;
    return [];
  }
  try {
    const structuredTranscript: StructuredTranscript =
      transcriptRepository.findParagraphsBySessionId(sessionId);
    set.status = 200;
    return structuredTranscript;
  } catch (error) {
    console.error(`[API Error] getTranscript (ID: ${sessionId}):`, error);
    if (error instanceof ApiError) throw error;
    throw new InternalServerError(
      'Failed to load transcript from database',
      error instanceof Error ? error : undefined
    );
  }
};

export const updateTranscriptParagraph = async ({
  sessionData,
  body,
  set,
}: any): Promise<StructuredTranscript> => {
  const sessionId = sessionData.id;
  const { paragraphIndex, newText } = body;

  if (sessionData.status !== 'completed') {
    throw new BadRequestError(
      `Cannot update transcript for session ${sessionId}: Status is ${sessionData.status}.`
    );
  }
  try {
    const currentTranscript: StructuredTranscript =
      transcriptRepository.findParagraphsBySessionId(sessionId);
    if (
      !currentTranscript.some(
        (p: TranscriptParagraphData) => p.id === paragraphIndex
      )
    ) {
      throw new BadRequestError(
        `Invalid paragraph index: ${paragraphIndex}. Paragraph not found.`
      );
    }
    const trimmedNewText = newText.trim();
    const originalParagraph = currentTranscript.find(
      (p: TranscriptParagraphData) => p.id === paragraphIndex
    ); // Added type for p

    if (originalParagraph && trimmedNewText === originalParagraph.text.trim()) {
      console.log(
        `[API updateTranscriptParagraph] No change needed for paragraph ${paragraphIndex}.`
      );
      set.status = 200;
      return currentTranscript;
    }

    const updateSuccess = transcriptRepository.updateParagraphText(
      sessionId,
      paragraphIndex,
      trimmedNewText
    );
    if (!updateSuccess) {
      throw new InternalServerError(
        `Failed to update paragraph ${paragraphIndex} for session ${sessionId} in the database.`
      );
    }

    const updatedTranscriptFromDb: StructuredTranscript =
      transcriptRepository.findParagraphsBySessionId(sessionId);
    const fullTextForTokens = updatedTranscriptFromDb
      .map((p: TranscriptParagraphData) => p.text)
      .join('\n\n'); // Added type for p
    const tokenCount = calculateTokenCount(fullTextForTokens);
    sessionRepository.updateMetadata(sessionId, {
      transcriptTokenCount: tokenCount,
    });

    const esParagraphData = updatedTranscriptFromDb.find(
      (p: TranscriptParagraphData) => p.id === paragraphIndex
    ); // Added type for p
    if (esParagraphData) {
      await indexDocument(
        esClient,
        TRANSCRIPTS_INDEX,
        `${sessionId}_${paragraphIndex}`,
        {
          session_id: sessionId,
          paragraph_index: paragraphIndex,
          text: trimmedNewText,
          timestamp_ms: esParagraphData.timestamp,
          client_name: sessionData.clientName,
          session_name: sessionData.sessionName,
          session_date: sessionData.date,
          session_type: sessionData.sessionType,
          therapy_type: sessionData.therapy,
        }
      );
      console.log(
        `[API UpdateParagraph ES] Updated paragraph ${paragraphIndex} for session ${sessionId} in ES.`
      );
    } else {
      console.warn(
        `[API UpdateParagraph ES] Could not find updated paragraph ${paragraphIndex} in DB result to update ES.`
      );
    }

    console.log(
      `[API updateTranscriptParagraph] Updated paragraph ${paragraphIndex} for session ${sessionId}. New token count: ${tokenCount ?? 'N/A'}`
    );
    try {
      await reloadActiveModelContext();
      console.log(
        `[API updateTranscriptParagraph] Ollama model context reload triggered successfully.`
      );
    } catch (reloadError) {
      console.error(
        `[API updateTranscriptParagraph] WARNING: Failed to trigger Ollama model context reload:`,
        reloadError
      );
    }
    set.status = 200;
    return updatedTranscriptFromDb;
  } catch (error) {
    console.error(
      `[API Error] updateTranscriptParagraph (ID: ${sessionId}, Index: ${paragraphIndex}):`,
      error
    );
    if (error instanceof ApiError) throw error;
    throw new InternalServerError(
      'Failed to update transcript paragraph',
      error instanceof Error ? error : undefined
    );
  }
};

export const deleteTranscriptParagraph = async ({
  sessionData,
  params,
  set,
}: any): Promise<StructuredTranscript> => {
  const sessionId = sessionData.id;
  const paragraphIndex = parseInt(params.paragraphIndex, 10);

  if (isNaN(paragraphIndex) || paragraphIndex < 0) {
    throw new BadRequestError(
      `Invalid paragraph index: ${params.paragraphIndex}.`
    );
  }

  if (sessionData.status !== 'completed') {
    throw new BadRequestError(
      `Cannot delete transcript paragraph for session ${sessionId}: Status is ${sessionData.status}.`
    );
  }

  try {
    const deleted = transcriptRepository.deleteParagraphByIndex(
      sessionId,
      paragraphIndex
    );
    if (!deleted) {
      throw new NotFoundError(
        `Paragraph with index ${paragraphIndex} not found in session ${sessionId}.`
      );
    }

    // After deleting, we need to update token count and ES
    const updatedTranscript =
      transcriptRepository.findParagraphsBySessionId(sessionId);
    const fullTextForTokens = updatedTranscript
      .map((p: TranscriptParagraphData) => p.text)
      .join('\n\n');
    const tokenCount = calculateTokenCount(fullTextForTokens);

    sessionRepository.updateMetadata(sessionId, {
      transcriptTokenCount: tokenCount,
    });

    // Delete from Elasticsearch
    const esDocId = `${sessionId}_${paragraphIndex}`;
    await deleteDocument(esClient, TRANSCRIPTS_INDEX, esDocId);
    console.log(
      `[API ES Delete] Deleted document ${esDocId} from Elasticsearch.`
    );

    console.log(
      `[API] Deleted paragraph ${paragraphIndex} for session ${sessionId}. New token count: ${tokenCount ?? 'N/A'}`
    );

    // Trigger Ollama context reload in the background, don't wait for it
    reloadActiveModelContext().catch((reloadError) => {
      console.error(
        `[API deleteTranscriptParagraph] WARNING: Failed to trigger Ollama model context reload:`,
        reloadError
      );
    });

    set.status = 200;
    return updatedTranscript;
  } catch (error) {
    console.error(
      `[API Error] deleteTranscriptParagraph (ID: ${sessionId}, Index: ${paragraphIndex}):`,
      error
    );
    if (error instanceof ApiError) throw error;
    throw new InternalServerError(
      'Failed to delete transcript paragraph',
      error instanceof Error ? error : undefined
    );
  }
};

export const finalizeSessionHandler = async ({
  params,
  set,
  sessionData: initialSessionDataFromDerive,
}: any) => {
  // params from route, sessionData from derive
  const sessionId = parseInt(initialSessionDataFromDerive.id, 10);
  if (isNaN(sessionId))
    throw new BadRequestError('Invalid session ID for finalize.');

  console.log(`[API Finalize] Request received for session ${sessionId}`);
  const currentSessionData = sessionRepository.findById(sessionId);
  if (!currentSessionData)
    throw new NotFoundError(`Session ${sessionId} not found for finalization.`);

  if (currentSessionData.status === 'completed') {
    console.log(
      `[API Finalize] Session ${sessionId} is already completed. Returning current data.`
    );
    const chats = chatRepository.findChatsBySessionId(sessionId);
    currentSessionData.chats = chats.map(
      ({ tags, ...rest }) => rest
    ) as BackendSession['chats'];
    set.status = 200;
    return currentSessionData;
  }

  if (currentSessionData.status !== 'transcribing') {
    throw new ConflictError(
      `Session ${sessionId} status is '${currentSessionData.status}', not 'transcribing'.`
    );
  }
  if (!currentSessionData.whisperJobId) {
    throw new InternalServerError(
      `Session ${sessionId} is transcribing but has no Whisper Job ID.`
    );
  }
  const jobId = currentSessionData.whisperJobId;

  try {
    const structuredTranscript = await getStructuredTranscriptionResult(jobId);
    const fullText = structuredTranscript
      .map((p: TranscriptParagraphData) => p.text)
      .join('\n\n'); // Type for p
    const tokenCount = calculateTokenCount(fullText);
    transcriptRepository.insertParagraphs(sessionId, structuredTranscript);
    console.log(
      `[API Finalize] Saved ${structuredTranscript.length} transcript paragraphs to DB for session ${sessionId}.`
    );

    const esTranscriptDocs = structuredTranscript.map(
      (p: TranscriptParagraphData) => ({
        // Type for p
        id: `${sessionId}_${p.id}`,
        document: {
          session_id: sessionId,
          paragraph_index: p.id,
          text: p.text,
          timestamp_ms: p.timestamp,
          client_name: currentSessionData.clientName,
          session_name: currentSessionData.sessionName,
          session_date: currentSessionData.date,
          session_type: currentSessionData.sessionType,
          therapy_type: currentSessionData.therapy,
        },
      })
    );
    if (esTranscriptDocs.length > 0) {
      await bulkIndexDocuments(esClient, TRANSCRIPTS_INDEX, esTranscriptDocs);
    }
    console.log(
      `[API Finalize ES] Indexed ${esTranscriptDocs.length} paragraphs for session ${sessionId}.`
    );

    const finalizedSessionInDb = sessionRepository.updateMetadata(sessionId, {
      status: 'completed',
      transcriptTokenCount: tokenCount,
    });
    if (!finalizedSessionInDb)
      throw new InternalServerError(
        `Failed to update session ${sessionId} status to completed.`
      );

    const finalSessionState = sessionRepository.findById(sessionId);
    if (!finalSessionState)
      throw new InternalServerError(
        `Failed to retrieve session ${sessionId} after finalizing.`
      );

    const chatsMetadataRaw = chatRepository.findChatsBySessionId(sessionId);
    const chatsMetadata = chatsMetadataRaw.map(
      ({ tags, ...restOfChat }) => restOfChat
    ); // Corrected destructuring

    if (!chatsMetadata || chatsMetadata.length === 0) {
      const newFullChat = chatRepository.createChat(sessionId);
      const aiInitialMessageText = `Session "${finalSessionState.sessionName}" uploaded on ${finalSessionState.date.split('T')[0]} has been transcribed and is ready for analysis.`;
      const aiInitialMessage = messageRepository.addMessage(
        newFullChat.id,
        'ai',
        aiInitialMessageText
      );
      await indexDocument(
        esClient,
        MESSAGES_INDEX,
        String(aiInitialMessage.id),
        {
          message_id: String(aiInitialMessage.id),
          chat_id: newFullChat.id,
          session_id: sessionId,
          sender: 'ai',
          text: aiInitialMessageText,
          timestamp: aiInitialMessage.timestamp,
          client_name: finalSessionState.clientName,
          session_name: finalSessionState.sessionName,
        }
      );
      console.log(
        `[API Finalize] Initial chat created (ID: ${newFullChat.id}) and message indexed for session ${sessionId}.`
      );
      const updatedChatsMetadataRaw =
        chatRepository.findChatsBySessionId(sessionId);
      finalSessionState.chats = updatedChatsMetadataRaw.map(
        ({ tags, ...restOfChat }) => restOfChat
      ); // Corrected destructuring
    } else {
      finalSessionState.chats = chatsMetadata;
    }
    console.log(`[API Finalize] Session ${sessionId} finalized successfully.`);
    set.status = 200;
    return finalSessionState;
  } catch (error) {
    console.error(`[API Error] Finalize Session ${sessionId}:`, error);

    if (error instanceof ApiError) throw error;
    throw new InternalServerError(
      `Failed to finalize session ${sessionId}`,
      error instanceof Error ? error : undefined
    );
  }
};

export const deleteSessionAudioHandler = async ({ sessionData, set }: any) => {
  const sessionId = sessionData.id;
  const audioIdentifier = sessionData.audioPath;
  if (!audioIdentifier) {
    throw new NotFoundError(
      `No audio file associated with session ${sessionId} to delete.`
    );
  }
  try {
    await deleteUploadedAudioFile(audioIdentifier);
    console.log(
      `[API Delete Audio] Successfully deleted audio file for identifier: ${audioIdentifier}`
    );
    const updatedSession = sessionRepository.updateMetadata(sessionId, {
      audioPath: null,
    });
    if (!updatedSession) {
      throw new InternalServerError(
        `Failed to update session ${sessionId} after deleting audio file.`
      );
    }
    console.log(
      `[API Delete Audio] Successfully removed audioPath reference from session ${sessionId} record.`
    );
    set.status = 200;
    return {
      message: `Original audio file for session ${sessionId} deleted successfully.`,
    };
  } catch (error) {
    console.error(
      `[API Error] deleteSessionAudio (ID: ${sessionId}, Identifier: ${audioIdentifier}):`,
      error
    );
    if (error instanceof ApiError) throw error;
    throw new InternalServerError(
      'Failed to delete session audio file',
      error instanceof Error ? error : undefined
    );
  }
};
