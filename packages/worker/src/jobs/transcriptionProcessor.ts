// packages/worker/src/jobs/transcriptionProcessor.ts
import { Job } from 'bullmq';
import { TranscriptionJobData } from '../types.js';
import {
  sessionRepository,
  transcriptRepository,
  messageRepository,
  chatRepository,
  usageRepository,
} from '@therascript/data';
import {
  calculateTokenCount,
  getAudioAbsolutePath,
} from '@therascript/services';
import type {
  StructuredTranscript,
  WhisperJobStatus,
  WhisperSegment,
  TranscriptParagraphData,
} from '@therascript/domain';
import {
  getElasticsearchClient,
  indexDocument,
  bulkIndexDocuments,
  TRANSCRIPTS_INDEX,
  MESSAGES_INDEX,
} from '@therascript/elasticsearch-client';
import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import config from '@therascript/config';
import { safeValidateTranscriptionJob } from '@therascript/domain';

const esClient = getElasticsearchClient(config.elasticsearch.url);

async function startWhisperJob(
  filePath: string,
  numSpeakers: number
): Promise<string> {
  const form = new FormData();
  form.append('file', fs.createReadStream(filePath));
  form.append('model_name', config.whisper.model);
  form.append('num_speakers', String(numSpeakers));

  const response = await axios.post(
    `${config.whisper.apiUrl}/transcribe`,
    form,
    {
      headers: form.getHeaders(),
      timeout: 60000,
    }
  );

  if (response.status !== 202 || !response.data.job_id) {
    throw new Error('Failed to submit transcription job to Whisper service.');
  }
  return response.data.job_id;
}

async function pollWhisperStatus(
  whisperJobId: string
): Promise<WhisperJobStatus> {
  const inactivityTimeoutMs = config.whisper.inactivityTimeoutMs;
  let lastProgress: number | null = null;
  let lastStatus: string | null = null;
  let lastMessage: string | null = null;
  let lastActivityTime = Date.now();

  while (true) {
    const { data: status } = await axios.get<WhisperJobStatus>(
      `${config.whisper.apiUrl}/status/${whisperJobId}`,
      { timeout: 10000 }
    );
    // Treat a successful status poll as activity (log heartbeat)
    lastActivityTime = Date.now();

    // Track activity: if progress, status, or message changed, reset timer
    const currentMessage = status.message ?? null;
    const hasActivity =
      status.progress !== lastProgress ||
      status.status !== lastStatus ||
      currentMessage !== lastMessage;

    if (hasActivity) {
      console.log(
        `[Whisper Poll] Job ${whisperJobId}: status=${status.status}, progress=${status.progress ?? 'N/A'}, message=${currentMessage ?? 'N/A'}`
      );
      lastProgress = status.progress ?? null;
      lastStatus = status.status;
      lastMessage = currentMessage;
    } else {
      const idleSeconds = Math.round((Date.now() - lastActivityTime) / 1000);
      if (idleSeconds > 60 && idleSeconds % 30 === 0) {
        // Log every 30s after 1 minute idle
        console.log(
          `[Whisper Poll] Job ${whisperJobId}: No activity for ${idleSeconds}s (timeout at ${Math.round(inactivityTimeoutMs / 1000)}s). Last status=${lastStatus}, progress=${lastProgress ?? 'N/A'}`
        );
      }
    }

    const timeSinceLastActivity = Date.now() - lastActivityTime;
    if (timeSinceLastActivity > inactivityTimeoutMs) {
      throw new Error(
        `Whisper job ${whisperJobId} timed out due to ${Math.round(inactivityTimeoutMs / 60000)} minutes of inactivity`
      );
    }

    if (
      status.status === 'completed' ||
      status.status === 'failed' ||
      status.status === 'canceled'
    ) {
      return status;
    }

    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

function groupSegmentsIntoParagraphs(
  segments: WhisperSegment[]
): StructuredTranscript {
  if (!segments || segments.length === 0) return [];
  const paragraphs: TranscriptParagraphData[] = [];
  let currentText = '';
  let currentSpeaker: string | undefined = undefined;
  let startTimeMs = segments[0]?.start * 1000 || 0;
  let paragraphIndex = 0;

  segments.forEach((segment, index) => {
    const segmentText = segment.text.trim();
    const segmentSpeaker = segment.speaker ?? undefined;

    // Split on speaker change
    if (segmentSpeaker !== currentSpeaker && currentText) {
      paragraphs.push({
        id: paragraphIndex++,
        timestamp: Math.round(startTimeMs),
        text: currentText,
        speaker: currentSpeaker,
      });
      currentText = '';
    }

    if (segmentText) {
      if (!currentText) startTimeMs = segment.start * 1000;
      currentText += (currentText ? ' ' : '') + segmentText;
      currentSpeaker = segmentSpeaker;
    }

    const nextSegment = segments[index + 1];
    const timeGapMs = nextSegment
      ? (nextSegment.start - segment.end) * 1000
      : Infinity;
    const endsWithPunctuation = /[.!?]$/.test(segment.text.trim());

    // Also split on time gaps (existing logic)
    if (
      index === segments.length - 1 ||
      timeGapMs > 1000 ||
      (endsWithPunctuation && timeGapMs > 500)
    ) {
      if (currentText) {
        paragraphs.push({
          id: paragraphIndex++,
          timestamp: Math.round(startTimeMs),
          text: currentText,
          speaker: currentSpeaker,
        });
        currentText = '';
        currentSpeaker = undefined;
      }
    }
  });

  return paragraphs.filter((p) => p.text);
}

export default async function (job: Job<TranscriptionJobData, any, string>) {
  const validationResult = safeValidateTranscriptionJob(job.data);
  if (!validationResult.success) {
    const error = new Error(
      `Invalid transcription job payload: ${validationResult.error.errors.map((e) => e.message).join(', ')}`
    );
    console.error('[Transcription Worker] Validation error:', error);
    throw error;
  }

  const { sessionId } = validationResult.data;
  console.log(
    `[Transcription Worker] Starting job for session ID: ${sessionId}`
  );

  const session = sessionRepository.findById(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found.`);

  const audioPath = getAudioAbsolutePath(session.audioPath);
  if (!audioPath) {
    throw new Error(
      `Audio path for session ${sessionId} is invalid or missing.`
    );
  }

  try {
    let durationInt: number | null = null;
    await job.updateProgress(5);
    sessionRepository.updateMetadata(sessionId, { status: 'transcribing' });

    const whisperJobId = await startWhisperJob(
      audioPath,
      validationResult.data.numSpeakers ?? config.whisper.numSpeakers
    );
    sessionRepository.updateMetadata(sessionId, { whisperJobId });
    await job.updateProgress(10);

    const finalStatus = await pollWhisperStatus(whisperJobId);
    if (finalStatus.status !== 'completed' || !finalStatus.result?.segments) {
      throw new Error(
        `Whisper job ${whisperJobId} failed or returned no segments. Status: ${finalStatus.status}. Error: ${finalStatus.error || 'Unknown error'}`
      );
    }
    if (!finalStatus.result.segments.some((s) => s.speaker != null)) {
      throw new Error(
        `Whisper job ${whisperJobId} completed without diarization — all speaker labels are null. Ensure HF_TOKEN is set and the diarization model is cached.`
      );
    }

    try {
      // Duration is on WhisperJobStatus directly, not on result
      const durationSec = finalStatus.duration ?? null;
      durationInt = durationSec != null ? Math.round(durationSec) : null;
      if (durationInt !== null) {
        usageRepository.insertUsageLog({
          type: 'whisper',
          source: 'whisper_transcription',
          model: config.whisper.model,
          duration: durationInt,
        });
      }
    } catch (err) {
      console.warn(
        `[Transcription Worker] Failed to log usage for session ${sessionId}:`,
        err
      );
    }

    await job.updateProgress(80);
    const structuredTranscript = groupSegmentsIntoParagraphs(
      finalStatus.result.segments
    );
    const fullText = structuredTranscript
      .map((p: TranscriptParagraphData) => p.text)
      .join('\n\n');
    const tokenCount = calculateTokenCount(fullText);

    transcriptRepository.insertParagraphs(sessionId, structuredTranscript);

    // Index transcript paragraphs in ES
    const esTranscriptDocs = structuredTranscript.map(
      (p: TranscriptParagraphData) => ({
        id: `${sessionId}_${p.id}`,
        document: {
          session_id: sessionId,
          paragraph_index: p.id,
          text: p.text,
          speaker: p.speaker ?? null,
          timestamp_ms: p.timestamp,
          client_name: session.clientName,
          session_name: session.sessionName,
          session_date: session.date,
          session_type: session.sessionType,
          therapy_type: session.therapy,
        },
      })
    );
    if (esTranscriptDocs.length > 0) {
      await bulkIndexDocuments(esClient, TRANSCRIPTS_INDEX, esTranscriptDocs);
    }

    sessionRepository.updateMetadata(sessionId, {
      status: 'completed',
      transcriptTokenCount: tokenCount,
      duration: durationInt,
      errorMessage: null, // Clear any previous errors
    });

    // Create initial chat
    const newChat = chatRepository.createChat(sessionId);
    const aiMessageText = `Session "${session.sessionName}" has been transcribed and is ready for analysis.`;
    const aiMessage = messageRepository.addMessage(
      newChat.id,
      'ai',
      aiMessageText
    );

    // Index initial AI message
    await indexDocument(esClient, MESSAGES_INDEX, String(aiMessage.id), {
      message_id: String(aiMessage.id),
      chat_id: newChat.id,
      session_id: sessionId,
      sender: 'ai',
      text: aiMessageText,
      timestamp: aiMessage.timestamp,
      client_name: session.clientName,
      session_name: session.sessionName,
    });

    await job.updateProgress(100);
    console.log(
      `[Transcription Worker] Job for session ${sessionId} completed successfully.`
    );
  } catch (error: any) {
    console.error(
      `[Transcription Worker] FAILED job for session ${sessionId}:`,
      error
    );
    // Persist the error message to the database
    const errorMessage =
      error instanceof Error ? error.message : String(error).substring(0, 500);

    sessionRepository.updateMetadata(sessionId, {
      status: 'failed',
      errorMessage: errorMessage,
    });
    throw error; // Re-throw to let BullMQ know the job failed
  }
}
