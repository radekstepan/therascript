// packages/ui/src/hooks/useAnalysisStream.ts
import { useState, useEffect } from 'react';
import axios from 'axios';

const API_BASE_URL = axios.defaults.baseURL || 'http://localhost:3001';

// Matches backend event shape
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
  promptTokens?: number;
  completionTokens?: number;
  duration?: number;
  // For snapshot
  job?: any;
  summaries?: any[];
}

export function useAnalysisStream(jobId: number | null) {
  const [mapLogs, setMapLogs] = useState<Record<number, string>>({});
  const [reduceLog, setReduceLog] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [mapPhaseStartTime, setMapPhaseStartTime] = useState<
    Record<number, number>
  >({});
  const [reducePhaseStartTime, setReducePhaseStartTime] = useState<
    number | null
  >(null);
  const [mapPromptTokens, setMapPromptTokens] = useState<
    Record<number, number>
  >({});
  const [reducePromptTokens, setReducePromptTokens] = useState<number | null>(
    null
  );
  const [mapMetrics, setMapMetrics] = useState<
    Record<
      number,
      {
        promptTokens?: number;
        completionTokens?: number;
        duration?: number;
        tokensPerSecond?: number | undefined;
      }
    >
  >({});
  const [reduceMetrics, setReduceMetrics] = useState<{
    promptTokens?: number;
    completionTokens?: number;
    duration?: number;
    tokensPerSecond?: number | undefined;
  }>({
    promptTokens: undefined,
    completionTokens: undefined,
    duration: undefined,
    tokensPerSecond: undefined,
  });

  useEffect(() => {
    if (!jobId) {
      setMapLogs({});
      setReduceLog('');
      setIsConnected(false);
      setStreamError(null);
      setMapPhaseStartTime({});
      setReducePhaseStartTime(null);
      setMapPromptTokens({});
      setReducePromptTokens(null);
      setMapMetrics({});
      setReduceMetrics({
        promptTokens: undefined,
        completionTokens: undefined,
        duration: undefined,
        tokensPerSecond: undefined,
      });
      return;
    }

    // Reset logs on new job selection
    setMapLogs({});
    setReduceLog('');
    setStreamError(null);
    setMapPhaseStartTime({});
    setReducePhaseStartTime(null);
    setMapPromptTokens({});
    setReducePromptTokens(null);
    setMapMetrics({});
    setReduceMetrics({
      promptTokens: undefined,
      completionTokens: undefined,
      duration: undefined,
      tokensPerSecond: undefined,
    });

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
        } else if (data.type === 'start') {
          if (data.phase === 'map' && data.summaryId && data.promptTokens) {
            setMapPhaseStartTime((prev) => ({
              ...prev,
              [data.summaryId!]: Date.now(),
            }));
            setMapPromptTokens((prev) => ({
              ...prev,
              [data.summaryId!]: data.promptTokens!,
            }));
            setMapMetrics((prev) => ({
              ...prev,
              [data.summaryId!]: {
                promptTokens: data.promptTokens!,
                completionTokens: undefined,
                duration: undefined,
                tokensPerSecond: undefined,
              },
            }));
          } else if (data.phase === 'reduce' && data.promptTokens) {
            setReducePhaseStartTime(Date.now());
            setReducePromptTokens(data.promptTokens);
            setReduceMetrics({
              promptTokens: data.promptTokens!,
              completionTokens: undefined,
              duration: undefined,
              tokensPerSecond: undefined,
            });
          }
        } else if (data.type === 'token') {
          if (data.phase === 'map' && data.summaryId && data.delta) {
            setMapLogs((prev) => ({
              ...prev,
              [data.summaryId!]: (prev[data.summaryId!] || '') + data.delta,
            }));
            const startTime = mapPhaseStartTime[data.summaryId!];
            const promptTokens = mapPromptTokens[data.summaryId!];
            if (startTime && promptTokens !== undefined) {
              const elapsedSeconds = (Date.now() - startTime) / 1000;
              const currentText = mapLogs[data.summaryId!] || '';
              const estimatedGeneratedTokens = currentText.length / 4;
              const totalTokens = promptTokens + estimatedGeneratedTokens;
              const liveTps =
                elapsedSeconds > 0
                  ? estimatedGeneratedTokens / elapsedSeconds
                  : 0;
              setMapMetrics((prev) => ({
                ...prev,
                [data.summaryId!]: {
                  promptTokens,
                  completionTokens: estimatedGeneratedTokens,
                  duration: elapsedSeconds * 1000,
                  tokensPerSecond: liveTps,
                },
              }));
            }
          } else if (data.phase === 'reduce' && data.delta) {
            setReduceLog((prev) => prev + data.delta!);
            const startTime = reducePhaseStartTime;
            const promptTokens = reducePromptTokens;
            if (startTime && promptTokens !== undefined) {
              const elapsedSeconds = (Date.now() - startTime) / 1000;
              const estimatedGeneratedTokens = reduceLog.length / 4;
              const liveTps =
                elapsedSeconds > 0
                  ? estimatedGeneratedTokens / elapsedSeconds
                  : 0;
              setReduceMetrics({
                promptTokens: promptTokens || 0,
                completionTokens: estimatedGeneratedTokens,
                duration: elapsedSeconds * 1000,
                tokensPerSecond: liveTps,
              });
            }
          }
        } else if (data.type === 'end') {
          if (data.phase === 'map' && data.summaryId) {
            const tps =
              data.completionTokens && data.duration && data.duration > 10
                ? (data.completionTokens * 1000) / data.duration
                : undefined;
            const newMetrics: {
              promptTokens?: number;
              completionTokens?: number;
              duration?: number;
              tokensPerSecond?: number | undefined;
            } = {
              promptTokens: data.promptTokens,
              completionTokens: data.completionTokens,
              duration: data.duration,
              tokensPerSecond: tps,
            };
            setMapMetrics((prev) => {
              const updated = { ...prev };
              updated[data.summaryId!] = newMetrics;
              return updated;
            });
          } else if (data.phase === 'reduce') {
            const tps =
              data.completionTokens && data.duration && data.duration > 10
                ? (data.completionTokens * 1000) / data.duration
                : undefined;
            const newMetrics: {
              promptTokens?: number;
              completionTokens?: number;
              duration?: number;
              tokensPerSecond?: number | undefined;
            } = {
              promptTokens: data.promptTokens,
              completionTokens: data.completionTokens,
              duration: data.duration,
              tokensPerSecond: tps,
            };
            setReduceMetrics(newMetrics);
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

  return {
    mapLogs,
    reduceLog,
    mapMetrics,
    reduceMetrics,
    isConnected,
    streamError,
  };
}
