// Purpose: Custom React hook to manage the processing of Server-Sent Event (SSE)
//          streams from the backend for chat responses. Handles stream reading,
//          data parsing, optimistic UI updates via Tanstack Query cache, and cancellation.
import { useState, useCallback, useRef, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query'; // To interact with the query cache
import type { ChatSession, ChatMessage } from '../types'; // Import relevant UI types

interface UseMessageStreamParams {
    // The Tanstack Query key used to identify the chat data being updated.
    // Needs session/chat IDs to target the correct cache entry.
    chatQueryKey: (string | number | null | undefined)[];
    // Optional callback function triggered when the stream completes successfully (without errors or cancellation).
    onStreamComplete?: (queryKey: any[]) => void;
    // Optional callback function triggered if an error occurs during stream processing.
    onStreamError?: (error: Error) => void;
}

interface ProcessStreamResult {
    // State: ID of the AI message currently being streamed, or null if none.
    streamingAiMessageId: number | null;
    // Function to start processing a new stream. Takes the stream, temp IDs, and the actual user message ID.
    processStream: (
        stream: ReadableStream<Uint8Array>, // The SSE stream from the fetch response
        tempUserMsgId: number | undefined,  // The temporary ID assigned to the user message optimistically
        receivedUserMsgId: number,          // The actual user message ID received from the backend (in X-User-Message-Id header)
        tempAiMessageId: number             // The temporary ID assigned to the AI message optimistically
    ) => Promise<void>;
    // Function to cancel the currently active stream processing.
    cancelStream: () => void;
}

/**
 * Custom hook for processing Server-Sent Event (SSE) streams for chat messages.
 * Handles reading the stream, parsing JSON data chunks, updating the UI optimistically
 * via Tanstack Query cache manipulation, and managing stream cancellation.
 *
 * @param params - Configuration options including the chat query key and optional callbacks.
 * @returns An object containing the streaming AI message ID, the `processStream` function, and the `cancelStream` function.
 */
export function useMessageStream({
    chatQueryKey,
    onStreamComplete,
    onStreamError,
}: UseMessageStreamParams): ProcessStreamResult {
    const queryClient = useQueryClient(); // Get the query client instance
    // State to track the ID of the AI message currently being streamed
    const [streamingAiMessageId, setStreamingAiMessageId] = useState<number | null>(null);
    // Ref to hold the AbortController for the current stream, allowing cancellation
    const streamControllerRef = useRef<AbortController | null>(null);
    // Ref to track if cancellation was explicitly requested by the `cancelStream` function
    const isCancelledRef = useRef<boolean>(false);

    // Cleanup effect: Abort any ongoing stream when the component unmounts
    useEffect(() => {
        return () => {
            // Check if there's an active stream controller
            if (streamControllerRef.current) {
                console.log("[useMessageStream Cleanup] Aborting stream controller on unmount.");
                isCancelledRef.current = true; // Mark as cancelled to prevent error callbacks
                streamControllerRef.current.abort(); // Signal abortion
                streamControllerRef.current = null; // Clear the ref
                setStreamingAiMessageId(null); // Reset streaming state
            }
        };
    }, []); // Empty dependency array ensures this runs only once on mount and unmount

    /**
     * Cancels the currently active stream processing, if any.
     */
    const cancelStream = useCallback(() => {
        if (streamControllerRef.current) {
            console.log("[useMessageStream] Cancelling stream via abort controller.");
            isCancelledRef.current = true; // Mark as explicitly cancelled
            streamControllerRef.current.abort(); // Trigger the abort signal
            streamControllerRef.current = null; // Clear the ref
            // Note: streamingAiMessageId is reset within the processStream's finally block
        }
    }, []); // No dependencies needed

    /**
     * Processes an incoming SSE stream from the backend chat endpoint.
     * Reads chunks, parses JSON data, updates Tanstack Query cache optimistically,
     * and handles completion, errors, and cancellation.
     *
     * @param stream - The ReadableStream obtained from the fetch response body.
     * @param tempUserMsgId - The temporary ID assigned to the user's message in the optimistic update.
     * @param receivedUserMsgId - The actual ID of the user's message received from the backend header.
     * @param tempAiMessageId - The temporary ID assigned to the AI's message in the optimistic update.
     */
    const processStream = useCallback(async (
        stream: ReadableStream<Uint8Array>,
        tempUserMsgId: number | undefined,
        receivedUserMsgId: number,
        tempAiMessageId: number
    ) => {
        setStreamingAiMessageId(tempAiMessageId); // Set the ID of the message being streamed
        isCancelledRef.current = false; // Reset cancellation flag for this new stream
        streamControllerRef.current = new AbortController(); // Create a new AbortController for this stream
        const signal = streamControllerRef.current.signal; // Get the abort signal
        // Pipe the stream through a TextDecoderStream and get a reader
        const reader = stream.pipeThrough(new TextDecoderStream(), { signal }).getReader();
        let actualUserMessageId = receivedUserMsgId; // Store the actual user message ID
        let streamErrored = false; // Flag to track if an error occurred during processing

        try {
            // Continuously read from the stream
            while (true) {
                // Check for cancellation signal before reading
                if (isCancelledRef.current || signal.aborted) {
                    throw new Error("Stream processing aborted by client.");
                }
                // Read the next chunk from the stream
                const { done, value } = await reader.read();
                if (done) break; // Exit loop if the stream is finished

                // Process the received text chunk (can contain multiple lines/events)
                const lines = value.split('\n');
                for (const line of lines) {
                     // Check if the line contains SSE data
                     if (line.startsWith('data:')) {
                        const dataStr = line.substring(5).trim(); // Extract JSON string
                        try {
                            const data = JSON.parse(dataStr); // Parse the JSON data

                            // --- Handle different event types ---
                            // 1. Update User Message ID: If we received the actual ID and haven't updated the temp one yet
                            if (data.userMessageId && actualUserMessageId === -1 && tempUserMsgId !== undefined) {
                                actualUserMessageId = data.userMessageId;
                                // Update the user message ID in the Tanstack Query cache
                                queryClient.setQueryData<ChatSession>(chatQueryKey, (old) =>
                                    old ? { ...old, messages: (old.messages ?? []).map(m => m.id === tempUserMsgId ? { ...m, id: actualUserMessageId } : m) } : old
                                );
                            }
                            // 2. AI Message Chunk: Append the text chunk to the optimistic AI message
                            else if (data.chunk) {
                                queryClient.setQueryData<ChatSession>(chatQueryKey, (old) =>
                                    old ? { ...old, messages: (old.messages ?? []).map(m => m.id === tempAiMessageId ? { ...m, text: m.text + data.chunk } : m) } : old
                                );
                            }
                            // 3. Done Signal: Stream finished from the backend
                            else if (data.done) {
                                console.log("[useMessageStream] Stream received 'done' signal. Tokens:", data);
                                // Optional: Use data.promptTokens, data.completionTokens if needed
                                // The finally block will handle cleanup and potential invalidation
                            }
                            // 4. Error Signal: Backend reported an error during stream generation
                            else if (data.error) {
                                console.error("[useMessageStream] SSE Error Event Received:", data.error);
                                streamErrored = true; // Mark stream as errored
                                throw new Error(`Stream error from backend: ${data.error}`);
                            }
                            // --- End Event Handling ---
                        } catch (e) {
                            // Handle JSON parsing errors
                            console.error('[useMessageStream] SSE JSON parse error:', e, 'Raw line:', line);
                        }
                    }
                }
            }
        } catch (error: any) {
            // Catch errors from reader.read(), signal abort, or explicit throws
            console.error("[useMessageStream] Error reading or processing stream:", error);
            if (!isCancelledRef.current) { // Only mark as errored if not manually cancelled
                 streamErrored = true;
                 // Call the error callback if provided and not cancelled
                 if (onStreamError) onStreamError(error instanceof Error ? error : new Error(String(error)));
            }
        } finally {
            // --- Cleanup ---
            reader.releaseLock(); // Ensure the reader lock is released
            setStreamingAiMessageId(null); // Clear the streaming indicator state
            streamControllerRef.current = null; // Clear the controller ref

            if (!streamErrored && !isCancelledRef.current) {
                // Stream finished normally (reached `done: true` or loop end without error/cancel)
                console.log("[useMessageStream Finally] Stream completed without error.");
                // Trigger the completion callback if provided
                if (onStreamComplete) onStreamComplete(chatQueryKey);
                // Optionally invalidate the query here to fetch the final message state,
                // though the mutation's onSettled might be a better place.
                // queryClient.invalidateQueries({ queryKey: chatQueryKey });
            } else if (isCancelledRef.current) {
                // Stream was explicitly cancelled
                console.log("[useMessageStream Finally] Stream processing cancelled by user.");
                // Optionally invalidate here if cancellation means fetching final state is desired
                // queryClient.invalidateQueries({ queryKey: chatQueryKey });
            } else {
                // Stream ended with an error
                console.warn("[useMessageStream Finally] Stream ended with an error.");
                // Query invalidation might not be appropriate if the optimistic state is now invalid
            }
            // --- End Cleanup ---
        }
    }, [queryClient, chatQueryKey, onStreamComplete, onStreamError]); // Dependencies

    // Return the state and functions for the component to use
    return { streamingAiMessageId, processStream, cancelStream };
}
