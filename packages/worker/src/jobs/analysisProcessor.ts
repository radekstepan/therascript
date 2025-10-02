// packages/worker/src/jobs/analysisProcessor.ts
import { Job } from 'bullmq';
import { AnalysisJobData } from '../types.js';
import { analysisRepository } from '@therascript/api/dist/repositories/analysisRepository.js';
import { transcriptRepository } from '@therascript/api/dist/repositories/transcriptRepository.js';
import { sessionRepository } from '@therascript/api/dist/repositories/sessionRepository.js';
import type {
  AnalysisStrategy,
  BackendChatMessage,
  BackendSession,
  IntermediateSummary,
} from '@therascript/api/dist/types/index.js';
import axios from 'axios';
import config from '../config/index.js';

// --- This section is a simplified adaptation from api/src/services/ollamaService ---
async function streamChatResponse(
  chatHistory: BackendChatMessage[],
  options?: { model?: string; contextSize?: number }
): Promise<string> {
  const payload = {
    model: options?.model || 'llama3', // Provide a default
    messages: chatHistory.map((m) => ({
      role: m.sender === 'ai' ? 'assistant' : m.sender,
      content: m.text,
    })),
    stream: false,
    options: options?.contextSize ? { num_ctx: options.contextSize } : {},
  };
  const response = await axios.post(
    `${config.services.ollamaBaseUrl}/api/chat`,
    payload
  );
  return response.data.message.content;
}
// --- End ollamaService adaptation ---

export const analysisQueueName = 'analysis-jobs';

export default async function (job: Job<AnalysisJobData, any, string>) {
  const { jobId } = job.data;
  console.log(`[Analysis Worker] Starting processing for job ID: ${jobId}`);

  try {
    let jobRecord = analysisRepository.getJobById(jobId);
    if (!jobRecord) throw new Error(`Job ${jobId} not found in database.`);
    if (jobRecord.status === 'canceling' || jobRecord.status === 'canceled') {
      await job.updateProgress(100);
      await analysisRepository.updateJobStatus(jobId, 'canceled');
      return;
    }

    let strategy: AnalysisStrategy | null = null;
    if (jobRecord.strategy_json) {
      try {
        strategy = JSON.parse(jobRecord.strategy_json);
      } catch (e) {
        console.error(`[Analysis Worker ${jobId}] Invalid strategy JSON.`);
      }
    }

    await job.updateProgress(5);
    analysisRepository.updateJobStatus(jobId, 'mapping');
    const pendingSummaries =
      analysisRepository.getPendingSummariesForJob(jobId);
    if (pendingSummaries.length === 0)
      throw new Error('No pending summaries to process.');

    for (const summaryTask of pendingSummaries) {
      jobRecord = analysisRepository.getJobById(jobId);
      if (jobRecord?.status === 'canceling') break;

      try {
        analysisRepository.updateIntermediateSummary(
          summaryTask.id,
          'processing'
        );
        const session = sessionRepository.findById(summaryTask.session_id);
        if (!session)
          throw new Error(`Session ${summaryTask.session_id} not found.`);

        const transcriptText = transcriptRepository.getTranscriptTextForSession(
          summaryTask.session_id
        );
        if (!transcriptText.trim()) throw new Error('Transcript is empty.');

        let mapMessages: BackendChatMessage[];
        if (strategy) {
          mapMessages = [
            {
              id: 0,
              chatId: 0,
              sender: 'system',
              text: `Your task is to follow the user's instructions precisely. Original question: "${jobRecord?.original_prompt}"`,
              timestamp: Date.now(),
            },
            {
              id: 1,
              chatId: 0,
              sender: 'user',
              text: `TASK: ${strategy.intermediate_question}\n\nTRANSCRIPT: """${transcriptText}"""`,
              timestamp: Date.now(),
            },
          ];
        } else {
          // Simple strategy
          mapMessages = [
            {
              id: 0,
              chatId: 0,
              sender: 'user',
              text: `USER'S QUESTION: "${jobRecord?.original_prompt}"\n\nTRANSCRIPT: """${transcriptText}"""\n\nYOUR TASK: Analyze the transcript and write a concise summary that directly answers the user's question *only for this specific session*.`,
              timestamp: Date.now(),
            },
          ];
        }
        const summaryText = await streamChatResponse(mapMessages, {
          model: jobRecord?.model_name || undefined,
          contextSize: jobRecord?.context_size || undefined,
        });

        if (!summaryText) throw new Error('LLM returned an empty summary.');
        analysisRepository.updateIntermediateSummary(
          summaryTask.id,
          'completed',
          summaryText
        );
        console.log(
          `[Analysis Worker ${jobId}] Completed summary for session ${summaryTask.session_id}.`
        );
      } catch (mapError: any) {
        analysisRepository.updateIntermediateSummary(
          summaryTask.id,
          'failed',
          null,
          mapError.message
        );
      }
    }

    jobRecord = analysisRepository.getJobById(jobId);
    if (jobRecord?.status === 'canceling') {
      await job.updateProgress(100);
      analysisRepository.updateJobStatus(jobId, 'canceled');
      return;
    }

    await job.updateProgress(50);
    analysisRepository.updateJobStatus(jobId, 'reducing');
    const allSummaries = analysisRepository.getAllSummariesForJob(jobId);
    const successfulSummaries = allSummaries.filter(
      (s: IntermediateSummary) => s.status === 'completed' && s.summary_text
    );
    if (successfulSummaries.length === 0)
      throw new Error('No summaries were successfully generated.');

    const enrichedSummaries = successfulSummaries
      .map((summary: IntermediateSummary) => ({
        summary,
        session: sessionRepository.findById(summary.session_id),
      }))
      .filter(
        (
          item
        ): item is {
          summary: IntermediateSummary;
          session: NonNullable<BackendSession>;
        } => !!item.session
      )
      .sort(
        (a, b) =>
          new Date(a.session.date).getTime() -
          new Date(b.session.date).getTime()
      );

    const intermediateSummariesText = enrichedSummaries
      .map(
        ({ summary, session }) =>
          `--- Analysis from Session "${session.sessionName || session.fileName}" ---\n${summary.summary_text}`
      )
      .join('\n\n');

    let reduceMessages: BackendChatMessage[];
    if (strategy) {
      reduceMessages = [
        {
          id: 0,
          chatId: 0,
          sender: 'system',
          text: strategy.final_synthesis_instructions,
          timestamp: Date.now(),
        },
        {
          id: 1,
          chatId: 0,
          sender: 'user',
          text: `USER'S QUESTION: "${jobRecord?.original_prompt}"\n\nINTERMEDIATE ANSWERS:\n"""${intermediateSummariesText}"""`,
          timestamp: Date.now(),
        },
      ];
    } else {
      reduceMessages = [
        {
          id: 0,
          chatId: 0,
          sender: 'user',
          text: `USER'S QUESTION: "${jobRecord?.original_prompt}"\n\nINTERMEDIATE SUMMARIES:\n"""${intermediateSummariesText}"""\n\nYOUR TASK: Create a single, cohesive answer to the user's question based *only* on the intermediate summaries.`,
          timestamp: Date.now(),
        },
      ];
    }

    const finalResult = await streamChatResponse(reduceMessages, {
      model: jobRecord?.model_name || undefined,
      contextSize: jobRecord?.context_size || undefined,
    });

    if (!finalResult) throw new Error('LLM returned an empty final result.');

    await job.updateProgress(100);
    analysisRepository.updateJobStatus(jobId, 'completed', finalResult);
    console.log(`[Analysis Worker] Job ${jobId} completed successfully.`);
  } catch (error: any) {
    console.error(`[Analysis Worker] FAILED job ${jobId}:`, error);
    const jobRecord = analysisRepository.getJobById(jobId);
    if (
      jobRecord &&
      jobRecord.status !== 'canceling' &&
      jobRecord.status !== 'canceled'
    ) {
      analysisRepository.updateJobStatus(jobId, 'failed', null, error.message);
    } else if (jobRecord) {
      analysisRepository.updateJobStatus(
        jobId,
        'canceled',
        null,
        'Canceled during error handling.'
      );
    }
    throw error; // Re-throw to let BullMQ know the job failed
  }
}
