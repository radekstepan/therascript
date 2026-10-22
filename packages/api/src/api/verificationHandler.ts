// packages/api/src/api/verificationHandler.ts
import {
  verificationRepository,
  resolveVerificationSkipVerified,
  sessionRepository,
  chatRepository,
  messageRepository,
} from '@therascript/data';
import {
  InternalServerError,
  NotFoundError,
  ConflictError,
  ApiError,
  BadRequestError,
} from '../errors.js';
import type {
  BackendMessageVerification,
  BackendVerificationJob,
  StatementSeverity,
  StatementVerdict,
  VerificationGlobalStats,
  VerificationJobScope,
} from '@therascript/domain';
import type {
  FailedVerificationItem,
  FlaggedStatementsResult,
} from '@therascript/data';
import {
  addVerificationJob,
  cancelVerificationJobFromQueue,
  isVerificationJobQueued,
} from '../services/jobQueueService.js';
import { subscribeToVerificationStream } from '../services/streamSubscriber.js';
import {
  getConfiguredTopP,
  getConfiguredRepeatPenalty,
  getConfiguredNumGpuLayers,
  getConfiguredThinkingBudget,
  getActiveBaseUrl,
  getActiveModel,
  getConfiguredContextSize,
} from '../services/activeModelService.js';

interface VerificationHandlerContext {
  params: { jobId?: string | number } & Record<
    string,
    string | number | undefined
  >;
  query?: Record<string, string | string[] | undefined>;
  set: { status?: number | string };
}

const TERMINAL_JOB_STATUSES: ReadonlySet<string> = new Set([
  'completed',
  'failed',
  'canceled',
]);

const KNOWN_VERDICTS: ReadonlySet<string> = new Set([
  'supported',
  'partially_supported',
  'contradicted',
  'fabricated',
  'omission',
]);

const KNOWN_SEVERITIES: ReadonlySet<string> = new Set([
  'none',
  'low',
  'medium',
  'high',
  'critical',
]);

export interface CreateVerificationJobBody {
  scope: VerificationJobScope;
  sessionIds?: number[];
  chatId?: number;
  skipVerified?: boolean;
  modelName?: string;
  contextSize?: number | null;
  thinkingBudget?: number | null;
  temperature?: number;
  topP?: number;
  repeatPenalty?: number;
  numGpuLayers?: number | null;
  baseUrl?: string;
}

const parseJobId = (raw: string | number | undefined): number =>
  typeof raw === 'number' ? raw : parseInt(raw ?? '0', 10);

const parseCsv = (value: string | string[] | undefined): string[] => {
  if (!value) return [];
  const parts = Array.isArray(value) ? value : [value];
  return parts
    .flatMap((part) => part.split(','))
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
};

const parseOptionalNumber = (
  value: string | string[] | undefined
): number | undefined => {
  if (value === undefined) return undefined;
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const parseOptionalString = (
  value: string | string[] | undefined
): string | undefined => {
  if (value === undefined) return undefined;
  const raw = (Array.isArray(value) ? value[0] : value).trim();
  return raw.length > 0 ? raw : undefined;
};

/**
 * Reconciles a rejected queue submission for an already-persisted
 * verification job row. A rejection is ambiguous — the server may have
 * accepted the job before the connection dropped — so the deterministic
 * queue identity is checked first:
 *
 * - Queue holds the job: the submission actually succeeded; the row stays
 *   pending for the worker and the caller reports success.
 * - Otherwise (or when queue state itself is unreadable): the row is
 *   marked terminal `failed` with the queue error so the active-job guard
 *   cannot be blocked by an orphan no worker can process. Failing closed
 *   is safe because the worker's conditional `transitionJobToProcessing`
 *   never revives a terminal row — a stray queued job exits without
 *   touching the failed row or duplicating a retried audit's work.
 *
 * Resolves when the job is live on the queue; otherwise throws an
 * `InternalServerError` carrying the queue failure detail.
 */
const reconcileRejectedVerificationSubmission = async (
  dbJobId: number,
  queueError: unknown
): Promise<void> => {
  let queued = false;
  try {
    queued = await isVerificationJobQueued(dbJobId);
  } catch (lookupError) {
    console.warn(
      `[VerificationHandler] Could not verify queue state for job ${dbJobId} after submission failure; marking it failed:`,
      lookupError
    );
  }
  if (queued) {
    console.warn(
      `[VerificationHandler] Queue submission for job ${dbJobId} reported an error but the job is queued; leaving it pending.`
    );
    return;
  }
  const detail =
    queueError instanceof Error && queueError.message.length > 0
      ? queueError.message
      : String(queueError ?? 'unknown error');
  const message = `Failed to submit verification job to the queue: ${detail}`;
  try {
    verificationRepository.updateJobStatus(dbJobId, 'failed', {
      errorMessage: message,
    });
  } catch (dbError) {
    console.error(
      `[VerificationHandler] Failed to mark job ${dbJobId} failed after queue submission error:`,
      dbError
    );
  }
  throw new InternalServerError(
    message,
    queueError instanceof Error ? queueError : undefined
  );
};

/**
 * Shared job-creation core used by both the global verification endpoint and
 * the single-chat "verify" action: validates scope filters, refuses to start
 * a second job while one is active, snapshots the Judge LLM config into the
 * job row (without touching the user's global chat model), persists the job
 * row, and enqueues the BullMQ job. The worker loads the Judge model itself
 * when it picks the job up and keeps it loaded afterwards. If queue
 * submission rejects, the row is
 * reconciled (ambiguous successes stay pending; anything else lands terminal
 * `failed` with the queue error) instead of orphaning a pending job.
 */
export const createVerificationJobRecord = async (
  body: CreateVerificationJobBody
): Promise<BackendVerificationJob> => {
  const {
    scope,
    sessionIds,
    chatId,
    skipVerified,
    modelName,
    contextSize: requestedContextSize,
    thinkingBudget,
    temperature,
    topP,
    repeatPenalty,
    numGpuLayers,
    baseUrl: requestedBaseUrl,
  } = body;

  if (
    scope !== 'all_unverified' &&
    scope !== 'all_force' &&
    scope !== 'selected_sessions' &&
    scope !== 'single_chat'
  ) {
    throw new BadRequestError(
      `Invalid scope "${String(scope)}". Expected one of: all_unverified, all_force, selected_sessions, single_chat.`
    );
  }

  if (scope === 'selected_sessions') {
    if (!sessionIds || sessionIds.length === 0) {
      throw new BadRequestError(
        'sessionIds must be a non-empty array when scope is "selected_sessions".'
      );
    }
    for (const sessionId of sessionIds) {
      if (!sessionRepository.findById(sessionId)) {
        throw new BadRequestError(`Session with ID ${sessionId} not found.`);
      }
    }
  }

  if (scope === 'single_chat') {
    if (chatId === undefined || chatId === null) {
      throw new BadRequestError(
        'chatId is required when scope is "single_chat".'
      );
    }
    const chat = chatRepository.findChatById(chatId);
    if (!chat || chat.sessionId === null || chat.sessionId === undefined) {
      throw new BadRequestError(
        `Chat ${chatId} not found or is not bound to a session.`
      );
    }
  }

  // Guard against duplicate concurrent jobs: a second job would thrash
  // the Judge model (load/unload races) and duplicate LLM calls. Runs
  // after scope validation so malformed requests still get a 400.
  if (verificationRepository.hasActiveVerificationJobs()) {
    throw new ConflictError(
      'A verification job is already in progress. Please wait for it to finish or cancel it before starting a new one.'
    );
  }

  // Resolve the per-job LLM base URL before snapshotting so the worker
  // streams to the same endpoint the user selected.
  const jobLlmBaseUrl =
    requestedBaseUrl && requestedBaseUrl.trim().length > 0
      ? requestedBaseUrl.trim()
      : getActiveBaseUrl();

  const llmParams = {
    thinkingBudget:
      thinkingBudget !== undefined
        ? thinkingBudget
        : getConfiguredThinkingBudget(),
    // Deterministic Judge default: verdict JSON needs low variance, not the
    // global chat temperature (0.7). An explicit caller value still wins.
    temperature: temperature ?? 0.3,
    topP: topP ?? getConfiguredTopP(),
    repeatPenalty: repeatPenalty ?? getConfiguredRepeatPenalty(),
    numGpuLayers:
      numGpuLayers !== undefined ? numGpuLayers : getConfiguredNumGpuLayers(),
  };
  const contextSizeToUse =
    requestedContextSize !== undefined && requestedContextSize !== null
      ? requestedContextSize
      : getConfiguredContextSize();

  // NOTE: creating a background job must NOT mutate the user's global
  // chat model (no unloadModelAtUrl / setActiveModelAndContextAndParams
  // here): doing so would overwrite Session/Standalone chat settings before
  // the Judge model is actually loaded and could unload a model mid-stream.
  // The Judge config is snapshotted into the job row below; the worker loads
  // that model when it picks the job up, adopts it as the active settings,
  // and keeps it loaded after the job finishes.
  const judgeModelName = modelName || getActiveModel();

  // Scope owns skip semantics for the global audits: all_force always
  // re-audits and all_unverified always skips, regardless of an omitted
  // or conflicting skipVerified flag, so the persisted row can never
  // contradict its scope. The narrowed scopes honor the flag explicitly.
  const resolvedSkipVerified = resolveVerificationSkipVerified(
    scope,
    skipVerified
  );

  const job = verificationRepository.createVerificationJob({
    scope,
    sessionIds: scope === 'selected_sessions' ? (sessionIds ?? null) : null,
    chatId: scope === 'single_chat' ? (chatId ?? null) : null,
    skipVerified: resolvedSkipVerified,
    modelName: judgeModelName,
    contextSize: contextSizeToUse,
    thinkingBudget: llmParams.thinkingBudget,
    temperature: llmParams.temperature,
    topP: llmParams.topP,
    repeatPenalty: llmParams.repeatPenalty,
    numGpuLayers: llmParams.numGpuLayers,
    llmBaseUrl: jobLlmBaseUrl,
  });

  try {
    await addVerificationJob({ jobId: job.id });
  } catch (queueError) {
    // The SQLite row is already committed: reconcile instead of leaving a
    // pending orphan that would block the active-job guard with no worker
    // able to process it. Resolves when the job is live on the queue
    // (ambiguous success); otherwise marks the row terminal `failed` and
    // rethrows the queue failure.
    await reconcileRejectedVerificationSubmission(job.id, queueError);
  }
  return job;
};

export const createVerificationJobHandler = async ({
  body,
  set,
}: {
  body: unknown;
  set: { status?: number | string };
}): Promise<{ jobId: number }> => {
  try {
    const job = await createVerificationJobRecord(
      body as CreateVerificationJobBody
    );
    set.status = 202;
    return { jobId: job.id };
  } catch (error) {
    console.error(
      '[VerificationHandler] Error creating verification job:',
      error
    );
    if (error instanceof ApiError) throw error;
    throw new InternalServerError(
      'Failed to create verification job.',
      error instanceof Error ? error : undefined
    );
  }
};

export const listVerificationJobsHandler = ({
  set,
}: VerificationHandlerContext): BackendVerificationJob[] => {
  try {
    const jobs = verificationRepository.findAllVerificationJobs(50);
    set.status = 200;
    return jobs;
  } catch (error) {
    console.error(
      '[VerificationHandler] Error listing verification jobs:',
      error
    );
    throw new InternalServerError(
      'Failed to list verification jobs.',
      error instanceof Error ? error : undefined
    );
  }
};

export const getVerificationJobHandler = ({
  params,
  set,
}: VerificationHandlerContext): BackendVerificationJob => {
  const jobId = parseJobId(params.jobId);
  try {
    const job = verificationRepository.findVerificationJobById(jobId);
    if (!job) {
      throw new NotFoundError(`Verification job with ID ${jobId}`);
    }
    set.status = 200;
    return job;
  } catch (error) {
    console.error(
      `[VerificationHandler] Error getting verification job ${jobId}:`,
      error
    );
    if (error instanceof ApiError) throw error;
    throw new InternalServerError(
      'Failed to get verification job details.',
      error instanceof Error ? error : undefined
    );
  }
};

export const getVerificationJobFailuresHandler = ({
  params,
  set,
}: VerificationHandlerContext): {
  jobId: number;
  failures: FailedVerificationItem[];
} => {
  const jobId = parseJobId(params.jobId);
  try {
    const job = verificationRepository.findVerificationJobById(jobId);
    if (!job) {
      throw new NotFoundError(`Verification job with ID ${jobId}`);
    }
    const failures =
      verificationRepository.findFailedVerificationsByJobId(jobId);
    set.status = 200;
    return { jobId, failures };
  } catch (error) {
    console.error(
      `[VerificationHandler] Error getting failures for verification job ${jobId}:`,
      error
    );
    if (error instanceof ApiError) throw error;
    throw new InternalServerError(
      'Failed to get verification job failures.',
      error instanceof Error ? error : undefined
    );
  }
};

export const cancelVerificationJobHandler = async ({
  params,
  set,
}: VerificationHandlerContext): Promise<{ message: string }> => {
  const jobId = parseJobId(params.jobId);
  try {
    const job = verificationRepository.findVerificationJobById(jobId);
    if (!job) {
      throw new NotFoundError(`Verification job with ID ${jobId}`);
    }
    if (TERMINAL_JOB_STATUSES.has(job.status)) {
      throw new ConflictError(
        `Job ${jobId} is already in a terminal state (${job.status}) and cannot be canceled.`
      );
    }
    // The worker polls this status before each message and mid-stream, so a
    // processing job stops cooperatively. Also remove it from the queue in
    // case it hasn't been picked up yet (best-effort).
    verificationRepository.updateJobStatus(jobId, 'canceled');
    try {
      await cancelVerificationJobFromQueue(jobId);
    } catch (queueErr) {
      console.warn(
        `[VerificationHandler] Failed to remove job ${jobId} from queue (non-fatal):`,
        queueErr
      );
    }
    set.status = 202;
    return { message: `Cancellation request for job ${jobId} accepted.` };
  } catch (error) {
    console.error(
      `[VerificationHandler] Error canceling verification job ${jobId}:`,
      error
    );
    if (error instanceof ApiError) throw error;
    throw new InternalServerError(
      'Failed to cancel verification job.',
      error instanceof Error ? error : undefined
    );
  }
};

export const streamVerificationJobHandler = ({
  params,
  set,
}: VerificationHandlerContext): Response => {
  const jobId = parseJobId(params.jobId);
  const job = verificationRepository.findVerificationJobById(jobId);

  if (!job) {
    set.status = 404;
    return new Response('Job not found', { status: 404 });
  }

  let unsubscribe: (() => void) | null = null;
  let streamClosed = false;
  // Set once a terminal close is scheduled: refuses sends queued after the
  // terminal event while the already-queued payloads still flush.
  let closing = false;
  // Serializes deferred enqueues with stream closure so the terminal
  // payload (and any progress queued before it) is always flushed before
  // the controller closes. Links never reject.
  let enqueueChain: Promise<void> = Promise.resolve();

  // Idempotent: safe to call from the terminal path, cancel(), and
  // enqueue-error handling without double-unsubscribing.
  const doUnsubscribe = (): void => {
    const fn = unsubscribe;
    unsubscribe = null;
    if (fn) {
      try {
        fn();
      } catch {
        // Best-effort teardown; subscriber cleanup must not break the stream.
      }
    }
  };

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const send = (data: object) => {
        if (streamClosed || closing) return;
        enqueueChain = enqueueChain.then(
          () =>
            new Promise<void>((resolve) => {
              // Yield to the event loop so each per-event write actually hits
              // the wire on its own (see streamSubscriber): without this, a
              // burst of Redis messages arriving in the same tick would be
              // coalesced into a single kernel send buffer flush on remote
              // (non-loopback) sockets, making streaming appear to stall.
              setImmediate(() => {
                if (!streamClosed) {
                  try {
                    controller.enqueue(
                      encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
                    );
                  } catch (e: any) {
                    // The stream is dead (client gone or controller closed):
                    // drop the rest of the queue rather than throwing out of
                    // the timer (which would escape as an uncaughtException)
                    // or stalling the serialized close below.
                    streamClosed = true;
                    doUnsubscribe();
                    if (e?.code !== 'ERR_INVALID_STATE') {
                      console.error(
                        `[Stream API] Unexpected enqueue error for verification job ${jobId}:`,
                        e
                      );
                    }
                  }
                }
                resolve();
              });
            })
        );
      };

      // Serialized close: appended to the enqueue chain so it runs after
      // every payload scheduled before it. Idempotent via closing/closed.
      const closeStream = () => {
        if (closing || streamClosed) return;
        closing = true;
        // Stop the Redis flow now; payloads already chained still flush.
        doUnsubscribe();
        enqueueChain = enqueueChain.then(() => {
          if (streamClosed) return;
          streamClosed = true;
          try {
            controller.close();
          } catch {
            // Already closed — nothing to do.
          }
        });
      };

      // 1. Send initial snapshot
      send({ type: 'snapshot', job });

      // 2. If the job is already terminal, close once the snapshot flushes
      // so clients don't hang on a finished job.
      if (TERMINAL_JOB_STATUSES.has(job.status)) {
        closeStream();
        return;
      }

      // 3. Subscribe to Redis events
      unsubscribe = subscribeToVerificationStream(jobId, (event) => {
        send(event);

        if (
          (event.type === 'status' ||
            event.type === 'complete' ||
            event.type === 'error') &&
          event.status &&
          TERMINAL_JOB_STATUSES.has(event.status)
        ) {
          console.log(
            `[Stream API] Verification job ${jobId} finished. Closing stream.`
          );
          closeStream();
        }
      });
    },
    cancel() {
      console.log(
        `[Stream API] Client disconnected from verification job ${jobId} stream.`
      );
      streamClosed = true;
      doUnsubscribe();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    },
  });
};

export const getVerificationStatsHandler = ({
  query,
  set,
}: VerificationHandlerContext): VerificationGlobalStats => {
  try {
    const sessionId = parseOptionalNumber(query?.sessionId);
    const stats = verificationRepository.getGlobalVerificationAnalytics({
      sessionIds: sessionId !== undefined ? [sessionId] : undefined,
      model: parseOptionalString(query?.model) ?? null,
      startDate: parseOptionalString(query?.startDate) ?? null,
      endDate: parseOptionalString(query?.endDate) ?? null,
    });
    set.status = 200;
    return stats;
  } catch (error) {
    console.error(
      '[VerificationHandler] Error computing verification stats:',
      error
    );
    throw new InternalServerError(
      'Failed to compute verification statistics.',
      error instanceof Error ? error : undefined
    );
  }
};

export const listVerificationStatementsHandler = ({
  query,
  set,
}: VerificationHandlerContext): FlaggedStatementsResult => {
  try {
    const verdicts = parseCsv(query?.verdict).filter((v) =>
      KNOWN_VERDICTS.has(v)
    ) as StatementVerdict[];
    const severities = parseCsv(query?.severity).filter((s) =>
      KNOWN_SEVERITIES.has(s)
    ) as StatementSeverity[];
    const limit = Math.min(
      Math.max(parseOptionalNumber(query?.limit) ?? 50, 1),
      200
    );
    const offset = Math.max(parseOptionalNumber(query?.offset) ?? 0, 0);

    const result = verificationRepository.findFlaggedStatements({
      verdicts: verdicts.length > 0 ? verdicts : undefined,
      severities: severities.length > 0 ? severities : undefined,
      authoredModel: parseOptionalString(query?.authoredModel) ?? null,
      sessionId: parseOptionalNumber(query?.sessionId) ?? null,
      clientName: parseOptionalString(query?.clientName) ?? null,
      search: parseOptionalString(query?.search) ?? null,
      limit,
      offset,
    });
    set.status = 200;
    return result;
  } catch (error) {
    console.error(
      '[VerificationHandler] Error listing verification statements:',
      error
    );
    throw new InternalServerError(
      'Failed to list verification statements.',
      error instanceof Error ? error : undefined
    );
  }
};

export const deleteMessageVerificationHandler = ({
  params,
  set,
}: VerificationHandlerContext): { message: string } => {
  const messageId = parseJobId(params.messageId);
  try {
    const message = messageRepository.findMessageById(messageId);
    if (!message) {
      throw new NotFoundError(`Message with ID ${messageId}`);
    }
    const deleted = verificationRepository.deleteMessageVerification(messageId);
    if (!deleted) {
      throw new NotFoundError(`Verification for message with ID ${messageId}`);
    }
    set.status = 200;
    return {
      message: `Verification for message ${messageId} deleted.`,
    };
  } catch (error) {
    console.error(
      `[VerificationHandler] Error deleting verification for message ${messageId}:`,
      error
    );
    if (error instanceof ApiError) throw error;
    throw new InternalServerError(
      'Failed to delete message verification.',
      error instanceof Error ? error : undefined
    );
  }
};

export const resetVerificationsHandler = ({
  set,
}: VerificationHandlerContext): {
  message: string;
  deletedVerifications: number;
} => {
  try {
    // Refuse to wipe audit data while a job is running — the worker would
    // keep writing rows and counters mid-reset.
    if (verificationRepository.hasActiveVerificationJobs()) {
      throw new ConflictError(
        'Cannot reset verifications while a verification job is in progress. Cancel it first.'
      );
    }
    const { deletedVerifications } =
      verificationRepository.resetAllVerifications();
    set.status = 200;
    return {
      message: `All verifications cleared (${deletedVerifications} message(s)).`,
      deletedVerifications,
    };
  } catch (error) {
    console.error(
      '[VerificationHandler] Error resetting verifications:',
      error
    );
    if (error instanceof ApiError) throw error;
    throw new InternalServerError(
      'Failed to reset verifications.',
      error instanceof Error ? error : undefined
    );
  }
};

export const getChatVerificationsHandler = ({
  chatData,
  set,
}: {
  chatData: { id: number };
  set: { status?: number | string };
}): BackendMessageVerification[] => {
  try {
    const verifications = verificationRepository.findVerificationsByChatId(
      chatData.id
    );
    set.status = 200;
    return verifications;
  } catch (error) {
    console.error(
      `[VerificationHandler] Error getting verifications for chat ${chatData.id}:`,
      error
    );
    throw new InternalServerError(
      'Failed to get chat verifications.',
      error instanceof Error ? error : undefined
    );
  }
};

export const verifySingleChatHandler = async ({
  body,
  chatData,
  set,
}: {
  body: unknown;
  chatData: { id: number };
  set: { status?: number | string };
}): Promise<{ jobId: number }> => {
  try {
    const overrides = (body ?? {}) as Partial<CreateVerificationJobBody>;
    const job = await createVerificationJobRecord({
      ...(overrides as CreateVerificationJobBody),
      scope: 'single_chat',
      chatId: chatData.id,
    });
    set.status = 202;
    return { jobId: job.id };
  } catch (error) {
    console.error(
      `[VerificationHandler] Error creating single-chat verification for chat ${chatData.id}:`,
      error
    );
    if (error instanceof ApiError) throw error;
    throw new InternalServerError(
      'Failed to create single-chat verification job.',
      error instanceof Error ? error : undefined
    );
  }
};
