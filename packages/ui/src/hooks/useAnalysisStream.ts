// packages/ui/src/hooks/useAnalysisStream.ts
import { useState, useEffect, useRef } from 'react';
import { API_BASE_URL } from '../api/baseUrl';

type StreamPhase = 'thinking' | 'responding';

// Matches backend event shape
interface StreamEvent {
  jobId: number;
  timestamp: number;
  phase: 'map' | 'reduce' | 'strategy' | 'snapshot' | 'status';
  type:
    | 'start'
    | 'token'
    | 'thinking'
    | 'end'
    | 'error'
    | 'status'
    | 'snapshot';
  sessionId?: number;
  summaryId?: number;
  delta?: string;
  // 'thinking' | 'responding' for live phase transitions, or
  // 'completed' | 'failed' | 'canceled' | 'reducing' | ... for terminal/job status.
  status?: string;
  message?: string;
  promptTokens?: number;
  completionTokens?: number;
  duration?: number;
  // For snapshot
  job?: any;
  summaries?: any[];
}

interface PhaseMetrics {
  promptTokens?: number;
  completionTokens?: number;
  duration?: number;
  tokensPerSecond?: number | undefined;
}

const stripEnvelopes = (text: string) =>
  text.replace(/<think>[\s\S]*?(<\/think>|$)/g, '');

const extractThinking = (text: string): string => {
  // Pull out everything inside <think>…</think> (or to end-of-string for
  // unterminated blocks). Mirrors the chat bubble's splitThinkingText.
  const out: string[] = [];
  const re = /<think>([\s\S]*?)(<\/think>|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const inner = m[1]?.trim();
    if (inner) out.push(inner);
  }
  return out.join('\n\n');
};

export function useAnalysisStream(jobId: number | null) {
  const [mapLogs, setMapLogs] = useState<Record<number, string>>({});
  const [reduceLog, setReduceLog] = useState('');
  const [mapThinkingLogs, setMapThinkingLogs] = useState<
    Record<number, string>
  >({});
  const [reduceThinkingLog, setReduceThinkingLog] = useState('');
  const [mapPhase, setMapPhase] = useState<Record<number, StreamPhase>>({});
  const [reducePhase, setReducePhase] = useState<StreamPhase | null>(null);
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
  const [mapMetrics, setMapMetrics] = useState<Record<number, PhaseMetrics>>(
    {}
  );
  const [reduceMetrics, setReduceMetrics] = useState<PhaseMetrics>({
    promptTokens: undefined,
    completionTokens: undefined,
    duration: undefined,
    tokensPerSecond: undefined,
  });

  const mapLogsRef = useRef<Record<number, string>>({});
  const reduceLogRef = useRef('');
  const mapThinkingLogsRef = useRef<Record<number, string>>({});
  const reduceThinkingLogRef = useRef('');
  const mapPhaseStartTimeRef = useRef<Record<number, number>>({});
  const reducePhaseStartTimeRef = useRef<number | null>(null);
  const mapPromptTokensRef = useRef<Record<number, number>>({});
  const reducePromptTokensRef = useRef<number | null>(null);
  // Cumulative per-summary generated-token counter. Updated on every chunk
  // (thinking or content) so the live tokens/s is accurate from the very
  // first thinking token. Mirrors ChatInterface's localTokenCount.
  const mapTokenCountRef = useRef<Record<number, number>>({});
  const reduceTokenCountRef = useRef(0);

  const resetAll = () => {
    setMapLogs({});
    setReduceLog('');
    setMapThinkingLogs({});
    setReduceThinkingLog('');
    setMapPhase({});
    setReducePhase(null);
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
    mapLogsRef.current = {};
    reduceLogRef.current = '';
    mapThinkingLogsRef.current = {};
    reduceThinkingLogRef.current = '';
    mapPhaseStartTimeRef.current = {};
    reducePhaseStartTimeRef.current = null;
    mapPromptTokensRef.current = {};
    reducePromptTokensRef.current = null;
    mapTokenCountRef.current = {};
    reduceTokenCountRef.current = 0;
  };

  const updateMapMetric = (summaryId: number, chunkText: string) => {
    if (!chunkText) return;
    if (mapPhaseStartTimeRef.current[summaryId] === undefined) {
      const now = Date.now();
      mapPhaseStartTimeRef.current[summaryId] = now;
      setMapPhaseStartTime((prev) => ({ ...prev, [summaryId]: now }));
    }
    const startTime = mapPhaseStartTimeRef.current[summaryId]!;
    const promptTokens = mapPromptTokensRef.current[summaryId] ?? 0;
    const estimatedTokens = Math.max(1, Math.floor(chunkText.length / 4));
    const total = (mapTokenCountRef.current[summaryId] ?? 0) + estimatedTokens;
    mapTokenCountRef.current[summaryId] = total;
    const elapsedSeconds = (Date.now() - startTime) / 1000;
    const liveTps = elapsedSeconds > 0 ? total / elapsedSeconds : 0;
    setMapMetrics((prev) => ({
      ...prev,
      [summaryId]: {
        promptTokens,
        completionTokens: total,
        duration: elapsedSeconds * 1000,
        tokensPerSecond: liveTps,
      },
    }));
  };

  const updateReduceMetric = (chunkText: string) => {
    if (!chunkText) return;
    if (reducePhaseStartTimeRef.current === null) {
      const now = Date.now();
      reducePhaseStartTimeRef.current = now;
      setReducePhaseStartTime(now);
    }
    const startTime = reducePhaseStartTimeRef.current!;
    const promptTokens = reducePromptTokensRef.current ?? 0;
    const estimatedTokens = Math.max(1, Math.floor(chunkText.length / 4));
    reduceTokenCountRef.current += estimatedTokens;
    const elapsedSeconds = (Date.now() - startTime) / 1000;
    const liveTps =
      elapsedSeconds > 0 ? reduceTokenCountRef.current / elapsedSeconds : 0;
    setReduceMetrics({
      promptTokens,
      completionTokens: reduceTokenCountRef.current,
      duration: elapsedSeconds * 1000,
      tokensPerSecond: liveTps,
    });
  };

  useEffect(() => {
    if (!jobId) {
      resetAll();
      return;
    }

    resetAll();

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
      if (eventSource.readyState === EventSource.CLOSED) {
        setIsConnected(false);
      }
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as StreamEvent;

        if (data.type === 'snapshot') {
          if (data.summaries) {
            const initialMapLogs: Record<number, string> = {};
            const initialMapThinkingLogs: Record<number, string> = {};
            // Restored summaries are persisted in their final form (think
            // envelope embedded) and are no longer streaming, so they sit in
            // the 'responding' phase and contribute no live metrics.
            data.summaries.forEach((s: any) => {
              if (s.summary_text) {
                initialMapLogs[s.id] = s.summary_text;
                const thinking = extractThinking(s.summary_text);
                if (thinking) {
                  initialMapThinkingLogs[s.id] = thinking;
                }
              }
            });
            setMapLogs(initialMapLogs);
            mapLogsRef.current = initialMapLogs;
            setMapThinkingLogs(initialMapThinkingLogs);
            mapThinkingLogsRef.current = initialMapThinkingLogs;
          }
          if (data.job?.final_result) {
            setReduceLog(data.job.final_result);
            reduceLogRef.current = data.job.final_result;
            const thinking = extractThinking(data.job.final_result);
            if (thinking) setReduceThinkingLog(thinking);
          }
        } else if (data.type === 'start') {
          if (data.phase === 'map' && data.summaryId && data.promptTokens) {
            mapPhaseStartTimeRef.current[data.summaryId!] = Date.now();
            setMapPhaseStartTime((prev) => ({
              ...prev,
              [data.summaryId!]: Date.now(),
            }));
            mapPromptTokensRef.current[data.summaryId!] = data.promptTokens!;
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
            reducePhaseStartTimeRef.current = Date.now();
            setReducePhaseStartTime(Date.now());
            reducePromptTokensRef.current = data.promptTokens;
            setReducePromptTokens(data.promptTokens);
            setReduceMetrics({
              promptTokens: data.promptTokens!,
              completionTokens: undefined,
              duration: undefined,
              tokensPerSecond: undefined,
            });
          }
        } else if (data.type === 'status') {
          if (data.status === 'thinking' || data.status === 'responding') {
            const nextPhase: StreamPhase = data.status;
            if (data.phase === 'map' && data.summaryId) {
              setMapPhase((prev) => ({
                ...prev,
                [data.summaryId!]: nextPhase,
              }));
            } else if (data.phase === 'reduce') {
              setReducePhase(nextPhase);
            }
          } else if (
            ['completed', 'failed', 'canceled'].includes(data.status!)
          ) {
            eventSource.close();
            setIsConnected(false);
          }
        } else if (data.type === 'thinking') {
          if (data.phase === 'map' && data.summaryId && data.delta) {
            const newText =
              (mapThinkingLogsRef.current[data.summaryId!] || '') + data.delta;
            mapThinkingLogsRef.current[data.summaryId!] = newText;
            setMapThinkingLogs((prev) => ({
              ...prev,
              [data.summaryId!]: newText,
            }));
            // Defensive: if the worker's status: 'thinking' event was lost
            // (SSE snapshot/subscribe race), re-assert the phase here so
            // the UI can render the ticker.
            setMapPhase((prev) =>
              prev[data.summaryId!] !== undefined
                ? prev
                : { ...prev, [data.summaryId!]: 'thinking' }
            );
            // Speed tick should advance during the thinking phase too, so
            // the UI shows a live tokens/s even before any response tokens.
            updateMapMetric(data.summaryId, data.delta);
          } else if (data.phase === 'reduce' && data.delta) {
            const newText = reduceThinkingLogRef.current + data.delta;
            reduceThinkingLogRef.current = newText;
            setReduceThinkingLog((prev) => prev + data.delta!);
            setReducePhase((prev) => (prev !== null ? prev : 'thinking'));
            updateReduceMetric(data.delta);
          }
        } else if (data.type === 'token') {
          if (data.phase === 'map' && data.summaryId && data.delta) {
            const newText =
              (mapLogsRef.current[data.summaryId!] || '') + data.delta;
            mapLogsRef.current[data.summaryId!] = newText;
            setMapLogs((prev) => ({
              ...prev,
              [data.summaryId!]: newText,
            }));
            // Defensive: first response token implies we left thinking.
            setMapPhase((prev) =>
              prev[data.summaryId!] !== undefined
                ? prev
                : { ...prev, [data.summaryId!]: 'responding' }
            );
            updateMapMetric(data.summaryId, data.delta);
          } else if (data.phase === 'reduce' && data.delta) {
            const newText = reduceLogRef.current + data.delta;
            reduceLogRef.current = newText;
            setReduceLog((prev) => prev + data.delta!);
            setReducePhase((prev) => (prev !== null ? prev : 'responding'));
            updateReduceMetric(data.delta);
          }
        } else if (data.type === 'end') {
          if (data.phase === 'map' && data.summaryId) {
            const tps =
              data.completionTokens && data.duration && data.duration > 10
                ? (data.completionTokens * 1000) / data.duration
                : undefined;
            const newMetrics: PhaseMetrics = {
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
            const newMetrics: PhaseMetrics = {
              promptTokens: data.promptTokens,
              completionTokens: data.completionTokens,
              duration: data.duration,
              tokensPerSecond: tps,
            };
            setReduceMetrics(newMetrics);
          }
        } else {
          // Unhandled event type
        }
      } catch (e) {
        console.error('[Stream] Error parsing message:', e);
      }
    };

    return () => {
      console.log(`[Stream] Closing connection for job ${jobId}`);
      eventSource.close();
      setIsConnected(false);
      mapLogsRef.current = {};
      reduceLogRef.current = '';
      mapThinkingLogsRef.current = {};
      reduceThinkingLogRef.current = '';
      mapPhaseStartTimeRef.current = {};
      reducePhaseStartTimeRef.current = null;
      mapPromptTokensRef.current = {};
      reducePromptTokensRef.current = null;
      mapTokenCountRef.current = {};
      reduceTokenCountRef.current = 0;
    };
  }, [jobId]);

  return {
    mapLogs,
    reduceLog,
    mapThinkingLogs,
    reduceThinkingLog,
    mapPhase,
    reducePhase,
    mapMetrics,
    reduceMetrics,
    isConnected,
    streamError,
  };
}

// Helper to strip think envelopes from a persisted/final text blob.
export function stripThinkEnvelopes(text: string): string {
  return stripEnvelopes(text).trim();
}
