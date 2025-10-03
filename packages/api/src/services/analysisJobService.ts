// packages/api/src/services/analysisJobService.ts
import { analysisRepository } from '../repositories/analysisRepository.js';
import { transcriptRepository } from '../repositories/transcriptRepository.js';
import { sessionRepository } from '../repositories/sessionRepository.js';
import { streamChatResponse } from './ollamaService.js';
import { cleanLlmOutput } from '../utils/helpers.js';
import type { ChatResponse } from 'ollama';
import type {
  IntermediateSummary,
  BackendSession as Session,
  AnalysisStrategy,
  BackendChatMessage,
} from '../types/index.js';

/**
 * Consumes an async iterable stream from the Ollama service and concatenates the content.
 */
async function accumulateStreamResponse(
  stream: AsyncIterable<ChatResponse>
): Promise<string> {
  let fullText = '';
  for await (const chunk of stream) {
    if (chunk.message?.content) {
      fullText += chunk.message.content;
    }
    if (chunk.done) {
      // Final chunk might contain metadata, but we only need the accumulated text.
    }
  }
  return cleanLlmOutput(fullText);
}

/**
 * The main asynchronous function that processes a multi-transcript analysis job.
 * This function is designed to be "fire-and-forget".
 * @param jobId The ID of the analysis job to process.
 */
export async function processAnalysisJob(jobId: number): Promise<void> {
  console.log(`[AnalysisService] Starting processing for job ID: ${jobId}`);

  try {
    // Initial check for cancellation
    let job = analysisRepository.getJobById(jobId);
    if (!job || job.status === 'canceling' || job.status === 'canceled') {
      console.log(
        `[AnalysisService Job ${jobId}] Job canceled before starting.`
      );
      analysisRepository.updateJobStatus(jobId, 'canceled');
      return;
    }

    // --- STRATEGY DECODING ---
    let strategy: AnalysisStrategy | null = null;
    if (job.strategy_json) {
      try {
        strategy = JSON.parse(job.strategy_json);
      } catch (e) {
        // If JSON is invalid, we can treat it as if there's no strategy
        console.error(
          `[AnalysisService Job ${jobId}] Invalid analysis strategy JSON. Falling back to simple mode. Error:`,
          e
        );
      }
    } else {
      console.log(
        `[AnalysisService Job ${jobId}] No advanced strategy found. Using simple summarization mode.`
      );
    }

    // --- MAP PHASE ---
    console.log(`[AnalysisService Job ${jobId}] ==> Starting MAP phase.`);
    analysisRepository.updateJobStatus(jobId, 'mapping');

    const pendingSummaries =
      analysisRepository.getPendingSummariesForJob(jobId);
    if (pendingSummaries.length === 0) {
      throw new Error('Job started with no pending summaries to process.');
    }

    const mapPromises = pendingSummaries.map(async (summaryTask) => {
      // Check for cancellation before processing each task
      const currentJobState = analysisRepository.getJobById(jobId);
      if (
        currentJobState?.status === 'canceling' ||
        currentJobState?.status === 'canceled'
      ) {
        console.log(
          `[AnalysisService Job ${jobId}] Cancellation detected during map phase for session ${summaryTask.session_id}.`
        );
        return; // Skip this task
      }

      try {
        analysisRepository.updateIntermediateSummary(
          summaryTask.id,
          'processing'
        );

        const job = analysisRepository.getJobById(jobId); // Re-fetch job to get details
        if (!job)
          throw new Error(`Main job ${jobId} disappeared during processing.`);

        const session = sessionRepository.findById(summaryTask.session_id);
        if (!session) {
          throw new Error(
            `Session with ID ${summaryTask.session_id} not found during map phase.`
          );
        }
        const sessionName = session.sessionName || session.fileName;

        const transcriptText = transcriptRepository.getTranscriptTextForSession(
          summaryTask.session_id
        );
        if (!transcriptText.trim()) {
          throw new Error('Transcript is empty or not available.');
        }

        let mapMessages: BackendChatMessage[];

        if (strategy) {
          // ADVANCED STRATEGY
          mapMessages = [
            {
              id: 0,
              chatId: 0,
              sender: 'system',
              text: `You are an AI assistant analyzing a single therapy session transcript. Your task is to follow the user's instructions precisely. The user's original high-level question was: "${job.original_prompt}"`,
              timestamp: Date.now(),
            },
            {
              id: 1,
              chatId: 0,
              sender: 'user',
              text: `
TASK:
${strategy.intermediate_question}

TRANSCRIPT TO ANALYZE (Session: "${sessionName}"):
"""
${transcriptText}
"""
            `,
              timestamp: Date.now(),
            },
          ];
        } else {
          // SIMPLE (FALLBACK) STRATEGY
          const simpleMapPrompt = `
USER'S QUESTION: "${job.original_prompt}"

SESSION NAME: "${sessionName}"

TRANSCRIPT FOR SESSION "${sessionName}":
"""
${transcriptText}
"""

YOUR TASK: Analyze the single transcript for the session named "${sessionName}" provided above and write a concise summary that directly answers the user's question *only for this specific session*.
Extract only the most relevant information. Do not add any introductory or concluding phrases like "In this session..." or "To summarize...".
Do not synthesize an answer across multiple sessions. Stick strictly to the provided transcript.
        `;
          mapMessages = [
            {
              id: 0,
              chatId: 0,
              sender: 'user',
              text: simpleMapPrompt,
              timestamp: Date.now(),
            },
          ];
        }

        const stream = await streamChatResponse(null, mapMessages, {
          model: job.model_name || undefined,
          contextSize: job.context_size || undefined,
        });
        const summaryText = await accumulateStreamResponse(stream);

        if (!summaryText) {
          throw new Error('LLM returned an empty summary.');
        }

        analysisRepository.updateIntermediateSummary(
          summaryTask.id,
          'completed',
          summaryText
        );
        console.log(
          `[AnalysisService Job ${jobId}] Successfully completed summary for session ${summaryTask.session_id}.`
        );
      } catch (mapError: any) {
        console.error(
          `[AnalysisService Job ${jobId}] ERROR processing summary for session ${summaryTask.session_id}:`,
          mapError
        );
        analysisRepository.updateIntermediateSummary(
          summaryTask.id,
          'failed',
          null,
          mapError.message
        );
      }
    });

    await Promise.all(mapPromises);
    console.log(`[AnalysisService Job ${jobId}] <== Finished MAP phase.`);

    // Check for cancellation after map phase
    job = analysisRepository.getJobById(jobId);
    if (job?.status === 'canceling' || job?.status === 'canceled') {
      analysisRepository.updateJobStatus(jobId, 'canceled');
      console.log(
        `[AnalysisService Job ${jobId}] Job canceled after map phase.`
      );
      return;
    }

    // --- REDUCE PHASE ---
    const allSummaries = analysisRepository.getAllSummariesForJob(jobId);
    const successfulSummaries = allSummaries.filter(
      (s) => s.status === 'completed' && s.summary_text
    );

    if (successfulSummaries.length === 0) {
      throw new Error(
        'No summaries were successfully generated in the map phase.'
      );
    }

    if (successfulSummaries.length < allSummaries.length) {
      console.warn(
        `[AnalysisService Job ${jobId}] Not all summaries were successful. Proceeding with ${successfulSummaries.length} of ${allSummaries.length}.`
      );
    }

    console.log(`[AnalysisService Job ${jobId}] ==> Starting REDUCE phase.`);
    analysisRepository.updateJobStatus(jobId, 'reducing');

    job = analysisRepository.getJobById(jobId); // Re-fetch for updated status and details
    if (!job)
      throw new Error(`Main job ${jobId} disappeared before reduce phase.`);

    const enrichedSummaries = successfulSummaries
      .map((summary) => {
        const session = sessionRepository.findById(summary.session_id);
        return { summary, session };
      })
      .filter(
        (
          item
        ): item is {
          summary: IntermediateSummary;
          session: NonNullable<Session>;
        } => !!item.session
      )
      .sort(
        (a, b) =>
          new Date(a.session.date).getTime() -
          new Date(b.session.date).getTime()
      );

    const intermediateSummariesText = enrichedSummaries
      .map(({ summary, session }) => {
        const sessionName =
          session.sessionName ||
          session.fileName ||
          `Session ID ${summary.session_id}`;
        return `--- Analysis from Session "${sessionName}" ---\n${summary.summary_text}`;
      })
      .join('\n\n');

    let reduceMessages: BackendChatMessage[];

    if (strategy) {
      // ADVANCED STRATEGY
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
          text: `
USER'S ORIGINAL QUESTION: "${job.original_prompt}"

INTERMEDIATE ANSWERS (in chronological order):
"""
${intermediateSummariesText}
"""
        `,
          timestamp: Date.now(),
        },
      ];
    } else {
      // SIMPLE (FALLBACK) STRATEGY
      const simpleReducePrompt = `
USER'S ORIGINAL QUESTION: "${job.original_prompt}"

INTERMEDIATE SUMMARIES:
"""
${intermediateSummariesText}
"""

YOUR TASK: You are an expert synthesizer. Your job is to create a single, cohesive, high-level answer to the user's original question.
Base your answer *only* on the information provided in the "INTERMEDIATE SUMMARIES" section above.
Do not simply list the summaries. Integrate the findings into a comprehensive response.
If the summaries provide conflicting information, note the discrepancy.
If a theme is present in multiple summaries, highlight it.
    `;
      reduceMessages = [
        {
          id: 0,
          chatId: 0,
          sender: 'user',
          text: simpleReducePrompt,
          timestamp: Date.now(),
        },
      ];
    }

    const stream = await streamChatResponse(null, reduceMessages, {
      model: job.model_name || undefined,
      contextSize: job.context_size || undefined,
    });
    const finalResult = await accumulateStreamResponse(stream);

    if (!finalResult) {
      throw new Error(
        'LLM returned an empty final result during reduce phase.'
      );
    }

    // Final check before marking as complete
    const finalJobState = analysisRepository.getJobById(jobId);
    if (
      finalJobState?.status === 'canceling' ||
      finalJobState?.status === 'canceled'
    ) {
      analysisRepository.updateJobStatus(jobId, 'canceled');
      console.log(
        `[AnalysisService Job ${jobId}] Job canceled just before completion.`
      );
      return;
    }

    analysisRepository.updateJobStatus(jobId, 'completed', finalResult);
    console.log(
      `[AnalysisService Job ${jobId}] <== Finished REDUCE phase. Job complete.`
    );
  } catch (error: any) {
    console.error(`[AnalysisService] FATAL ERROR for job ID ${jobId}:`, error);
    // Check if the job was canceled, otherwise mark as failed
    const job = analysisRepository.getJobById(jobId);
    if (job && job.status !== 'canceling' && job.status !== 'canceled') {
      analysisRepository.updateJobStatus(jobId, 'failed', null, error.message);
    } else {
      analysisRepository.updateJobStatus(
        jobId,
        'canceled',
        null,
        'Canceled during error handling.'
      );
    }
  }
}
