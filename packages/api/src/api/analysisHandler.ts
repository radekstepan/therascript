// packages/api/src/api/analysisHandler.ts
import { analysisRepository } from '../repositories/analysisRepository.js';
import { sessionRepository } from '../repositories/sessionRepository.js';
import { processAnalysisJob } from '../services/analysisJobService.js';
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

const STRATEGIST_PROMPT = `You are an expert AI analysis strategist. Your job is to break down a complex, multi-document user query into a two-part MapReduce plan. The user's query will be run against a series of therapy session transcripts, which are ordered chronologically. Your plan must be in a JSON format with two keys:
1. "intermediate_question": A question or task that can be executed on **each single transcript** independently to extract the necessary information. This question must be self-contained and make sense without seeing other documents.
2. "final_synthesis_instructions": Instructions for a final AI on how to take all the intermediate answers (which will be provided in chronological order) and synthesize them into a single, cohesive answer to the user's original query.

---
**EXAMPLE 1**
**User's Query:** "How is the patient's depression progressing over time?"

**Your JSON Output:**
{
  "intermediate_question": "From this single transcript, extract the following data points related to depression. If a point is not mentioned, state 'not mentioned'.\\n- Patient's Self-Reported Mood:\\n- Specific Depression Symptoms Mentioned (e.g., low energy, anhedonia):\\n- Mention of Coping Skills for Depression:\\n- Any Objective Scores Mentioned (e.g., PHQ-9, BDI):",
  "final_synthesis_instructions": "You will be given a series of chronologically ordered data extractions from multiple therapy sessions. Your task is to write a narrative that describes the patient's progress with depression over time. Synthesize the data points to identify trends, improvements, setbacks, and how the discussion of symptoms and skills has evolved across the sessions."
}
---
**EXAMPLE 2**
**User's Query:** "What is the therapist consistently missing?"

**Your JSON Output:**
{
  "intermediate_question": "Acting as a clinical supervisor, review this single transcript to identify potential missed opportunities. For each one you find, describe: \\n1. The Patient's Cue/Statement.\\n2. The specific opportunity the therapist missed (e.g., chance to validate, opportunity for Socratic questioning, deeper emotional exploration). \\nIf no significant opportunities were missed, state that clearly.",
  "final_synthesis_instructions": "You will receive a list of potential missed opportunities from several sessions. Your task is to identify and summarize any *consistent patterns* of missed opportunities that appear across multiple sessions. Focus on recurring themes in the therapist's approach that could be areas for growth."
}
---

**User's Query:** "{{USER_PROMPT}}"

**Your JSON Output:**`;

export const createAnalysisJobHandler = async ({
  body,
  set,
}: any): Promise<{ jobId: number }> => {
  const { sessionIds, prompt, modelName, contextSize, useAdvancedStrategy } =
    body as {
      sessionIds: number[];
      prompt: string;
      modelName?: string;
      contextSize?: number;
      useAdvancedStrategy?: boolean;
    };
  try {
    // 1. Generate short prompt for display
    const summarizePrompt = `Summarize the following user request into a very short, title-like phrase of no more than 5 words. Do not use quotes or introductory phrases.

REQUEST: "${prompt}"`;

    let stream = await streamChatResponse(
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

    // 2. Conditionally generate the analysis strategy
    let strategyJsonString: string | null = null;
    if (useAdvancedStrategy === true) {
      console.log(
        '[AnalysisHandler] Using advanced strategy. Generating plan...'
      );
      const strategistSystemPrompt = STRATEGIST_PROMPT.replace(
        '{{USER_PROMPT}}',
        prompt
      );

      stream = await streamChatResponse(
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

      // Clean and Validate the strategy
      let cleanedJson = rawStrategyOutput;
      const jsonRegex = /```json\s*([\s\S]*?)\s*```/;
      const match = rawStrategyOutput.match(jsonRegex);
      if (match && match[1]) {
        cleanedJson = match[1];
      }

      try {
        const strategy: AnalysisStrategy = JSON.parse(cleanedJson);
        if (
          !strategy ||
          typeof strategy.intermediate_question !== 'string' ||
          typeof strategy.final_synthesis_instructions !== 'string'
        ) {
          throw new Error('Invalid JSON structure.');
        }
        strategyJsonString = cleanedJson; // Store the cleaned, valid JSON string
      } catch (e) {
        console.error(
          '[AnalysisHandler] Failed to generate a valid analysis strategy JSON:',
          e
        );
        console.error('LLM Output for strategy was:', rawStrategyOutput);
        throw new BadRequestError(
          'The AI failed to generate a valid analysis plan for this query. Please try rephrasing your request.'
        );
      }
    } else {
      console.log(
        '[AnalysisHandler] Using simple strategy. Skipping plan generation.'
      );
    }

    // 3. Create the job with the strategy (or null)
    const newJob = analysisRepository.createJob(
      prompt,
      shortPrompt || `Analysis - ${prompt.substring(0, 20)}...`,
      sessionIds,
      modelName || null,
      contextSize || null,
      strategyJsonString
    );

    // 4. Trigger background processing
    void processAnalysisJob(newJob.id);

    set.status = 202; // Accepted
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

    // Parse the strategy for the UI
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
