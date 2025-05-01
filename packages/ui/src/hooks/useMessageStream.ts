// =========================================
// File: packages/ui/src/hooks/useMessageStream.ts
// NEW FILE - Custom hook for processing SSE streams
// =========================================
import { useState, useCallback, useRef, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ChatSession } from '../types';

interface UseMessageStreamParams {
    chatQueryKey: (string | number | null | undefined)[]; // Query key for the chat data
    onStreamComplete?: (queryKey: any[]) => void; // Optional callback when stream finishes successfully
    onStreamError?: (error: Error) => void; // Optional callback on stream error
}

interface ProcessStreamResult {
    streamingAiMessageId: number | null;
    processStream: (
        stream: ReadableStream<Uint8Array>,
        tempUserMsgId: number,
        receivedUserMsgId: number,
        tempAiMessageId: number
    ) => Promise<void>;
    cancelStream: () => void;
}

export function useMessageStream({
    chatQueryKey,
    onStreamComplete,
    onStreamError,
}: UseMessageStreamParams): ProcessStreamResult {
    const queryClient = useQueryClient();
    const [streamingAiMessageId, setStreamingAiMessageId] = useState<number | null>(null);
    const streamControllerRef = useRef<AbortController | null>(null);
    const isCancelledRef = useRef<boolean>(false);

    // Cleanup effect
    useEffect(() => {
        return () => {
            // Cancel any ongoing stream when the component unmounts
            if (streamControllerRef.current) {
                console.log("[useMessageStream Cleanup] Aborting stream controller on unmount.");
                isCancelledRef.current = true; // Mark as cancelled
                streamControllerRef.current.abort();
                streamControllerRef.current = null;
                setStreamingAiMessageId(null);
            }
        };
    }, []); // Empty dependency array ensures this runs only on mount and unmount

    const cancelStream = useCallback(() => {
        if (streamControllerRef.current) {
            console.log("[useMessageStream] Cancelling stream via abort controller.");
            isCancelledRef.current = true; // Mark as cancelled
            streamControllerRef.current.abort();
            streamControllerRef.current = null;
            // We don't reset streamingAiMessageId here immediately,
            // the processStream finally block should handle it.
        }
    }, []);

    const processStream = useCallback(async (
        stream: ReadableStream<Uint8Array>,
        tempUserMsgId: number,
        receivedUserMsgId: number,
        tempAiMessageId: number
    ) => {
        setStreamingAiMessageId(tempAiMessageId);
        isCancelledRef.current = false; // Reset cancellation flag for new stream
        streamControllerRef.current = new AbortController(); // Create new controller
        const signal = streamControllerRef.current.signal;
        const reader = stream.pipeThrough(new TextDecoderStream(), { signal }).getReader();
        let actualUserMessageId = receivedUserMsgId;
        let streamErrored = false;

        try {
            while (true) {
                if (isCancelledRef.current || signal.aborted) throw new Error("Stream processing aborted by client.");
                const { done, value } = await reader.read();
                if (done) break;
                const lines = value.split('\n');
                for (const line of lines) {
                     if (line.startsWith('data:')) {
                        const dataStr = line.substring(5).trim();
                        try {
                            const data = JSON.parse(dataStr);
                            if (data.userMessageId && actualUserMessageId === -1) { /* Update temp user msg ID if needed */ actualUserMessageId = data.userMessageId; queryClient.setQueryData<ChatSession>(chatQueryKey, (old) => old ? { ...old, messages: (old.messages ?? []).map(m => m.id === tempUserMsgId ? { ...m, id: actualUserMessageId } : m) } : old); }
                            else if (data.chunk) { /* Append AI message chunk */ queryClient.setQueryData<ChatSession>(chatQueryKey, (old) => old ? { ...old, messages: (old.messages ?? []).map(m => m.id === tempAiMessageId ? { ...m, text: m.text + data.chunk } : m) } : old); }
                            else if (data.done) { console.log("Stream received done signal. Tokens:", data); /* Final token data if needed */ }
                            else if (data.error) { console.error("SSE Error:", data.error); throw new Error(`Stream error from backend: ${data.error}`); }
                        } catch (e) { console.error('SSE parse error', e); }
                    }
                }
            }
        } catch (error: any) {
            console.error("Error reading or processing stream:", error);
            streamErrored = true;
            if (onStreamError && !isCancelledRef.current) onStreamError(error instanceof Error ? error : new Error(String(error)));
        } finally {
            reader.releaseLock(); // Ensure reader lock is released
            setStreamingAiMessageId(null); // Clear streaming indicator
            streamControllerRef.current = null; // Clear controller ref
            if (!streamErrored && !isCancelledRef.current) {
                console.log("[useMessageStream Finally] Stream completed without error.");
                if (onStreamComplete) onStreamComplete(chatQueryKey);
            } else if (isCancelledRef.current) {
                console.log("[useMessageStream Finally] Stream processing cancelled.");
            } else {
                console.warn("[useMessageStream Finally] Stream ended with an error.");
            }
        }
    }, [queryClient, chatQueryKey, onStreamComplete, onStreamError]); // Dependencies

    return { streamingAiMessageId, processStream, cancelStream };
}
