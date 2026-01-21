// packages/worker/src/jobs/analysisProcessor.ts
import { Job } from 'bullmq';
import { AnalysisJobData } from '../types.js';
import {
  analysisRepository,
  transcriptRepository,
  sessionRepository,
  usageRepository,
} from '@therascript/data';
import type {
  AnalysisStrategy,
  BackendChatMessage,
  BackendSession,
  IntermediateSummary,
} from '@therascript/domain';
import { streamLlmChat, type StreamResult } from '@therascript/services';
import config from '@therascript/config';
import { publishStreamEvent } from '../services/streamPublisher.js';

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
      publishStreamEvent(jobId, {
        phase: 'status',
        type: 'status',
        status: 'canceled',
      });
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
    publishStreamEvent(jobId, {
      phase: 'map',
      type: 'status',
      status: 'mapping',
    });

    const pendingSummaries =
      analysisRepository.getPendingSummariesForJob(jobId);
    if (pendingSummaries.length === 0) {
      // It's possible the map phase was partially done or we are restarting.
      // Check if we can proceed to reduce.
      const allSummaries = analysisRepository.getAllSummariesForJob(jobId);
      if (allSummaries.length === 0) {
        throw new Error('No summaries tasks found.');
      }
    }

    // --- MAP PHASE ---
    for (const summaryTask of pendingSummaries) {
      jobRecord = analysisRepository.getJobById(jobId);
      if (jobRecord?.status === 'canceling') break;

      try {
        analysisRepository.updateIntermediateSummary(
          summaryTask.id,
          'processing'
        );
        publishStreamEvent(jobId, {
          phase: 'map',
          type: 'start',
          sessionId: summaryTask.session_id,
          summaryId: summaryTask.id,
        });

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

        let summaryText = '';
        let chunkBuffer = '';
        let lastPublish = Date.now();
        let lastCancelCheck = Date.now();
        const abortController = new AbortController();
        let mapStreamResult: StreamResult = {};

        const mapStartTime = Date.now();
        const mapGenerator = streamLlmChat(mapMessages, {
          model: jobRecord?.model_name || undefined,
          contextSize: jobRecord?.context_size || undefined,
          abortSignal: abortController.signal,
          ollamaBaseUrl: config.ollama.baseURL,
        });
        let iterResult = await mapGenerator.next();
        while (!iterResult.done) {
          const chunk = iterResult.value;
          summaryText += chunk;
          chunkBuffer += chunk;

          if (Date.now() - lastPublish > 100) {
            publishStreamEvent(jobId, {
              phase: 'map',
              type: 'token',
              summaryId: summaryTask.id,
              delta: chunkBuffer,
            });
            chunkBuffer = '';
            lastPublish = Date.now();
          }

          if (Date.now() - lastCancelCheck > 500) {
            lastCancelCheck = Date.now();
            const freshJob = analysisRepository.getJobById(jobId);
            if (freshJob?.status === 'canceling') {
              abortController.abort();
              break;
            }
          }

          iterResult = await mapGenerator.next();
        }
        mapStreamResult = iterResult.value as StreamResult;
        const mapDuration = Date.now() - mapStartTime;

        if (chunkBuffer) {
          publishStreamEvent(jobId, {
            phase: 'map',
            type: 'token',
            summaryId: summaryTask.id,
            delta: chunkBuffer,
          });
        }

        if (!summaryText) throw new Error('LLM returned an empty summary.');

        try {
          usageRepository.insertUsageLog({
            type: 'llm',
            source: 'analysis_map',
            model: jobRecord?.model_name || 'llama3',
            promptTokens: mapStreamResult.promptTokens,
            completionTokens: mapStreamResult.completionTokens,
            duration: mapDuration,
          });
        } catch (err) {
          console.warn(
            `[Analysis Worker ${jobId}] Failed to log usage for session ${summaryTask.session_id}:`,
            err
          );
        }

        analysisRepository.updateIntermediateSummary(
          summaryTask.id,
          'completed',
          summaryText
        );
        publishStreamEvent(jobId, {
          phase: 'map',
          type: 'end',
          summaryId: summaryTask.id,
        });

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
        publishStreamEvent(jobId, {
          phase: 'map',
          type: 'error',
          summaryId: summaryTask.id,
          message: mapError.message,
        });
      }
    }

    jobRecord = analysisRepository.getJobById(jobId);
    if (jobRecord?.status === 'canceling') {
      await job.updateProgress(100);
      analysisRepository.updateJobStatus(jobId, 'canceled');
      publishStreamEvent(jobId, {
        phase: 'status',
        type: 'status',
        status: 'canceled',
      });
      return;
    }

    // --- REDUCE PHASE ---
    await job.updateProgress(50);
    analysisRepository.updateJobStatus(jobId, 'reducing');
    publishStreamEvent(jobId, {
      phase: 'reduce',
      type: 'status',
      status: 'reducing',
    });

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

    publishStreamEvent(jobId, { phase: 'reduce', type: 'start' });

    let finalResult = '';
    let reduceBuffer = '';
    let lastReducePublish = Date.now();
    let lastReduceCancelCheck = Date.now();
    const reduceAbortController = new AbortController();
    let reduceStreamResult: StreamResult = {};

    const reduceStartTime = Date.now();
    const reduceGenerator = streamLlmChat(reduceMessages, {
      model: jobRecord?.model_name || undefined,
      contextSize: jobRecord?.context_size || undefined,
      abortSignal: reduceAbortController.signal,
      ollamaBaseUrl: config.ollama.baseURL,
    });
    let reduceIterResult = await reduceGenerator.next();
    while (!reduceIterResult.done) {
      const chunk = reduceIterResult.value;
      finalResult += chunk;
      reduceBuffer += chunk;

      if (Date.now() - lastReducePublish > 100) {
        publishStreamEvent(jobId, {
          phase: 'reduce',
          type: 'token',
          delta: reduceBuffer,
        });
        reduceBuffer = '';
        lastReducePublish = Date.now();
      }

      if (Date.now() - lastReduceCancelCheck > 500) {
        lastReduceCancelCheck = Date.now();
        const freshJob = analysisRepository.getJobById(jobId);
        if (freshJob?.status === 'canceling') {
          reduceAbortController.abort();
          publishStreamEvent(jobId, {
            phase: 'status',
            type: 'status',
            status: 'canceled',
          });
          analysisRepository.updateJobStatus(jobId, 'canceled');
          return;
        }
      }

      reduceIterResult = await reduceGenerator.next();
    }
    reduceStreamResult = reduceIterResult.value as StreamResult;
    const reduceDuration = Date.now() - reduceStartTime;

    if (reduceBuffer) {
      publishStreamEvent(jobId, {
        phase: 'reduce',
        type: 'token',
        delta: reduceBuffer,
      });
    }

    if (!finalResult) throw new Error('LLM returned an empty final result.');

    try {
      usageRepository.insertUsageLog({
        type: 'llm',
        source: 'analysis_reduce',
        model: jobRecord?.model_name || 'llama3',
        promptTokens: reduceStreamResult.promptTokens,
        completionTokens: reduceStreamResult.completionTokens,
        duration: reduceDuration,
      });
    } catch (err) {
      console.warn(
        `[Analysis Worker ${jobId}] Failed to log usage for reduce phase:`,
        err
      );
    }

    publishStreamEvent(jobId, { phase: 'reduce', type: 'end' });

    await job.updateProgress(100);
    analysisRepository.updateJobStatus(jobId, 'completed', finalResult);
    publishStreamEvent(jobId, {
      phase: 'status',
      type: 'status',
      status: 'completed',
    });

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
      publishStreamEvent(jobId, {
        phase: 'status',
        type: 'error',
        status: 'failed',
        message: error.message,
      });
    } else if (jobRecord) {
      analysisRepository.updateJobStatus(
        jobId,
        'canceled',
        null,
        'Canceled during error handling.'
      );
    }
    throw error;
  }
}
