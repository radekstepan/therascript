// packages/ui/src/hooks/useAnalysisStream.ts
import { useState, useEffect } from 'react';
import axios from 'axios';

const API_BASE_URL = axios.defaults.baseURL || 'http://localhost:3001';

// Matches the backend event shape
interface StreamEvent {
  jobId: number;
  timestamp: number;
  phase: 'map' | 'reduce' | 'strategy' | 'snapshot' | 'status';
  type: 'start' | 'token' | 'end' | 'error' | 'status' | 'snapshot';
  sessionId?: number;
  summaryId?: number;
  delta?: string;
  status?: string;
  message?: string;
  // For snapshot
  job?: any;
  summaries?: any[];
}

export function useAnalysisStream(jobId: number | null) {
  const [mapLogs, setMapLogs] = useState<Record<number, string>>({}); // summaryId -> text
  const [reduceLog, setReduceLog] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) {
      setMapLogs({});
      setReduceLog('');
      setIsConnected(false);
      setStreamError(null);
      return;
    }

    // Reset logs on new job selection
    setMapLogs({});
    setReduceLog('');
    setStreamError(null);

    const eventSource = new EventSource(
      `${API_BASE_URL}/api/analysis-jobs/${jobId}/stream`
    );

    eventSource.onopen = () => {
      console.log(`[Stream] Connected to job ${jobId}`);
      setIsConnected(true);
      setStreamError(null);
    };

    eventSource.onerror = (err) => {
      console.error('[Stream] Connection error:', err);
      // EventSource automatically retries, but we want to know state
      if (eventSource.readyState === EventSource.CLOSED) {
        setIsConnected(false);
      }
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as StreamEvent;

        if (data.type === 'snapshot') {
          // Initialize logs from DB state if available
          if (data.summaries) {
            const initialMapLogs: Record<number, string> = {};
            data.summaries.forEach((s: any) => {
              if (s.summary_text) {
                initialMapLogs[s.id] = s.summary_text;
              }
            });
            setMapLogs(initialMapLogs);
          }
          if (data.job?.final_result) {
            setReduceLog(data.job.final_result);
          }
        } else if (data.type === 'token') {
          if (data.phase === 'map' && data.summaryId && data.delta) {
            setMapLogs((prev) => ({
              ...prev,
              [data.summaryId!]: (prev[data.summaryId!] || '') + data.delta,
            }));
          } else if (data.phase === 'reduce' && data.delta) {
            setReduceLog((prev) => prev + data.delta!);
          }
        } else if (
          data.type === 'status' &&
          ['completed', 'failed', 'canceled'].includes(data.status!)
        ) {
          eventSource.close();
          setIsConnected(false);
        }
      } catch (e) {
        console.error('[Stream] Error parsing message:', e);
      }
    };

    return () => {
      console.log(`[Stream] Closing connection for job ${jobId}`);
      eventSource.close();
      setIsConnected(false);
    };
  }, [jobId]);

  return { mapLogs, reduceLog, isConnected, streamError };
}
