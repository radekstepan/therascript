// packages/ui/src/hooks/useVerificationStream.ts
//
// Real-time SSE hook for a verification job, modeled on useAnalysisStream.
// Connects to GET /api/verification/jobs/:jobId/stream and refreshes the
// dashboard queries as messages finish auditing.
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { API_BASE_URL } from '../api/baseUrl';
import type {
  VerificationJob,
  VerificationStreamEvent,
} from '../api/verification';

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'canceled']);

interface UseVerificationStreamOptions {
  /** Called once when the job reaches a terminal status. */
  onTerminal?: (status: string) => void;
  /** When false, no EventSource is opened (e.g. job already terminal). */
  enabled?: boolean;
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
  const [isConnected, setIsConnected] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const onTerminalRef = useRef(options?.onTerminal);
  onTerminalRef.current = options?.onTerminal;

  useEffect(() => {
    if (!jobId || options?.enabled === false) {
      setJob(null);
      setLastEvent(null);
      setIsConnected(false);
      setStreamError(null);
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

    eventSource.onopen = () => {
      setIsConnected(true);
      setStreamError(null);
    };

    eventSource.onerror = () => {
      if (eventSource.readyState === EventSource.CLOSED) {
        setIsConnected(false);
      }
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as VerificationStreamEvent;
        setLastEvent(data);

        if (data.type === 'snapshot' && data.job) {
          setJob(data.job);
          if (TERMINAL_STATUSES.has(data.job.status)) {
            eventSource.close();
            setIsConnected(false);
            invalidateDashboard();
            onTerminalRef.current?.(data.job.status);
          }
          return;
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
          if (data.totalStatements !== undefined)
            next.total_statements = data.totalStatements;
          if (data.flaggedStatements !== undefined)
            next.flagged_statements = data.flaggedStatements;
          if (data.omissionsCount !== undefined)
            next.omissions_count = data.omissionsCount;
          if (data.message && data.type === 'error')
            next.error_message = data.message;
          return next;
        });

        if (data.type === 'message_verified' || data.type === 'progress') {
          invalidateDashboard();
        }

        if (
          (data.type === 'status' ||
            data.type === 'complete' ||
            data.type === 'error') &&
          data.status &&
          TERMINAL_STATUSES.has(data.status)
        ) {
          eventSource.close();
          setIsConnected(false);
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

  return { job, lastEvent, isConnected, streamError };
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
