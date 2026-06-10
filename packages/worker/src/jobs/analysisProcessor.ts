// packages/worker/src/jobs/analysisProcessor.ts
import { Job } from 'bullmq';
import { AnalysisJobData } from '../types.js';
import { safeValidateAnalysisJob } from '@therascript/domain';
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
import {
  streamLlmChatDetailed,
  calculateTokenCount,
  type StreamResult,
  type LlmChatChunk,
} from '@therascript/services';
import config from '@therascript/config';
import { publishStreamEvent } from '../services/streamPublisher.js';

/**
 * Load a model in LM Studio via its REST API.
 * This is required because LM Studio doesn't auto-load models on first request.
 *
 * Fetches the models list once, uses it both to check whether a reload is
 * needed (early-return) and to collect instances to unload before loading
 * the new model.
 */
async function loadLlmModelForWorker(
  modelKey: string,
  contextSize?: number | null
): Promise<void> {
  const baseUrl = config.llm.baseURL;

  // Single fetch — used both for the early-return check and for unloading.
  type LmsModel = {
    type: string;
    key: string;
    publisher?: string;
    loaded_instances: Array<{
      id: string;
      config?: { context_length?: number };
    }>;
  };
  let loadedModels: LmsModel[] = [];
  try {
    const res = await fetch(`${baseUrl}/api/v1/models`);
    if (res.ok) {
      const data = (await res.json()) as { models: LmsModel[] };
      loadedModels = data.models.filter((m) => m.type === 'llm');
    }
  } catch (e) {
    console.warn(`[Analysis Worker] Could not fetch loaded models:`, e);
  }

  // If the exact model is already loaded with sufficient context, nothing to do.
  const loadedMatch = loadedModels.find(
    (m) =>
      m.loaded_instances.length > 0 &&
      (m.key === modelKey || `${m.publisher}/${m.key}` === modelKey)
  );
  if (loadedMatch) {
    const loadedContext =
      loadedMatch.loaded_instances[0]?.config?.context_length;
    if (!contextSize || !loadedContext || loadedContext >= contextSize) {
      console.log(
        `[Analysis Worker] Model '${modelKey}' already loaded (context: ${loadedContext ?? 'default'}), skipping load.`
      );
      return;
    }
    console.log(
      `[Analysis Worker] Model '${modelKey}' loaded but context ${loadedContext} < required ${contextSize}. Reloading.`
    );
  }

  // Unload all currently loaded LLM instances before loading the new model.
  const instancesToUnload = loadedModels.flatMap((m) => m.loaded_instances);
  for (const instance of instancesToUnload) {
    try {
      await fetch(`${baseUrl}/api/v1/models/unload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instance_id: instance.id }),
      });
      console.log(`[Analysis Worker] Unloaded instance: ${instance.id}`);
    } catch (e) {
      console.warn(
        `[Analysis Worker] Failed to unload instance ${instance.id}:`,
        e
      );
    }
  }

  // Load the requested model
  const loadPayload: Record<string, unknown> = {
    model: modelKey,
    echo_load_config: true,
    flash_attention: true,
  };
  if (contextSize && contextSize > 0) {
    loadPayload.context_length = contextSize;
  }

  console.log(`[Analysis Worker] Loading model: ${modelKey}`);
  const loadRes = await fetch(`${baseUrl}/api/v1/models/load`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(loadPayload),
  });

  if (!loadRes.ok) {
    const errText = await loadRes.text().catch(() => 'Unknown error');
    throw new Error(
      `Failed to load model '${modelKey}': ${loadRes.status} ${loadRes.statusText} - ${errText}`
    );
  }

  const loadData = await loadRes.json();
  console.log(
    `[Analysis Worker] Model loaded. Instance: ${loadData.instance_id}, load time: ${loadData.load_time_seconds?.toFixed(2)}s`
  );
}

export default async function (job: Job<AnalysisJobData, any, string>) {
  const validationResult = safeValidateAnalysisJob(job.data);
  if (!validationResult.success) {
    const error = new Error(
      `Invalid analysis job payload: ${validationResult.error.errors.map((e) => e.message).join(', ')}`
    );
    console.error('[Analysis Worker] Validation error:', error);
    throw error;
  }

  const { jobId } = validationResult.data;
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

    // --- LOAD MODEL ---
    // LM Studio requires explicit model loading before streaming
    if (jobRecord.model_name && jobRecord.model_name !== 'default') {
      try {
        console.log(`[Analysis Worker ${jobId}] Ensuring model is loaded...`);
        await loadLlmModelForWorker(
          jobRecord.model_name,
          jobRecord.context_size
        );
        console.log(`[Analysis Worker ${jobId}] Model ready.`);
      } catch (loadError: any) {
        console.error(
          `[Analysis Worker ${jobId}] Failed to load model:`,
          loadError
        );
        analysisRepository.updateJobStatus(
          jobId,
          'failed',
          null,
          `Failed to load model: ${loadError.message}`
        );
        publishStreamEvent(jobId, {
          phase: 'status',
          type: 'error',
          status: 'failed',
          message: `Failed to load model: ${loadError.message}`,
        });
        throw loadError;
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

        const session = sessionRepository.findById(summaryTask.session_id);
        if (!session)
          throw new Error(`Session ${summaryTask.session_id} not found.`);

        const transcriptText = transcriptRepository.getTranscriptTextForSession(
          summaryTask.session_id,
          session.showSpeakers !== 0
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
              text: `USER'S QUESTION: "${jobRecord?.original_prompt}"\n\nTRANSCRIPT: """${transcriptText}"""\n\nYOUR TASK: Analyze the transcript and write a concise summary that directly answers the user's question *only for this specific session* (max 250 words).`,
              timestamp: Date.now(),
            },
          ];
        }

        const mapPromptTokens =
          calculateTokenCount(mapMessages.map((m) => m.text).join('\n')) || 0;

        publishStreamEvent(jobId, {
          phase: 'map',
          type: 'start',
          sessionId: summaryTask.session_id,
          summaryId: summaryTask.id,
          promptTokens: mapPromptTokens,
        });

        let summaryText = '';
        let chunkBuffer = '';
        let thinkingBuffer = '';
        let hasOpenThinkingBlock = false;
        let lastPublish = Date.now();
        let lastCancelCheck = Date.now();
        const abortController = new AbortController();
        let mapStreamResult: StreamResult = {};

        const mapStartTime = Date.now();
        // Cap map-phase completions at 25% of context size (covers thinking
        // overhead + a concise summary without allowing runaway generation).
        const mapContextSize = jobRecord?.context_size ?? 8192;
        const mapMaxCompletionTokens = Math.round(mapContextSize * 0.25);
        const mapGenerator = streamLlmChatDetailed(mapMessages, {
          model: jobRecord?.model_name || undefined,
          contextSize: jobRecord?.context_size || undefined,
          abortSignal: abortController.signal,
          llamaCppBaseUrl: config.llm.baseURL,
          temperature: jobRecord?.temperature ?? undefined,
          topP: jobRecord?.top_p ?? undefined,
          repeatPenalty: jobRecord?.repeat_penalty ?? undefined,
          numGpuLayers: jobRecord?.num_gpu_layers ?? undefined,
          thinkingBudget: jobRecord?.thinking_budget ?? undefined,
          maxCompletionTokens: mapMaxCompletionTokens,
        });
        let iterResult = await mapGenerator.next();
        while (!iterResult.done) {
          const chunk: LlmChatChunk = iterResult.value;
          const contentChunk = chunk.content ?? '';
          const thinkingChunk = chunk.thinking ?? '';

          if (thinkingChunk) {
            if (!hasOpenThinkingBlock) {
              summaryText += '<think>';
              chunkBuffer += '<think>';
              hasOpenThinkingBlock = true;
            }
            summaryText += thinkingChunk;
            thinkingBuffer += thinkingChunk;
          }

          if (contentChunk) {
            if (hasOpenThinkingBlock) {
              summaryText += '</think>';
              chunkBuffer += '</think>';
              hasOpenThinkingBlock = false;
            }
            summaryText += contentChunk;
            chunkBuffer += contentChunk;
          }

          if (Date.now() - lastPublish > 100) {
            if (chunkBuffer) {
              publishStreamEvent(jobId, {
                phase: 'map',
                type: 'token',
                summaryId: summaryTask.id,
                delta: chunkBuffer,
              });
              chunkBuffer = '';
            }
            if (thinkingBuffer) {
              publishStreamEvent(jobId, {
                phase: 'map',
                type: 'thinking',
                summaryId: summaryTask.id,
                delta: thinkingBuffer,
              });
              thinkingBuffer = '';
            }
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
        if (hasOpenThinkingBlock) {
          summaryText += '</think>';
          chunkBuffer += '</think>';
          hasOpenThinkingBlock = false;
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

        if (thinkingBuffer) {
          publishStreamEvent(jobId, {
            phase: 'map',
            type: 'thinking',
            summaryId: summaryTask.id,
            delta: thinkingBuffer,
          });
        }

        // Strip the <think>…</think> envelope when checking for emptiness so a
        // thinking-only output (model thought but produced no answer text)
        // doesn't get rejected.
        const strippedMap = summaryText.replace(
          /<think>[\s\S]*?<\/think>/g,
          ''
        );
        if (!strippedMap.trim()) {
          const detail = `LLM returned an empty summary for session ${summaryTask.session_id} (model=${jobRecord?.model_name ?? 'unknown'}, promptTokens=${mapStreamResult.promptTokens ?? 0}, completionTokens=${mapStreamResult.completionTokens ?? 0}, thinkingTokens=${mapStreamResult.thinkingTokens ?? 0}, durationMs=${mapDuration}).`;
          console.error(`[Analysis Worker ${jobId}] ${detail}`);
          throw new Error(detail);
        }

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
          promptTokens: mapStreamResult.promptTokens,
          completionTokens: mapStreamResult.completionTokens,
          duration: mapDuration,
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
      .map(({ summary, session }) => {
        return `--- Analysis from Session "${session.sessionName || session.fileName}" ---\n${summary.summary_text}`;
      })
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

    const reducePromptTokens =
      calculateTokenCount(reduceMessages.map((m) => m.text).join('\n')) || 0;

    publishStreamEvent(jobId, {
      phase: 'reduce',
      type: 'start',
      promptTokens: reducePromptTokens,
    });

    let finalResult = '';
    let reduceBuffer = '';
    let reduceThinkingBuffer = '';
    let hasOpenReduceThinkingBlock = false;
    let lastReducePublish = Date.now();
    let lastReduceCancelCheck = Date.now();
    const reduceAbortController = new AbortController();
    let reduceStreamResult: StreamResult = {};

    const reduceStartTime = Date.now();

    try {
      // Cap reduce-phase completions at 40% of context size — more headroom
      // than map since the synthesis answer is expected to be longer.
      const reduceContextSize = jobRecord?.context_size ?? 8192;
      const reduceMaxCompletionTokens = Math.round(reduceContextSize * 0.4);
      const reduceGenerator = streamLlmChatDetailed(reduceMessages, {
        model: jobRecord?.model_name || undefined,
        contextSize: jobRecord?.context_size || undefined,
        abortSignal: reduceAbortController.signal,
        llamaCppBaseUrl: config.llm.baseURL,
        temperature: jobRecord?.temperature ?? undefined,
        topP: jobRecord?.top_p ?? undefined,
        repeatPenalty: jobRecord?.repeat_penalty ?? undefined,
        numGpuLayers: jobRecord?.num_gpu_layers ?? undefined,
        thinkingBudget: jobRecord?.thinking_budget ?? undefined,
        maxCompletionTokens: reduceMaxCompletionTokens,
      });

      console.log(`[Analysis Worker ${jobId}] Starting reduce phase stream...`);
      let reduceIterResult = await reduceGenerator.next();

      while (!reduceIterResult.done) {
        const chunk: LlmChatChunk = reduceIterResult.value;
        const contentChunk = chunk.content ?? '';
        const thinkingChunk = chunk.thinking ?? '';

        if (thinkingChunk) {
          if (!hasOpenReduceThinkingBlock) {
            finalResult += '<think>';
            reduceBuffer += '<think>';
            hasOpenReduceThinkingBlock = true;
          }
          finalResult += thinkingChunk;
          reduceThinkingBuffer += thinkingChunk;
        }

        if (contentChunk) {
          if (hasOpenReduceThinkingBlock) {
            finalResult += '</think>';
            reduceBuffer += '</think>';
            hasOpenReduceThinkingBlock = false;
          }
          finalResult += contentChunk;
          reduceBuffer += contentChunk;
        }

        if (Date.now() - lastReducePublish > 100) {
          if (reduceBuffer) {
            publishStreamEvent(jobId, {
              phase: 'reduce',
              type: 'token',
              delta: reduceBuffer,
            });
            reduceBuffer = '';
          }
          if (reduceThinkingBuffer) {
            publishStreamEvent(jobId, {
              phase: 'reduce',
              type: 'thinking',
              delta: reduceThinkingBuffer,
            });
            reduceThinkingBuffer = '';
          }
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

      if (hasOpenReduceThinkingBlock) {
        finalResult += '</think>';
        reduceBuffer += '</think>';
        hasOpenReduceThinkingBlock = false;
      }

      reduceStreamResult = reduceIterResult.value as StreamResult;
      console.log(
        `[Analysis Worker ${jobId}] Reduce stream complete. Result tokens: P=${reduceStreamResult.promptTokens}, C=${reduceStreamResult.completionTokens}, T=${reduceStreamResult.thinkingTokens ?? 0}`
      );
    } catch (streamError: any) {
      console.error(
        `[Analysis Worker ${jobId}] Error during reduce stream:`,
        streamError
      );
      throw new Error(`Reduce phase stream failed: ${streamError.message}`);
    }
    const reduceDuration = Date.now() - reduceStartTime;

    if (reduceBuffer) {
      publishStreamEvent(jobId, {
        phase: 'reduce',
        type: 'token',
        delta: reduceBuffer,
      });
    }

    if (reduceThinkingBuffer) {
      publishStreamEvent(jobId, {
        phase: 'reduce',
        type: 'thinking',
        delta: reduceThinkingBuffer,
      });
    }

    // Strip the <think>…</think> envelope when checking for emptiness so a
    // thinking-only output doesn't get rejected.
    const strippedReduce = finalResult.replace(/<think>[\s\S]*?<\/think>/g, '');
    if (!strippedReduce.trim()) {
      const detail = `LLM returned an empty final result (model=${jobRecord?.model_name ?? 'unknown'}, promptTokens=${reduceStreamResult.promptTokens ?? 0}, completionTokens=${reduceStreamResult.completionTokens ?? 0}, thinkingTokens=${reduceStreamResult.thinkingTokens ?? 0}, durationMs=${reduceDuration}).`;
      console.error(`[Analysis Worker ${jobId}] ${detail}`);
      throw new Error(detail);
    }

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

    publishStreamEvent(jobId, {
      phase: 'reduce',
      type: 'end',
      promptTokens: reduceStreamResult.promptTokens,
      completionTokens: reduceStreamResult.completionTokens,
      duration: reduceDuration,
    });

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
