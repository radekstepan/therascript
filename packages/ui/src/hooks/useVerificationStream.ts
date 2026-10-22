// packages/ui/src/hooks/useVerificationStream.ts
//
// Real-time SSE hook for a verification job, modeled on useAnalysisStream.
// Connects to GET /api/verification/jobs/:jobId/stream and refreshes the
// dashboard queries as messages finish auditing.
//
// Besides counters, the hook tracks the worker's live phase
// (`waiting_for_lock` … `finishing`) so the banner shows truthful
// indeterminate activity while `processed_messages` legitimately stays
// flat during LLM generation. Connection trouble (`connectionLost`) is
// reported separately from Judge failures (`streamError`): the former
// reconciles through the existing polling/refetch path, the latter is a
// persisted per-message diagnosis.
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { API_BASE_URL } from '../api/baseUrl';
import type {
  VerificationJob,
  VerificationLivePhase,
  VerificationPhase,
  VerificationStreamEvent,
} from '../api/verification';

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'canceled']);

const KNOWN_PHASES: ReadonlySet<string> = new Set([
  'waiting_for_lock',
  'loading_judge',
  'checking_message',
  'generating',
  'retrying',
  'finishing',
]);

interface UseVerificationStreamOptions {
  /** Called once when the job reaches a terminal status. */
  onTerminal?: (status: string) => void;
  /** When false, no EventSource is opened (e.g. job already terminal). */
  enabled?: boolean;
}

function isJobStatus(value: string): value is VerificationJob['status'] {
  return (
    value === 'pending' ||
    value === 'processing' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'canceled'
  );
}

function isPhase(value: unknown): value is VerificationPhase {
  return typeof value === 'string' && KNOWN_PHASES.has(value);
}

/** Seed live phase from the durable snapshot columns (reload/reconnect). */
function phaseFromJob(job: VerificationJob): VerificationLivePhase | null {
  if (!isPhase(job.current_phase)) return null;
  return {
    phase: job.current_phase,
    message: null,
    messageId: job.current_message_id ?? null,
    chatId: null,
    sessionId: null,
    messageIndex: null,
    attempt: job.current_attempt ?? null,
    elapsedMs: null,
    tokensPerSecond: null,
    generatedTokens: null,
    updatedAt: job.phase_updated_at ?? Date.now(),
  };
}

function phaseFromEvent(
  data: VerificationStreamEvent
): VerificationLivePhase | null {
  if (!isPhase(data.phase)) return null;
  return {
    phase: data.phase,
    message: data.message ?? null,
    messageId: data.messageId ?? null,
    chatId: data.chatId ?? null,
    sessionId: data.sessionId ?? null,
    messageIndex: data.messageIndex ?? null,
    attempt: data.attempt ?? null,
    elapsedMs: data.elapsedMs ?? null,
    // Throttled generating/retrying ticks carry the live speed; every
    // other phase event (or a missing field) clears it.
    tokensPerSecond: data.tokensPerSecond ?? null,
    generatedTokens: data.generatedTokens ?? null,
    updatedAt: data.timestamp ?? Date.now(),
  };
}

export function useVerificationStream(
  jobId: number | null,
  options?: UseVerificationStreamOptions
) {
  const queryClient = useQueryClient();
  const [job, setJob] = useState<VerificationJob | null>(null);
  const [lastEvent, setLastEvent] = useState<VerificationStreamEvent | null>(
    null
  );
  const [phase, setPhase] = useState<VerificationLivePhase | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [connectionLost, setConnectionLost] = useState(false);
  const onTerminalRef = useRef(options?.onTerminal);
  onTerminalRef.current = options?.onTerminal;

  useEffect(() => {
    if (!jobId || options?.enabled === false) {
      setJob(null);
      setLastEvent(null);
      setPhase(null);
      setIsConnected(false);
      setStreamError(null);
      setConnectionLost(false);
      return;
    }

    const invalidateDashboard = () => {
      queryClient.invalidateQueries({ queryKey: ['verificationStats'] });
      queryClient.invalidateQueries({ queryKey: ['verificationJobs'] });
      queryClient.invalidateQueries({ queryKey: ['chatVerifications'] });
      queryClient.invalidateQueries({ queryKey: ['verificationStatements'] });
    };

    const eventSource = new EventSource(
      `${API_BASE_URL}/api/verification/jobs/${jobId}/stream`
    );
    // Set once a terminal event lands: later `onerror` firings from the
    // closing socket must not raise a spurious connection alarm.
    let terminalReached = false;

    eventSource.onopen = () => {
      setIsConnected(true);
      setConnectionLost(false);
      setStreamError(null);
    };

    eventSource.onerror = () => {
      if (terminalReached) return;
      if (eventSource.readyState === EventSource.CLOSED) {
        setIsConnected(false);
        // The terminal event may have been missed (dropped socket): refetch
        // through the existing polling path so the banner reconciles
        // instead of hanging on stale progress.
        setConnectionLost(true);
        invalidateDashboard();
      } else {
        // CONNECTING: EventSource is retrying on its own; flag transient
        // trouble without treating it as a Judge failure.
        setConnectionLost(true);
      }
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as VerificationStreamEvent;
        setLastEvent(data);
        // Any live event proves the socket is healthy.
        setConnectionLost(false);

        if (data.type === 'snapshot' && data.job) {
          setJob(data.job);
          setPhase(phaseFromJob(data.job));
          if (TERMINAL_STATUSES.has(data.job.status)) {
            terminalReached = true;
            eventSource.close();
            setIsConnected(false);
            invalidateDashboard();
            onTerminalRef.current?.(data.job.status);
          }
          return;
        }

        const eventPhase = phaseFromEvent(data);
        if (eventPhase) setPhase(eventPhase);

        // Generation ended but the last phase detail stays: clear any
        // lingering live speed (the terminal path below clears the phase
        // itself). Survives worker events that omit the telemetry fields.
        if (
          data.type === 'message_verified' ||
          data.type === 'complete' ||
          data.type === 'error' ||
          (data.type === 'status' &&
            data.status &&
            TERMINAL_STATUSES.has(data.status))
        ) {
          setPhase((prev) =>
            prev &&
            (prev.tokensPerSecond !== null || prev.generatedTokens !== null)
              ? { ...prev, tokensPerSecond: null, generatedTokens: null }
              : prev
          );
        }

        // Merge progress counters into the local job snapshot so the
        // banner stays live without refetching on every event.
        setJob((prev) => {
          if (!prev) return prev;
          const next: VerificationJob = { ...prev };
          if (data.status && isJobStatus(data.status))
            next.status = data.status;
          if (data.totalMessages !== undefined)
            next.total_messages = data.totalMessages;
          if (data.processedMessages !== undefined)
            next.processed_messages = data.processedMessages;
          if (data.succeededMessages !== undefined)
            next.succeeded_messages = data.succeededMessages;
          if (data.failedMessages !== undefined)
            next.failed_messages = data.failedMessages;
          if (data.skippedMessages !== undefined)
            next.skipped_messages = data.skippedMessages;
          if (data.totalStatements !== undefined)
            next.total_statements = data.totalStatements;
          if (data.flaggedStatements !== undefined)
            next.flagged_statements = data.flaggedStatements;
          if (data.omissionsCount !== undefined)
            next.omissions_count = data.omissionsCount;
          if (eventPhase) {
            next.current_phase = eventPhase.phase;
            next.current_message_id = eventPhase.messageId;
            next.current_attempt = eventPhase.attempt;
            next.phase_updated_at = eventPhase.updatedAt;
          }
          if (data.message && data.type === 'error')
            next.error_message = data.message;
          // Mixed runs complete with an error summary: keep it visible.
          if (data.message && data.type === 'complete')
            next.error_message = data.message;
          return next;
        });

        if (
          data.type === 'message_verified' ||
          data.type === 'progress' ||
          data.type === 'phase'
        ) {
          invalidateDashboard();
        }

        if (
          (data.type === 'status' ||
            data.type === 'complete' ||
            data.type === 'error') &&
          data.status &&
          TERMINAL_STATUSES.has(data.status)
        ) {
          terminalReached = true;
          eventSource.close();
          setIsConnected(false);
          setPhase(null);
          invalidateDashboard();
          onTerminalRef.current?.(data.status);
        }

        if (data.type === 'error' && data.message) {
          setStreamError(data.message);
        }
      } catch (e) {
        console.error('[VerificationStream] Error parsing message:', e);
      }
    };

    return () => {
      eventSource.close();
      setIsConnected(false);
    };
  }, [jobId, options?.enabled, queryClient]);

  return { job, lastEvent, phase, isConnected, streamError, connectionLost };
}
