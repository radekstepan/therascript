// packages/api/src/api/analysisHandler.ts
import { analysisRepository } from '../repositories/analysisRepository.js';
import { sessionRepository } from '../repositories/sessionRepository.js';
import { processAnalysisJob } from '../services/analysisJobService.js';
import {
  InternalServerError,
  NotFoundError,
  ConflictError,
  ApiError,
} from '../errors.js';
import type {
  AnalysisJob,
  AnalysisJobWithDetails,
  IntermediateSummaryWithSessionName,
} from '../types/index.js';
import { streamChatResponse } from '../services/ollamaService.js';
import { cleanLlmOutput } from '../utils/helpers.js';
import type { ChatResponse } from 'ollama';

// This helper is also in analysisJobService.ts. Consider moving to a shared util.
async function accumulateStreamResponse(
  stream: AsyncIterable<ChatResponse>
): Promise<string> {
  let fullText = '';
  for await (const chunk of stream) {
    if (chunk.message?.content) {
      fullText += chunk.message.content;
    }
  }
  return cleanLlmOutput(fullText);
}

export const createAnalysisJobHandler = async ({
  body,
  set,
}: any): Promise<{ jobId: number }> => {
  const { sessionIds, prompt, modelName, contextSize } = body as {
    sessionIds: number[];
    prompt: string;
    modelName?: string;
    contextSize?: number;
  };
  try {
    // Generate a short prompt
    const summarizePrompt = `Summarize the following user request into a very short, title-like phrase of no more than 5 words. Do not use quotes or introductory phrases.

REQUEST: "${prompt}"`;

    const stream = await streamChatResponse(
      null,
      [
        {
          id: 0,
          chatId: 0,
          sender: 'user',
          text: summarizePrompt,
          timestamp: Date.now(),
        },
      ],
      { model: modelName || undefined } // Use the specified model if available
    );
    const shortPrompt = await accumulateStreamResponse(stream);

    const newJob = analysisRepository.createJob(
      prompt,
      shortPrompt || `Analysis - ${prompt.substring(0, 20)}...`,
      sessionIds,
      modelName || null,
      contextSize || null
    );

    // Trigger the background processing asynchronously (fire and forget)
    void processAnalysisJob(newJob.id);

    set.status = 202; // Accepted
    return { jobId: newJob.id };
  } catch (error) {
    console.error('[AnalysisHandler] Error creating analysis job:', error);
    throw new InternalServerError(
      'Failed to create analysis job.',
      error instanceof Error ? error : undefined
    );
  }
};

export const listAnalysisJobsHandler = ({ set }: any): AnalysisJob[] => {
  try {
    const jobs = analysisRepository.listJobs();
    set.status = 200;
    return jobs;
  } catch (error) {
    console.error('[AnalysisHandler] Error listing analysis jobs:', error);
    throw new InternalServerError(
      'Failed to list analysis jobs.',
      error instanceof Error ? error : undefined
    );
  }
};

export const getAnalysisJobHandler = ({
  params,
  set,
}: any): AnalysisJobWithDetails => {
  const jobId = parseInt(params.jobId, 10);
  try {
    const job = analysisRepository.getJobById(jobId);
    if (!job) {
      throw new NotFoundError(`Analysis job with ID ${jobId}`);
    }

    // NEW: Fetch intermediate summaries
    const summaries = analysisRepository.getAllSummariesForJob(jobId);
    const summariesWithSessionNames: IntermediateSummaryWithSessionName[] =
      summaries.map((summary) => {
        const session = sessionRepository.findById(summary.session_id);
        return {
          ...summary,
          sessionName:
            session?.sessionName ||
            session?.fileName ||
            `Session ID ${summary.session_id}`,
        };
      });

    set.status = 200;
    return {
      ...job,
      summaries: summariesWithSessionNames,
    };
  } catch (error) {
    console.error(`[AnalysisHandler] Error getting job ${jobId}:`, error);
    if (error instanceof NotFoundError) throw error;
    throw new InternalServerError(
      'Failed to get analysis job details.',
      error instanceof Error ? error : undefined
    );
  }
};

export const cancelAnalysisJobHandler = ({
  params,
  set,
}: any): { message: string } => {
  const jobId = parseInt(params.jobId, 10);
  try {
    const job = analysisRepository.getJobById(jobId);
    if (!job) {
      throw new NotFoundError(`Analysis job with ID ${jobId}`);
    }
    if (
      job.status === 'completed' ||
      job.status === 'failed' ||
      job.status === 'canceled'
    ) {
      throw new ConflictError(
        `Job ${jobId} is already in a terminal state (${job.status}) and cannot be canceled.`
      );
    }
    analysisRepository.updateJobStatus(jobId, 'canceling');
    set.status = 202;
    return { message: `Cancellation request for job ${jobId} accepted.` };
  } catch (error) {
    console.error(`[AnalysisHandler] Error canceling job ${jobId}:`, error);
    if (error instanceof ApiError) throw error;
    throw new InternalServerError(
      'Failed to cancel analysis job.',
      error instanceof Error ? error : undefined
    );
  }
};

export const deleteAnalysisJobHandler = ({
  params,
  set,
}: any): { message: string } => {
  const jobId = parseInt(params.jobId, 10);
  try {
    const deleted = analysisRepository.deleteJob(jobId);
    if (!deleted) {
      throw new NotFoundError(`Analysis job with ID ${jobId}`);
    }
    set.status = 200;
    return {
      message: `Analysis job ${jobId} and all associated data deleted.`,
    };
  } catch (error) {
    console.error(`[AnalysisHandler] Error deleting job ${jobId}:`, error);
    if (error instanceof ApiError) throw error;
    throw new InternalServerError(
      'Failed to delete analysis job.',
      error instanceof Error ? error : undefined
    );
  }
};
