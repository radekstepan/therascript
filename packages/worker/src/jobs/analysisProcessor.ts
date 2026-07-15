// packages/worker/src/jobs/analysisProcessor.ts
import { Job } from 'bullmq';
import { AnalysisJobData } from '../types.js';
import { safeValidateAnalysisJob } from '@therascript/domain';
import {
  analysisRepository,
  transcriptRepository,
  sessionRepository,
  usageRepository,
  appSettingsRepository,
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
  truncateTranscriptToTokenBudget,
  parseJsonObjectFromLlm,
  streamWithRetry,
  type StreamResult,
  type LlmChatChunk,
} from '@therascript/services';
import config from '@therascript/config';
import { publishStreamEvent } from '../services/streamPublisher.js';
import {
  markLoaded as trackerMarkLoaded,
  markUnloaded as trackerMarkUnloaded,
} from './loadedModelsTracker.js';

/**
 * Read the globally stored remote LLM API token. Worker-local counterpart
 * of `getActiveApiToken` in the API's `activeModelService` — the worker
 * is a separate process and shares the same SQLite DB via
 * `appSettingsRepository`, so reading here gives the worker the same
 * single global token the user configured in the API. Returns `null`
 * when the stored value is blank/whitespace or the row is missing.
 */
export function loadLlmApiTokenForWorker(): string | null {
  try {
    const row = appSettingsRepository.getSettings();
    const raw = row.llm_api_token;
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch (e) {
    // The DB may not be ready at boot, or the row may not exist yet.
    // Treat that as "no token" rather than failing the job.
    console.warn(
      '[Analysis Worker] Failed to read remote LLM API token:',
      (e as Error)?.message ?? e
    );
    return null;
  }
}

/**
 * Worker-side companion to the API's `authHeadersFor`:
 *   - `null` when the URL is the local default (token is never sent)
 *   - `{ Authorization: 'Bearer <token>' }` when the URL is remote and
 *     a token is configured
 *   - `{}` when the URL is remote but no token is configured
 *
 * The "is this remote?" check uses the same `config.llm.baseURL` baseline
 * the existing URL-switch logic in `loadLlmModelForWorker` uses (the
 * worker has no notion of a `defaultBaseUrl` override; the config value
 * is the only local URL it ever talks to).
 */
function authHeadersForWorker(url: string | undefined): {
  Authorization?: string;
} {
  if (!url || url === config.llm.baseURL) return {};
  const token = loadLlmApiTokenForWorker();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

/** Same as `authHeadersForWorker` but returns `null` for the streaming
 *  `llmApiToken` option (the llama.cpp client trims/null-checks for us). */
function resolveLlmApiTokenForWorker(url: string | undefined): string | null {
  if (!url || url === config.llm.baseURL) return null;
  return loadLlmApiTokenForWorker();
}

/**
 * Unload any loaded LLM model instances on a specific URL via the LM Studio
 * REST API. Worker-local counterpart of `unloadModelAtUrl` in the API's
 * `llamaCppService`. Best-effort: per-instance failures and enumeration
 * failures are logged but do not throw.
 *
 * Returns the number of model instances successfully unloaded.
 */
export async function unloadModelAtUrlForWorker(url: string): Promise<number> {
  let unloadedCount = 0;
  try {
    const res = await fetch(`${url}/api/v1/models`, {
      headers: authHeadersForWorker(url),
    });
    if (res.ok) {
      const data = (await res.json()) as {
        models: Array<{
          type: string;
          loaded_instances: Array<{ id: string }>;
        }>;
      };
      const instances = (data.models || [])
        .filter((m) => m.type === 'llm')
        .flatMap((m) => m.loaded_instances);
      for (const instance of instances) {
        try {
          await fetch(`${url}/api/v1/models/unload`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...authHeadersForWorker(url),
            },
            body: JSON.stringify({ instance_id: instance.id }),
          });
          console.log(
            `[Analysis Worker] Unloaded instance ${instance.id} from ${url}`
          );
          trackerMarkUnloaded(url, instance.id);
          unloadedCount++;
        } catch (e: any) {
          console.warn(
            `[Analysis Worker] Failed to unload ${instance.id} from ${url}:`,
            e
          );
        }
      }
    }
  } catch (e) {
    console.warn(
      `[Analysis Worker] Could not enumerate loaded models at ${url} during pre-switch unload:`,
      e
    );
  }
  return unloadedCount;
}

/**
 * Load a model in LM Studio via its REST API.
 * This is required because LM Studio doesn't auto-load models on first request.
 *
 * Fetches the models list once, uses it both to check whether a reload is
 * needed (early-return) and to collect instances to unload before loading
 * the new model.
 */
export async function loadLlmModelForWorker(
  modelKey: string,
  contextSize?: number | null,
  baseUrl?: string
): Promise<void> {
  // If the target URL differs from the worker's currently known default
  // base URL, evict any model loaded on the previous URL so we don't
  // leave a stale model in VRAM on the other server.
  const previousBaseUrl = config.llm.baseURL;
  if (baseUrl && baseUrl !== previousBaseUrl) {
    try {
      const unloaded = await unloadModelAtUrlForWorker(previousBaseUrl);
      console.log(
        `[Analysis Worker] Pre-switch unload: removed ${unloaded} model(s) from previous URL ${previousBaseUrl} (target: ${baseUrl})`
      );
    } catch (e: any) {
      console.warn(
        `[Analysis Worker] Pre-switch unload on ${previousBaseUrl} failed (non-fatal):`,
        e
      );
    }
  }

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
    const res = await fetch(`${baseUrl}/api/v1/models`, {
      headers: authHeadersForWorker(baseUrl),
    });
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
        headers: {
          'Content-Type': 'application/json',
          ...authHeadersForWorker(baseUrl),
        },
        body: JSON.stringify({ instance_id: instance.id }),
      });
      console.log(`[Analysis Worker] Unloaded instance: ${instance.id}`);
      trackerMarkUnloaded(baseUrl, instance.id);
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
    headers: {
      'Content-Type': 'application/json',
      ...authHeadersForWorker(baseUrl),
    },
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
  if (loadData?.instance_id) {
    trackerMarkLoaded(baseUrl, loadData.instance_id);
  }
}

/**
 * Build the LLM message array for the analysis reduce phase.
 *
 * Pure function: no I/O, no LLM calls, no `Date.now()` rounding concerns
 * beyond `timestamp` placeholders. Extracted from the reduce phase so it
 * can be unit-tested for chronological ordering independently of the
 * streaming LLM.
 *
 * Contract: the returned messages reference intermediate summaries in
 * oldest-to-newest order, matching the strategy prompt's promise to the
 * LLM that "intermediate answers are provided in chronological order."
 * The DB already returns `successfulSummaries` sorted by `sessions.date
 * ASC, intermediate_summaries.id ASC`; this helper re-sorts as a
 * defense-in-depth so the contract survives any future caller that
 * bypasses the repository helper.
 *
 * `sessionsById` MUST be a Map; passing an array would make the
 * per-summary session lookup O(n²) and is rejected by the type.
 */
/**
 * Compute the `max_tokens` cap for a single map-phase LLM call.
 *
 * The cap is 30% of the model's loaded context window, with a hard floor
 * of 4096 tokens (2 × 2048). The floor prevents very small context
 * configurations from leaving so little room for completion that thinking
 * models exhaust the budget before producing any answer text. The 30%
 * ratio is intentionally conservative — each session's map call should be
 * cheap relative to the full context so many sessions can be processed
 * in sequence without running the model to its limit every time.
 *
 * Pure function: no I/O. Exported for unit testing.
 */
export function computeMapCompletionCap(contextSize: number): number {
  const MIN_COMPLETION_TOKENS = 4096; // 2 × 2048
  return Math.max(MIN_COMPLETION_TOKENS, Math.round(contextSize * 0.3));
}

export function assembleReducePrompt(
  successfulSummaries: IntermediateSummary[],
  sessionsById: Map<number, BackendSession>,
  originalPrompt: string,
  strategy: AnalysisStrategy | null
): BackendChatMessage[] {
  const enrichedSummaries = successfulSummaries
    .map((summary) => ({
      summary,
      session: sessionsById.get(summary.session_id),
    }))
    .filter(
      (
        item
      ): item is {
        summary: IntermediateSummary;
        session: BackendSession;
      } => !!item.session
    )
    .sort((a, b) => {
      const dateDiff =
        new Date(a.session.date).getTime() - new Date(b.session.date).getTime();
      // Stable tiebreaker: summaries inserted earlier (lower id) come
      // first when two sessions share a date.
      return dateDiff !== 0 ? dateDiff : a.summary.id - b.summary.id;
    });

  const intermediateSummariesText = enrichedSummaries
    .map(({ summary, session }) => {
      return `--- Analysis from Session "${session.sessionName || session.fileName}" ---\n${summary.summary_text}`;
    })
    .join('\n\n');

  if (strategy) {
    return [
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
        text: `USER'S QUESTION: "${originalPrompt}"\n\nINTERMEDIATE ANSWERS:\n"""${intermediateSummariesText}"""`,
        timestamp: Date.now(),
      },
    ];
  }
  return [
    {
      id: 0,
      chatId: 0,
      sender: 'user',
      text: `USER'S QUESTION: "${originalPrompt}"\n\nINTERMEDIATE SUMMARIES:\n"""${intermediateSummariesText}"""\n\nYOUR TASK: Create a single, cohesive answer to the user's question based *only* on the intermediate summaries.`,
      timestamp: Date.now(),
    },
  ];
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

    // Resolve the LLM base URL the worker should use. The job record
    // (llm_base_url) wins if set; otherwise fall back to the worker's
    // config default. This is the single source of truth for routing
    // both the model-load and the Map/Reduce streams.
    const jobLlmBaseUrl = jobRecord.llm_base_url || config.llm.baseURL;

    let strategy: AnalysisStrategy | null = null;
    if (jobRecord.strategy_json) {
      // Use the same robust extractor the API uses for fresh strategy
      // output, so a row written by an older buggy parser is still usable.
      // If the row is unrecoverable, hard-fail with a useful message
      // rather than silently degrading to the no-strategy branch.
      const parsed = parseJsonObjectFromLlm<AnalysisStrategy>(
        jobRecord.strategy_json
      );
      if (
        !parsed ||
        typeof parsed.intermediate_question !== 'string' ||
        typeof parsed.final_synthesis_instructions !== 'string'
      ) {
        throw new Error(
          `Stored strategy_json is malformed or missing required fields. ` +
            `Re-create the analysis job (do not retry the worker manually). ` +
            `Raw (first 200 chars): ${jobRecord.strategy_json.slice(0, 200)}`
        );
      }
      strategy = parsed;
    }

    // --- LOAD MODEL ---
    // LM Studio requires explicit model loading before streaming
    if (jobRecord.model_name && jobRecord.model_name !== 'default') {
      try {
        console.log(
          `[Analysis Worker ${jobId}] Ensuring model is loaded... (baseUrl=${jobLlmBaseUrl})`
        );
        await loadLlmModelForWorker(
          jobRecord.model_name,
          jobRecord.context_size,
          jobLlmBaseUrl
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

        const rawTranscriptText =
          transcriptRepository.getTranscriptTextForSession(
            summaryTask.session_id,
            session.showSpeakers !== 0
          );
        if (!rawTranscriptText.trim()) throw new Error('Transcript is empty.');

        // Truncate the transcript to a safe fraction of the map context so the
        // model can't blow up on long sessions. tiktoken cl100k_base is only
        // an approximation of the model's native tokenizer, so we leave
        // generous headroom (50% of context) and the cap is reapplied at the
        // message-construction step below. Head+tail strategy preserves the
        // session opening + closing, which carry the most clinical signal.
        const mapContextSize = jobRecord?.context_size ?? 8192;
        const transcriptBudget = Math.max(
          512,
          Math.floor(mapContextSize * 0.5) - 512
        );
        const truncation = truncateTranscriptToTokenBudget(
          rawTranscriptText,
          transcriptBudget
        );
        if (truncation.truncated) {
          console.log(
            `[Analysis Worker ${jobId}] Truncated session ${summaryTask.session_id} transcript: ` +
              `${truncation.originalTokens} -> ${truncation.finalTokens} tokens ` +
              `(${truncation.droppedParagraphs} paragraphs dropped).`
          );
          publishStreamEvent(jobId, {
            phase: 'map',
            type: 'truncated',
            sessionId: summaryTask.session_id,
            summaryId: summaryTask.id,
            originalTokens: truncation.originalTokens,
            finalTokens: truncation.finalTokens,
            droppedParagraphs: truncation.droppedParagraphs,
          });
        }
        const transcriptText = truncation.text;

        let mapMessages: BackendChatMessage[];
        const userMapPhaseSystemPrompt =
          jobRecord?.map_phase_system_prompt &&
          jobRecord.map_phase_system_prompt.trim().length > 0
            ? jobRecord.map_phase_system_prompt
            : null;
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

        if (userMapPhaseSystemPrompt) {
          // Prepend the user's optional system prompt as a NEW system message.
          // The existing system message is preserved so the strategy /
          // "follow the user's instructions" framing still applies.
          mapMessages = [
            {
              id: 0,
              chatId: 0,
              sender: 'system',
              text: userMapPhaseSystemPrompt,
              timestamp: Date.now(),
            },
            ...mapMessages.map((m, i) => ({ ...m, id: i + 1 })),
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
        let hasSentMapThinkingStatus = false;
        let hasSentMapRespondingStatus = false;
        let lastCancelCheck = Date.now();
        const abortController = new AbortController();
        let mapStreamResult: StreamResult = {};

        // Signal the start of the thinking phase for this map summary so the
        // UI can mirror the chat's streamPhase = 'thinking' behavior.
        publishStreamEvent(jobId, {
          phase: 'map',
          type: 'status',
          summaryId: summaryTask.id,
          status: 'thinking',
        });
        hasSentMapThinkingStatus = true;

        const mapStartTime = Date.now();
        // Cap map-phase completions via the shared helper (30% of context,
        // floor 4096). The floor prevents tiny context configurations from
        // leaving thinking models with nowhere to write an answer. 40% of
        // that cap is reserved for thinking so content always has headroom.
        const mapMaxCompletionTokens = computeMapCompletionCap(mapContextSize);
        const mapMaxThinkingTokens = Math.round(mapMaxCompletionTokens * 0.4);
        // Analysis default temperature is 0.3 (lower than the global 0.7) —
        // structured extractive work like summaries benefits from less
        // variance, and high temperature is a known loop amplifier. The
        // user-supplied value on the job still wins.
        const mapTemperature = jobRecord?.temperature ?? 0.3;

        // Build the LLM call options once; reused across retries. We pin
        // chat_template_kwargs.enable_thinking=true so LM Studio doesn't
        // toggle unpredictably between calls (atlas's discipline in
        // apps/api/src/lib/model-client.ts:146-170). We also pass the default
        // stop tokens so the model emits a hard end-of-turn signal instead of
        // running until max_tokens — combined with the new repeat_penalty
        // routing, this is the core fix for the "loopy output" symptom.
        const mapCallOptions = {
          model: jobRecord?.model_name || undefined,
          contextSize: jobRecord?.context_size || undefined,
          abortSignal: abortController.signal,
          llamaCppBaseUrl: jobLlmBaseUrl,
          llmApiToken: resolveLlmApiTokenForWorker(jobLlmBaseUrl),
          temperature: mapTemperature,
          topP: jobRecord?.top_p ?? undefined,
          repeatPenalty: jobRecord?.repeat_penalty ?? undefined,
          numGpuLayers: jobRecord?.num_gpu_layers ?? undefined,
          thinkingBudget: jobRecord?.thinking_budget ?? mapMaxThinkingTokens,
          maxCompletionTokens: mapMaxCompletionTokens,
          passDefaultStopTokens: true,
          hardTimeoutMs: 15 * 60 * 1000,
          chatTemplateKwargs: { enable_thinking: true },
        } as const;

        // Retry the initial connection (and the entire stream) on transient
        // errors with exponential backoff + jitter. Each retry creates a
        // fresh streamLlmChatDetailed call. We do NOT retry on user cancel —
        // the abortSignal aborts the underlying fetch and streamWithRetry
        // sees the AbortError immediately.
        const mapGenerator = streamWithRetry(
          () => streamLlmChatDetailed(mapMessages, mapCallOptions),
          {
            retries: 2,
            onRetry: (err, attempt) => {
              console.warn(
                `[Analysis Worker ${jobId}] map session ${summaryTask.session_id} ` +
                  `attempt ${attempt} failed: ${(err as Error)?.message ?? err}. Retrying.`
              );
            },
          }
        );
        let contentChunkCount = 0;
        let thinkingChunkCount = 0;
        const CHUNK_LOG_EVERY = 20;
        const mapPhaseStart = Date.now();

        let iterResult = await mapGenerator.next();
        while (!iterResult.done) {
          const chunk: LlmChatChunk = iterResult.value;
          const contentChunk = chunk.content ?? '';
          const thinkingChunk = chunk.thinking ?? '';

          if (thinkingChunk) {
            if (!hasOpenThinkingBlock) {
              summaryText += '<think>';
              // Tags belong only in the persisted text; the streamed `token`
              // payload must be tag-free so the UI can render it directly.
              hasOpenThinkingBlock = true;
            }
            summaryText += thinkingChunk;
            thinkingBuffer += thinkingChunk;
          }

          if (contentChunk) {
            if (!hasSentMapRespondingStatus) {
              hasSentMapRespondingStatus = true;
              publishStreamEvent(jobId, {
                phase: 'map',
                type: 'status',
                summaryId: summaryTask.id,
                status: 'responding',
              });
            }
            if (hasOpenThinkingBlock) {
              summaryText += '</think>';
              hasOpenThinkingBlock = false;
            }
            summaryText += contentChunk;
            chunkBuffer += contentChunk;
          }

          // Flush every accumulated chunk to Redis on the same iteration it
          // was produced (no throttle). The setImmediate yield after each
          // publish is the change that turns "all chunks at once" into
          // token-by-token delivery for remote LM Studio connections (where
          // Nagle / the kernel send buffer would otherwise coalesce writes).
          if (chunkBuffer) {
            publishStreamEvent(jobId, {
              phase: 'map',
              type: 'token',
              summaryId: summaryTask.id,
              delta: chunkBuffer,
            });
            chunkBuffer = '';
            contentChunkCount++;
            await new Promise<void>((resolve) => setImmediate(resolve));
          }
          if (thinkingBuffer) {
            publishStreamEvent(jobId, {
              phase: 'map',
              type: 'thinking',
              summaryId: summaryTask.id,
              delta: thinkingBuffer,
            });
            thinkingBuffer = '';
            thinkingChunkCount++;
            await new Promise<void>((resolve) => setImmediate(resolve));
          }

          if (
            contentChunkCount === 1 ||
            contentChunkCount % CHUNK_LOG_EVERY === 0
          ) {
            const total = Date.now() - mapPhaseStart;
            console.log(
              `[Analysis Worker ${jobId}] map chunk #${contentChunkCount} +${(total / 1000).toFixed(2)}s`
            );
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

        // Strip the <think>…</think> envelope when checking for emptiness so a
        // thinking-only output (model thought but produced no answer text)
        // doesn't get rejected.
        const strippedMap = summaryText.replace(
          /<think>[\s\S]*?<\/think>/g,
          ''
        );
        if (!strippedMap.trim()) {
          const promptTk = mapStreamResult.promptTokens ?? 0;
          const completionTk = mapStreamResult.completionTokens ?? 0;
          const thinkingTk = mapStreamResult.thinkingTokens ?? 0;
          const thinkingBudgetUsed = thinkingTk + completionTk;
          const budgetExhaustedByThinking =
            thinkingTk > 0 &&
            thinkingBudgetUsed >= mapMaxCompletionTokens * 0.9;

          let detail: string;
          if (budgetExhaustedByThinking) {
            detail =
              `LLM thinking tokens exhausted the generation budget for session ${summaryTask.session_id} — ` +
              `the model spent all available tokens reasoning (thinkingTokens=${thinkingTk}, ` +
              `completionTokens=${completionTk}, budget=${mapMaxCompletionTokens}) and produced no summary content. ` +
              `Fix: increase the context size setting (currently ${mapContextSize} tokens) so the ` +
              `30% completion cap (floor 4096 tokens, currently ${mapMaxCompletionTokens}) is large enough for both thinking and content.`;
          } else {
            detail =
              `LLM returned an empty summary for session ${summaryTask.session_id} — ` +
              `the model produced only thinking/reasoning with no answer text ` +
              `(model=${jobRecord?.model_name ?? 'unknown'}, promptTokens=${promptTk}, ` +
              `completionTokens=${completionTk}, thinkingTokens=${thinkingTk}, durationMs=${mapDuration}).`;
          }
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

        // Strip the <think>…</think> envelope before persisting so that the
        // reduce phase only receives the model's actual answer, not its
        // reasoning chain. Thinking tokens can be 10× the content length and
        // were the root cause of the ~129 k-token reduce prompts observed in
        // production. The thinking text is still forwarded to the UI via the
        // `type: 'thinking'` stream events above.
        const summaryTextToStore = summaryText
          .replace(/<think>[\s\S]*?<\/think>/g, '')
          .trim();
        analysisRepository.updateIntermediateSummary(
          summaryTask.id,
          'completed',
          summaryTextToStore
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

    // Pre-load the underlying sessions in one pass and hand them to the
    // pure helper. The DB already returned summaries in date order, but
    // assembleReducePrompt re-sorts as defense-in-depth so the
    // "oldest → newest" contract survives any future caller that bypasses
    // the repository helper.
    const sessionsById = new Map<number, BackendSession>();
    for (const summary of successfulSummaries) {
      const session = sessionRepository.findById(summary.session_id);
      if (session) sessionsById.set(session.id, session);
    }

    const reduceMessages = assembleReducePrompt(
      successfulSummaries,
      sessionsById,
      jobRecord?.original_prompt ?? '',
      strategy
    );

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
    let hasSentReduceThinkingStatus = false;
    let hasSentReduceRespondingStatus = false;
    let lastReduceCancelCheck = Date.now();
    const reduceAbortController = new AbortController();
    let reduceStreamResult: StreamResult = {};

    const reduceStartTime = Date.now();

    // Signal the start of the thinking phase for the reduce synthesis so the
    // UI can mirror the chat's streamPhase = 'thinking' behavior.
    publishStreamEvent(jobId, {
      phase: 'reduce',
      type: 'status',
      status: 'thinking',
    });
    hasSentReduceThinkingStatus = true;

    try {
      // Cap reduce-phase completions at 50% of context size (up from 40% —
      // same rationale as the map bump: thinking models need more room for
      // the actual answer). 40% of that cap is reserved for thinking.
      const reduceContextSize = jobRecord?.context_size ?? 8192;
      const reduceMaxCompletionTokens = Math.round(reduceContextSize * 0.5);
      const reduceMaxThinkingTokens = Math.round(
        reduceMaxCompletionTokens * 0.4
      );
      // Same lower default temperature as the map phase — the reduce
      // synthesis is a structured task that benefits from less variance.
      const reduceTemperature = jobRecord?.temperature ?? 0.3;

      const reduceCallOptions = {
        model: jobRecord?.model_name || undefined,
        contextSize: jobRecord?.context_size || undefined,
        abortSignal: reduceAbortController.signal,
        llamaCppBaseUrl: jobLlmBaseUrl,
        llmApiToken: resolveLlmApiTokenForWorker(jobLlmBaseUrl),
        temperature: reduceTemperature,
        topP: jobRecord?.top_p ?? undefined,
        repeatPenalty: jobRecord?.repeat_penalty ?? undefined,
        numGpuLayers: jobRecord?.num_gpu_layers ?? undefined,
        thinkingBudget: jobRecord?.thinking_budget ?? reduceMaxThinkingTokens,
        maxCompletionTokens: reduceMaxCompletionTokens,
        passDefaultStopTokens: true,
        hardTimeoutMs: 15 * 60 * 1000,
        chatTemplateKwargs: { enable_thinking: true },
      } as const;

      // Same retry-on-initial-connection pattern as the map phase.
      const reduceGenerator = streamWithRetry(
        () => streamLlmChatDetailed(reduceMessages, reduceCallOptions),
        {
          retries: 2,
          onRetry: (err, attempt) => {
            console.warn(
              `[Analysis Worker ${jobId}] reduce attempt ${attempt} failed: ` +
                `${(err as Error)?.message ?? err}. Retrying.`
            );
          },
        }
      );

      console.log(`[Analysis Worker ${jobId}] Starting reduce phase stream...`);

      let reduceContentChunkCount = 0;
      let reduceThinkingChunkCount = 0;
      const CHUNK_LOG_EVERY = 20;
      const reducePhaseStart = Date.now();

      let reduceIterResult = await reduceGenerator.next();

      while (!reduceIterResult.done) {
        const chunk: LlmChatChunk = reduceIterResult.value;
        const contentChunk = chunk.content ?? '';
        const thinkingChunk = chunk.thinking ?? '';

        if (thinkingChunk) {
          if (!hasOpenReduceThinkingBlock) {
            finalResult += '<think>';
            // Tags belong only in the persisted text; the streamed `token`
            // payload must be tag-free so the UI can render it directly.
            hasOpenReduceThinkingBlock = true;
          }
          finalResult += thinkingChunk;
          reduceThinkingBuffer += thinkingChunk;
        }

        if (contentChunk) {
          if (!hasSentReduceRespondingStatus) {
            hasSentReduceRespondingStatus = true;
            publishStreamEvent(jobId, {
              phase: 'reduce',
              type: 'status',
              status: 'responding',
            });
          }
          if (hasOpenReduceThinkingBlock) {
            finalResult += '</think>';
            hasOpenReduceThinkingBlock = false;
          }
          finalResult += contentChunk;
          reduceBuffer += contentChunk;
        }

        // Flush every accumulated chunk to Redis on the same iteration it
        // was produced (no throttle). The setImmediate yield after each
        // publish is the change that turns "all chunks at once" into
        // token-by-token delivery for remote LM Studio connections (where
        // Nagle / the kernel send buffer would otherwise coalesce writes).
        if (reduceBuffer) {
          publishStreamEvent(jobId, {
            phase: 'reduce',
            type: 'token',
            delta: reduceBuffer,
          });
          reduceBuffer = '';
          reduceContentChunkCount++;
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
        if (reduceThinkingBuffer) {
          publishStreamEvent(jobId, {
            phase: 'reduce',
            type: 'thinking',
            delta: reduceThinkingBuffer,
          });
          reduceThinkingBuffer = '';
          reduceThinkingChunkCount++;
          await new Promise<void>((resolve) => setImmediate(resolve));
        }

        if (
          reduceContentChunkCount === 1 ||
          reduceContentChunkCount % CHUNK_LOG_EVERY === 0
        ) {
          const total = Date.now() - reducePhaseStart;
          console.log(
            `[Analysis Worker ${jobId}] reduce chunk #${reduceContentChunkCount} +${(total / 1000).toFixed(2)}s`
          );
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
