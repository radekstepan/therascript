// packages/api/src/api/analysisHandler.ts
import { analysisRepository } from '../repositories/analysisRepository.js';
import { sessionRepository } from '../repositories/sessionRepository.js';
import { templateRepository } from '../repositories/templateRepository.js';
import { SYSTEM_PROMPT_TEMPLATES } from '@therascript/db/dist/sqliteService.js';
import { processAnalysisJob } from '../services/analysisJobService.js';
import { listModels, streamChatResponse } from '../services/ollamaService.js';
import { calculateTokenCount } from '../services/tokenizerService.js';
import {
  InternalServerError,
  NotFoundError,
  ConflictError,
  ApiError,
  BadRequestError,
} from '../errors.js';
import type {
  AnalysisJob,
  AnalysisJobWithDetails,
  IntermediateSummaryWithSessionName,
  AnalysisStrategy,
} from '../types/index.js';
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

const getSystemPrompt = (
  title: 'system_analysis_strategist' | 'system_short_prompt_generator'
): string => {
  const template = templateRepository.findByTitle(title);
  if (template) {
    return template.text;
  }
  console.warn(
    `[AnalysisHandler] System template "${title}" not found in DB. Using hardcoded fallback.`
  );
  if (title === 'system_analysis_strategist') {
    return SYSTEM_PROMPT_TEMPLATES.ANALYSIS_STRATEGIST.text;
  }
  return SYSTEM_PROMPT_TEMPLATES.SHORT_PROMPT_GENERATOR.text;
};

const generateShortPromptInBackground = async (
  jobId: number,
  originalPrompt: string,
  modelName?: string | null
) => {
  try {
    console.log(`[Analysis BG ${jobId}] Generating short prompt...`);

    const promptTemplate = getSystemPrompt('system_short_prompt_generator');
    const summarizePrompt = promptTemplate.replace(
      '{{USER_PROMPT}}',
      originalPrompt
    );

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
      { model: modelName || undefined }
    );
    const shortPrompt = await accumulateStreamResponse(stream);

    if (shortPrompt) {
      analysisRepository.updateJobShortPrompt(jobId, shortPrompt);
      console.log(
        `[Analysis BG ${jobId}] Updated short prompt to: "${shortPrompt}"`
      );
    } else {
      console.warn(
        `[Analysis BG ${jobId}] Failed to generate a valid short prompt.`
      );
      analysisRepository.updateJobShortPrompt(
        jobId,
        `Analysis - ${originalPrompt.substring(0, 30)}...`
      );
    }
  } catch (error) {
    console.error(
      `[Analysis BG ${jobId}] Error generating short prompt:`,
      error
    );
    analysisRepository.updateJobShortPrompt(
      jobId,
      `Analysis - ${originalPrompt.substring(0, 30)}...`
    );
  }
};

const generateStrategyAndUpdateJob = async (
  jobId: number,
  originalPrompt: string,
  modelName?: string | null
) => {
  try {
    console.log(`[Analysis BG ${jobId}] Generating advanced strategy...`);
    const promptTemplate = getSystemPrompt('system_analysis_strategist');
    const strategistSystemPrompt = promptTemplate.replace(
      '{{USER_PROMPT}}',
      originalPrompt
    );

    const stream = await streamChatResponse(
      null,
      [
        {
          id: 0,
          chatId: 0,
          sender: 'user',
          text: strategistSystemPrompt,
          timestamp: Date.now(),
        },
      ],
      { model: modelName || undefined }
    );
    const rawStrategyOutput = await accumulateStreamResponse(stream);

    let cleanedJson = rawStrategyOutput;
    const jsonRegex = /```json\s*([\s\S]*?)\s*```/;
    const match = rawStrategyOutput.match(jsonRegex);
    if (match && match[1]) {
      cleanedJson = match[1];
    }

    const strategy: AnalysisStrategy = JSON.parse(cleanedJson);
    if (
      !strategy ||
      typeof strategy.intermediate_question !== 'string' ||
      typeof strategy.final_synthesis_instructions !== 'string'
    ) {
      throw new Error('Invalid JSON structure from LLM.');
    }

    analysisRepository.updateJobStrategyAndSetPending(jobId, cleanedJson);
    console.log(
      `[Analysis BG ${jobId}] Successfully generated strategy and set status to 'pending'.`
    );

    // Now trigger the worker since the job is ready
    void processAnalysisJob(jobId);
  } catch (error) {
    console.error(`[Analysis BG ${jobId}] Error generating strategy:`, error);
    analysisRepository.updateJobStatus(
      jobId,
      'failed',
      null,
      'Failed to generate analysis strategy.'
    );
  }
};

export const createAnalysisJobHandler = async ({
  body,
  set,
}: any): Promise<{ jobId: number }> => {
  const { sessionIds, prompt, modelName, useAdvancedStrategy } = body as {
    sessionIds: number[];
    prompt: string;
    modelName?: string;
    useAdvancedStrategy?: boolean;
  };

  try {
    // --- AUTOMATIC CONTEXT SIZE CALCULATION ---
    const promptTokens = calculateTokenCount(prompt) || 0;
    let maxTranscriptTokens = 0;
    for (const sessionId of sessionIds) {
      const session = sessionRepository.findById(sessionId);
      if (session && session.transcriptTokenCount) {
        if (session.transcriptTokenCount > maxTranscriptTokens) {
          maxTranscriptTokens = session.transcriptTokenCount;
        }
      }
    }

    const allModels = await listModels();
    const selectedModelInfo = allModels.find((m) => m.name === modelName);
    const modelMaxContext = selectedModelInfo?.defaultContextSize || 8192; // Fallback to 8k if not found

    const ANSWER_BUFFER = 4096; // Generous buffer for the answer
    const calculatedContextSize =
      promptTokens + maxTranscriptTokens + ANSWER_BUFFER;

    if (calculatedContextSize > modelMaxContext) {
      throw new BadRequestError(
        `Analysis requires a context of ~${calculatedContextSize.toLocaleString()} tokens, but model '${modelName}' only supports up to ${modelMaxContext.toLocaleString()}. Please select a model with a larger context window.`
      );
    }
    // --- END CALCULATION ---

    const placeholderShortPrompt = `Analysis of "${prompt.substring(0, 30)}..." (summarizing)`;

    let newJob: AnalysisJob;

    if (useAdvancedStrategy) {
      newJob = analysisRepository.createJob(
        prompt,
        placeholderShortPrompt,
        sessionIds,
        modelName || null,
        calculatedContextSize,
        null,
        'generating_strategy'
      );
      void generateStrategyAndUpdateJob(newJob.id, prompt, modelName);
    } else {
      newJob = analysisRepository.createJob(
        prompt,
        placeholderShortPrompt,
        sessionIds,
        modelName || null,
        calculatedContextSize,
        null,
        'pending'
      );
      void processAnalysisJob(newJob.id);
    }

    void generateShortPromptInBackground(newJob.id, prompt, modelName);

    set.status = 202;
    return { jobId: newJob.id };
  } catch (error) {
    console.error('[AnalysisHandler] Error creating analysis job:', error);
    if (error instanceof ApiError) throw error;
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
          sessionDate: session?.date || '',
        };
      });

    let parsedStrategy: AnalysisStrategy | null = null;
    if (job.strategy_json) {
      try {
        parsedStrategy = JSON.parse(job.strategy_json);
      } catch {
        console.warn(
          `[AnalysisHandler] Could not parse strategy_json for job ${jobId}`
        );
      }
    }

    set.status = 200;
    return {
      ...job,
      summaries: summariesWithSessionNames,
      strategy: parsedStrategy,
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
