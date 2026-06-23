// packages/api/src/api/analysisHandler.ts
import {
  analysisRepository,
  sessionRepository,
  templateRepository,
  usageRepository,
} from '@therascript/data';
import { SYSTEM_PROMPT_TEMPLATES } from '@therascript/db/dist/sqliteService.js';
import { processAnalysisJob } from '../services/analysisJobService.js';
import {
  listModels,
  streamChatResponse,
  ensureModelLoaded,
  unloadModelAtUrl,
} from '../services/llamaCppService.js';
import { calculateTokenCount } from '@therascript/services';
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
} from '@therascript/domain';
import { cleanLlmOutput } from '@therascript/services';
import { createJobSubscriber } from '../services/streamSubscriber.js';
import {
  getConfiguredTemperature,
  getConfiguredTopP,
  getConfiguredRepeatPenalty,
  getConfiguredNumGpuLayers,
  getConfiguredThinkingBudget,
  getActiveBaseUrl,
  setActiveModelAndContextAndParams,
  getActiveModel,
} from '../services/activeModelService.js';
import {
  type AnalysisRequest,
  analysisRequestSchema,
} from '@therascript/domain';

interface AnalysisHandlerContext {
  params: { jobId?: string | number } & Record<
    string,
    string | number | undefined
  >;
  set: { status?: number | string };
}

// This helper is also in analysisJobService.ts. Consider moving to a shared util.
async function accumulateStreamResponse(
  stream: AsyncGenerator<any, any>
): Promise<{ text: string; promptTokens?: number; completionTokens?: number }> {
  let fullText = '';
  let promptTokens: number | undefined;
  let completionTokens: number | undefined;
  for await (const chunk of stream) {
    if (chunk.content) {
      fullText += chunk.content;
    }
    if (chunk.promptTokens !== undefined) {
      promptTokens = chunk.promptTokens;
      completionTokens = chunk.completionTokens;
    }
  }
  return { text: cleanLlmOutput(fullText), promptTokens, completionTokens };
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
  modelName?: string | null,
  jobLlmBaseUrl?: string | null
) => {
  try {
    console.log(`[Analysis BG ${jobId}] Generating short prompt...`);

    const promptTemplate = getSystemPrompt('system_short_prompt_generator');
    const summarizePrompt = promptTemplate.replace(
      '{{USER_PROMPT}}',
      originalPrompt
    );

    const startTime = Date.now();
    const stream = await streamChatResponse(
      [
        {
          id: 0,
          chatId: 0,
          sender: 'user',
          text: summarizePrompt,
          timestamp: Date.now(),
        },
      ],
      {
        model: modelName || undefined,
        ...(jobLlmBaseUrl ? { llamaCppBaseUrl: jobLlmBaseUrl } : {}),
      }
    );
    const {
      text: shortPrompt,
      promptTokens,
      completionTokens,
    } = await accumulateStreamResponse(stream);
    const duration = Date.now() - startTime;

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

    try {
      usageRepository.insertUsageLog({
        type: 'llm',
        source: 'analysis_short_prompt',
        model: modelName || 'llama3',
        promptTokens,
        completionTokens,
        duration,
      });
    } catch (err) {
      console.warn(
        `[Analysis BG ${jobId}] Failed to log short prompt usage:`,
        err
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
  modelName?: string | null,
  contextSize?: number | null,
  jobLlmBaseUrl?: string | null
) => {
  try {
    console.log(`[Analysis BG ${jobId}] Generating advanced strategy...`);

    // Ensure model is loaded before streaming (LM Studio requires explicit load).
    // Use ensureModelLoaded (idempotent) instead of loadLlmModel to avoid an
    // unnecessary unload+reload when the model is already warm, which would
    // race with the concurrent generateShortPromptInBackground chat request
    // and cause LM Studio to spin up a second instance.
    if (modelName && modelName !== 'default') {
      try {
        console.log(
          `[Analysis BG ${jobId}] Ensuring model is loaded: ${modelName} (baseUrl=${jobLlmBaseUrl ?? 'active'})`
        );
        await ensureModelLoaded(
          modelName,
          contextSize,
          jobLlmBaseUrl ?? undefined
        );
        console.log(`[Analysis BG ${jobId}] Model ready.`);
      } catch (loadError: any) {
        console.error(
          `[Analysis BG ${jobId}] Failed to load model:`,
          loadError
        );
        analysisRepository.updateJobStatus(
          jobId,
          'failed',
          null,
          `Failed to ensure model '${modelName}' is loaded: ${loadError.message}`
        );
        return;
      }
    }

    // Generate the short prompt now, while the model is confirmed loaded.
    // This must run before the strategy stream starts so we don't have two
    // concurrent requests to the LLM — the second concurrent request would
    // cause LM Studio to auto-load a second instance.
    await generateShortPromptInBackground(
      jobId,
      originalPrompt,
      modelName,
      jobLlmBaseUrl
    );

    const promptTemplate = getSystemPrompt('system_analysis_strategist');
    const strategistSystemPrompt = promptTemplate.replace(
      '{{USER_PROMPT}}',
      originalPrompt
    );

    const startTime = Date.now();
    const stream = await streamChatResponse(
      [
        {
          id: 0,
          chatId: 0,
          sender: 'user',
          text: strategistSystemPrompt,
          timestamp: Date.now(),
        },
      ],
      {
        model: modelName || undefined,
        ...(jobLlmBaseUrl ? { llamaCppBaseUrl: jobLlmBaseUrl } : {}),
      }
    );
    const {
      text: rawStrategyOutput,
      promptTokens,
      completionTokens,
    } = await accumulateStreamResponse(stream);
    const duration = Date.now() - startTime;

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

    try {
      usageRepository.insertUsageLog({
        type: 'llm',
        source: 'analysis_strategy',
        model: modelName || 'llama3',
        promptTokens,
        completionTokens,
        duration,
      });
    } catch (err) {
      console.warn(
        `[Analysis BG ${jobId}] Failed to log strategy generation usage:`,
        err
      );
    }

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
}: {
  body: unknown;
  set: { status?: number | string };
}): Promise<{ jobId: number }> => {
  const validatedBody = analysisRequestSchema.parse(body);
  const {
    sessionIds,
    prompt,
    modelName,
    useAdvancedStrategy,
    contextSize: requestedContextSize,
    mapPhaseSystemPrompt,
    baseUrl: requestedBaseUrl,
    temperature,
    topP,
    repeatPenalty,
    numGpuLayers,
    thinkingBudget,
  } = validatedBody;

  try {
    // --- CONTEXT SIZE CALCULATION ---
    const allModels = await listModels();
    const selectedModelInfo = allModels.find((m) => m.name === modelName);
    const modelMaxContext = selectedModelInfo?.defaultContextSize || 8192;

    let contextSizeToUse: number;

    if (requestedContextSize) {
      if (requestedContextSize > modelMaxContext) {
        throw new BadRequestError(
          `Requested context size of ${requestedContextSize.toLocaleString()} tokens exceeds model '${modelName}' maximum of ${modelMaxContext.toLocaleString()} tokens.`
        );
      }
      contextSizeToUse = requestedContextSize;
    } else {
      const promptTokens = calculateTokenCount(prompt) || 0;
      const mapPhaseSystemPromptTokens =
        mapPhaseSystemPrompt && mapPhaseSystemPrompt.trim().length > 0
          ? calculateTokenCount(mapPhaseSystemPrompt) || 0
          : 0;
      let maxTranscriptTokens = 0;
      for (const sessionId of sessionIds) {
        const session = sessionRepository.findById(sessionId);
        if (session && session.transcriptTokenCount) {
          if (session.transcriptTokenCount > maxTranscriptTokens) {
            maxTranscriptTokens = session.transcriptTokenCount;
          }
        }
      }

      const ANSWER_BUFFER = 4096;
      // The map-phase system prompt is repeated on every Map call (once per
      // session), so it doesn't change the per-session context size — but we
      // still need to fit it in the model context.
      const mapPhaseBuffer = mapPhaseSystemPromptTokens;

      let calculatedContextSize: number;
      if (useAdvancedStrategy) {
        const TARGET_SUMMARY_TOKENS = 500;
        const PER_SESSION_OVERHEAD = 30;
        const FINAL_ANSWER_BUFFER = 4096;
        const reducePhaseContext =
          sessionIds.length * (TARGET_SUMMARY_TOKENS + PER_SESSION_OVERHEAD) +
          FINAL_ANSWER_BUFFER;

        calculatedContextSize = Math.max(
          promptTokens + maxTranscriptTokens + mapPhaseBuffer + ANSWER_BUFFER,
          reducePhaseContext
        );
      } else {
        calculatedContextSize =
          promptTokens + maxTranscriptTokens + mapPhaseBuffer + ANSWER_BUFFER;
      }

      if (calculatedContextSize > modelMaxContext) {
        throw new BadRequestError(
          `Analysis requires a context of ~${calculatedContextSize.toLocaleString()} tokens, but model '${modelName}' only supports up to ${modelMaxContext.toLocaleString()}. Please select a model with a larger context window.`
        );
      }
      contextSizeToUse = calculatedContextSize;
    }
    // --- END CALCULATION ---

    const placeholderShortPrompt = `Analysis of "${prompt.substring(0, 30)}..." (summarizing)`;

    // Snapshot the user's "Set Model" params at job-creation time so the worker
    // (a separate process with its own empty in-memory state) can honor them
    // when it streams the Map and Reduce phases. If the caller supplied
    // per-job overrides (e.g. the analysis modal's sliders), prefer those;
    // otherwise fall back to the globally configured values.
    const llmParams = {
      thinkingBudget:
        thinkingBudget !== undefined
          ? thinkingBudget
          : getConfiguredThinkingBudget(),
      temperature: temperature ?? getConfiguredTemperature(),
      topP: topP ?? getConfiguredTopP(),
      repeatPenalty: repeatPenalty ?? getConfiguredRepeatPenalty(),
      numGpuLayers:
        numGpuLayers !== undefined ? numGpuLayers : getConfiguredNumGpuLayers(),
    };

    let newJob: AnalysisJob;

    // Snapshot the LLM base URL at job-creation time so the worker
    // (a separate process) uses the same network target even if the user
    // later toggles between local and remote. If the caller supplied a
    // per-job `baseUrl` (e.g. picked a remote machine in the analysis
    // modal), prefer that; otherwise fall back to the backend's currently
    // active base URL. This is the only "routing" state the worker needs.
    const jobLlmBaseUrl =
      requestedBaseUrl && requestedBaseUrl.trim().length > 0
        ? requestedBaseUrl.trim()
        : getActiveBaseUrl();

    // If the per-job URL differs from the currently active one, evict
    // whatever model is loaded on the *previous* URL so we don't leave
    // a stale model in VRAM. The worker's loadLlmModelForWorker will
    // then load the requested model on the new URL.
    const previousBaseUrl = getActiveBaseUrl();
    if (jobLlmBaseUrl && jobLlmBaseUrl !== previousBaseUrl) {
      try {
        const unloaded = await unloadModelAtUrl(previousBaseUrl);
        console.log(
          `[Analysis (pre-create)] Pre-switch unload: removed ${unloaded} model(s) from previous URL ${previousBaseUrl} (job URL: ${jobLlmBaseUrl})`
        );
      } catch (unloadErr: any) {
        console.warn(
          `[Analysis (pre-create)] Pre-switch unload on ${previousBaseUrl} failed (non-fatal): ${unloadErr.message}`
        );
      }
    }

    // UPDATE GLOBAL STATE: Ensuring that the app stays in sync globally and subsequent
    // chats hook immediately onto this exact model configuration and URL without
    // requiring any manual "Set Model" actions from the user. We mirror the
    // per-job LLM params (which already prefer request-supplied values) into
    // the global store so the chat and analysis views stay aligned.
    setActiveModelAndContextAndParams(
      modelName || getActiveModel(),
      contextSizeToUse,
      llmParams.temperature,
      llmParams.topP,
      llmParams.repeatPenalty,
      llmParams.numGpuLayers,
      llmParams.thinkingBudget,
      jobLlmBaseUrl
    );

    if (useAdvancedStrategy) {
      newJob = analysisRepository.createJob(
        prompt,
        placeholderShortPrompt,
        sessionIds,
        modelName || null,
        contextSizeToUse,
        null,
        'generating_strategy',
        llmParams,
        mapPhaseSystemPrompt?.trim() ? mapPhaseSystemPrompt.trim() : null,
        jobLlmBaseUrl
      );
      // Short prompt generation is handled inside generateStrategyAndUpdateJob
      // (after model load, before strategy stream) to avoid a concurrent
      // LLM request that would cause LM Studio to spin up a second instance.
      void generateStrategyAndUpdateJob(
        newJob.id,
        prompt,
        modelName,
        contextSizeToUse,
        jobLlmBaseUrl
      );
    } else {
      newJob = analysisRepository.createJob(
        prompt,
        placeholderShortPrompt,
        sessionIds,
        modelName || null,
        contextSizeToUse,
        null,
        'pending',
        llmParams,
        mapPhaseSystemPrompt?.trim() ? mapPhaseSystemPrompt.trim() : null,
        jobLlmBaseUrl
      );
      void processAnalysisJob(newJob.id);
      void generateShortPromptInBackground(
        newJob.id,
        prompt,
        modelName,
        jobLlmBaseUrl
      );
    }

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

export const listAnalysisJobsHandler = ({
  set,
}: AnalysisHandlerContext): AnalysisJob[] => {
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
}: AnalysisHandlerContext): AnalysisJobWithDetails => {
  const jobId =
    typeof params.jobId === 'number'
      ? params.jobId
      : parseInt(params.jobId ?? '0', 10);
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
}: AnalysisHandlerContext): { message: string } => {
  const jobId =
    typeof params.jobId === 'number'
      ? params.jobId
      : parseInt(params.jobId ?? '0', 10);
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
}: AnalysisHandlerContext): { message: string } => {
  const jobId =
    typeof params.jobId === 'number'
      ? params.jobId
      : parseInt(params.jobId ?? '0', 10);
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

export const streamAnalysisJobHandler = ({
  params,
  set,
}: AnalysisHandlerContext): Response => {
  const jobId =
    typeof params.jobId === 'number'
      ? params.jobId
      : parseInt(params.jobId ?? '0', 10);
  const job = analysisRepository.getJobById(jobId);

  if (!job) {
    set.status = 404;
    return new Response('Job not found', { status: 404 });
  }

  // Create stream with proper cleanup handling
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const send = (data: object) => {
        // Yield to the event loop so each per-event write actually hits the
        // wire on its own. Without this, a burst of Redis messages arriving
        // in the same tick would be coalesced into a single kernel send
        // buffer flush on remote (non-loopback) sockets, which is what makes
        // analysis streaming appear to "all arrive at once" on proxies.
        setImmediate(() => {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
          );
        });
      };

      // 1. Send initial snapshot
      const snapshot = {
        type: 'snapshot',
        phase: 'status' as const,
        job,
        summaries: analysisRepository.getAllSummariesForJob(jobId),
      };
      send(snapshot);

      // 2. Subscribe to Redis events
      unsubscribe = createJobSubscriber(jobId, (event) => {
        send(event);

        // Close stream if job reaches terminal state
        if (
          event.type === 'status' &&
          ['completed', 'failed', 'canceled'].includes(event.status!)
        ) {
          console.log(`[Stream API] Job ${jobId} finished. Closing stream.`);
          controller.close();
          unsubscribe?.();
        }
      });
    },
    cancel() {
      console.log(`[Stream API] Client disconnected from job ${jobId} stream.`);
      unsubscribe?.();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      // Belt-and-suspenders streaming headers (mirrors sessionChatHandler /
      // standaloneChatHandler):
      //   - X-Accel-Buffering: no   — tells nginx / Tailscale Funnel /
      //     Cloudflare not to buffer the response (no-op when no proxy).
      //   - Cache-Control: no-cache, no-transform — broader proxy coverage
      //     and prevents intermediaries from rewriting/coalescing chunks.
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    },
  });
};
