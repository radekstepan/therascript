import React, { useState, useRef, useEffect, useCallback } from 'react'; // Removed useMemo
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Session, StructuredTranscript } from '../../../types'; // Removed TranscriptParagraphData
import { TranscriptParagraph } from '../../Transcription/TranscriptParagraph';
import { Box, ScrollArea, Text, Flex, Button, Badge, Spinner, Tooltip } from '@radix-ui/themes';
import {
    Pencil1Icon,
    BookmarkIcon,
    CalendarIcon,
    PersonIcon,
    BadgeIcon as SessionTypeIcon,
    LightningBoltIcon,
    // Removed Play/Pause imports from here, handled in paragraph
    ArchiveIcon // <-- Use ArchiveIcon for token count
} from '@radix-ui/react-icons';
import { cn } from '../../../utils';
import { updateTranscriptParagraph } from '../../../api/api';
import { sessionColorMap, therapyColorMap } from '../../../constants';
import { debounce, formatIsoDateToYMD } from '../../../helpers';
import axios from 'axios'; // Need axios for base URL

// Base URL for audio requests
const API_BASE_URL = axios.defaults.baseURL || 'http://localhost:3001';

type BadgeCategory = 'session' | 'therapy';

const getBadgeColor = (type: string | undefined, category: BadgeCategory): React.ComponentProps<typeof Badge>['color'] => {
    const map = category === 'session' ? sessionColorMap : therapyColorMap;
    return type ? (map[type.toLowerCase()] || map['default']) : map['default'];
};

// --- Modified renderHeaderDetail ---
const renderHeaderDetail = (
    IconComponent: React.ElementType,
    value: string | undefined | number | null, // Allow null for token count initially
    label: string,
    category?: BadgeCategory,
    isDateValue?: boolean,
    isTokenValue?: boolean // <-- New flag for token type
) => {
    // Format based on type
    let displayValue: string | number | undefined | null = value;
    if (isDateValue && typeof value === 'string') {
        displayValue = formatIsoDateToYMD(value);
    } else if (isTokenValue && typeof value === 'number') {
        // Format with thousand separators
        displayValue = value.toLocaleString();
    }

    // Check if value is valid for display (not null, undefined, or empty string)
    if (displayValue === undefined || displayValue === null || displayValue === '') return null;

    const isBadge = category === 'session' || category === 'therapy';
    const badgeColor = isBadge && typeof value === 'string' ? getBadgeColor(value, category) : undefined;

    return (
        <Tooltip content={label}>
            <Flex align="center" gap="1" title={label}>
                {/* Use ArchiveIcon specifically for token count */}
                <IconComponent className={cn("flex-shrink-0", isBadge || isTokenValue ? "opacity-80" : "text-[--gray-a10]")} width="14" height="14" />
                {isBadge && badgeColor ? (
                    <Badge color={badgeColor} variant="soft" radius="full" size="1">{value}</Badge>
                ) : isTokenValue ? (
                     <Badge color="gray" variant="soft" radius="full" size="1">{displayValue}</Badge> // Render as badge
                ) : (
                    <Text size="1" color="gray">{displayValue}</Text>
                )}
            </Flex>
        </Tooltip>
    );
};
// --- End Modification ---


interface TranscriptionProps {
    session: Session;
    transcriptContent: StructuredTranscript | undefined;
    onEditDetailsClick: () => void;
    isTabActive?: boolean;
    initialScrollTop?: number;
    onScrollUpdate?: (scrollTop: number) => void;
    isLoadingTranscript: boolean;
    transcriptError?: Error | null;
}

export function Transcription({
    session,
    transcriptContent,
    onEditDetailsClick,
    isTabActive,
    initialScrollTop = 0,
    onScrollUpdate,
    isLoadingTranscript,
    transcriptError,
}: TranscriptionProps) {
    const [activeEditIndex, setActiveEditIndex] = useState<number | null>(null);
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const restoreScrollRef = useRef(false);
    const queryClient = useQueryClient();
    const audioRef = useRef<HTMLAudioElement>(null); // Ref for the audio element

    // State for audio playback
    const [isPlaying, setIsPlaying] = useState(false);
    const [playingParagraphIndex, setPlayingParagraphIndex] = useState<number | null>(null);
    const [audioError, setAudioError] = useState<string | null>(null);
    const [audioReady, setAudioReady] = useState(false);
    const [isAudioLoading, setIsAudioLoading] = useState(false); // Track initial load

    // Token count now comes directly from the session prop
    const transcriptTokenCount = session?.transcriptTokenCount; // Use optional chaining

    // ... (audio handlers, mutation, scroll handling remain the same) ...
    const handleAudioCanPlay = useCallback(() => {
        console.log("[Audio] Ready to play");
        setAudioReady(true);
        setIsAudioLoading(false); // Loading finished
        setAudioError(null);
    }, []);

    const handleAudioError = useCallback((e: React.SyntheticEvent<HTMLAudioElement>) => {
        const error = (e.target as HTMLAudioElement).error;
        console.error("[Audio] Error:", error);
        let errorMessage = 'Unknown audio error';
        if (error) {
             switch (error.code) {
                 case MediaError.MEDIA_ERR_ABORTED: errorMessage = 'Audio playback aborted.'; break;
                 case MediaError.MEDIA_ERR_NETWORK: errorMessage = 'Network error loading audio.'; break;
                 case MediaError.MEDIA_ERR_DECODE: errorMessage = 'Error decoding audio file.'; break;
                 case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED: errorMessage = 'Audio format not supported.'; break;
                 default: errorMessage = `Audio Error Code: ${error.code}`;
             }
        }
        setAudioError(`Audio Error: ${errorMessage}`);
        setIsPlaying(false);
        setPlayingParagraphIndex(null);
        setAudioReady(false);
        setIsAudioLoading(false);
    }, []);

    const handleAudioEnded = useCallback(() => {
        console.log("[Audio] Playback ended");
        setIsPlaying(false);
        setPlayingParagraphIndex(null);
    }, []);

    const handleAudioPause = useCallback(() => {
        console.log("[Audio] Playback paused");
        // Only set isPlaying to false if the pause wasn't triggered by seeking
        // This requires tracking if a seek is in progress, maybe too complex.
        // Simpler: Let onPlay handle setting isPlaying back to true.
        if (audioRef.current && !audioRef.current.seeking) {
             setIsPlaying(false);
        }
        // Keep playingParagraphIndex to potentially resume
    }, []);

    const handleAudioPlay = useCallback(() => {
        console.log("[Audio] Playback started/resumed");
        setIsPlaying(true);
        setAudioError(null); // Clear error on successful play
        setIsAudioLoading(false); // No longer loading once playing starts
    }, []);

    const handleAudioWaiting = useCallback(() => {
        console.log("[Audio] Waiting for data (buffering)...");
        setIsAudioLoading(true); // Show loading indicator while buffering
    }, []);

    const handleAudioPlaying = useCallback(() => {
        console.log("[Audio] Buffering complete, playback continuing.");
        setIsAudioLoading(false); // Buffering finished
    }, []);


    // --- Audio Time Update Handler ---
    const handleAudioTimeUpdate = useCallback(() => {
        if (!audioRef.current || !transcriptContent || audioRef.current.seeking) return; // Ignore updates while seeking
        const currentTimeMs = audioRef.current.currentTime * 1000;

        // Find the paragraph that *contains* the current time
        let currentParagraphIdx = -1;
        for (let i = 0; i < transcriptContent.length; i++) {
            const p = transcriptContent[i];
            // Find the start time of the *next* paragraph to define the end boundary
            const nextP = transcriptContent[i + 1];
            const pStartTime = p.timestamp;
            // Use next paragraph's start time or infinity if it's the last one
            const pEndTime = nextP ? nextP.timestamp : Infinity;

            // Check if current time falls within this paragraph's range
            if (currentTimeMs >= pStartTime && currentTimeMs < pEndTime) {
                currentParagraphIdx = i;
                break;
            }
        }

        // Update playing index only if it changes AND we are actually playing
        if (isPlaying && currentParagraphIdx !== -1 && currentParagraphIdx !== playingParagraphIndex) {
            setPlayingParagraphIndex(currentParagraphIdx);
        }
    }, [transcriptContent, playingParagraphIndex, isPlaying]); // Add isPlaying dependency


    const audioSrc = session?.audioPath ? `${API_BASE_URL}/api/sessions/${session.id}/audio` : null;

    // --- Playback Control Functions ---
    const playAudioFromTimestamp = useCallback((timestampMs: number, index: number) => {
        if (!audioRef.current || !audioSrc) {
            setAudioError("Audio element or source not available.");
            return;
        }
        // Ensure audio src is set if not already
        if (audioRef.current.currentSrc !== audioSrc) {
             console.log(`[Audio] Setting src to ${audioSrc}`);
             audioRef.current.src = audioSrc;
             audioRef.current.load(); // Explicitly load the new source
             setIsAudioLoading(true); // Expect loading state
        }

        const seekTimeSeconds = timestampMs / 1000;
        console.log(`[Audio] Attempting to play paragraph ${index} from ${seekTimeSeconds.toFixed(2)}s`);

        const playAction = () => {
             const playPromise = audioRef.current!.play();
             if (playPromise !== undefined) {
                 playPromise.then(() => {
                     // Set playing index immediately for UI feedback
                     setPlayingParagraphIndex(index);
                 }).catch(err => {
                     console.error("[Audio] Playback error:", err);
                     setAudioError(`Playback error: ${err.message}. Browser might require user interaction first.`);
                     setIsPlaying(false);
                     setPlayingParagraphIndex(null);
                     setIsAudioLoading(false);
                 });
             }
         };

        // If paused at the same paragraph, just resume
        if (!isPlaying && playingParagraphIndex === index) {
            console.log("[Audio] Resuming playback");
             playAction();
        } else {
            // Seek and play
            // Need to handle readyState. If not ready, wait for 'canplay' or 'canplaythrough'
            if (audioRef.current.readyState >= (HTMLMediaElement.HAVE_FUTURE_DATA || 3)) {
                 // Only seek if the time difference is significant to avoid jitter
                 if (Math.abs(audioRef.current.currentTime - seekTimeSeconds) > 0.2) {
                     console.log(`[Audio] Seeking to ${seekTimeSeconds.toFixed(2)}s`);
                     // Set seek time, play will happen after seek completes (handle in onseeked event)
                     audioRef.current.currentTime = seekTimeSeconds;
                     // Set target index immediately for UI feedback
                     setPlayingParagraphIndex(index);
                     // Play might be triggered by onseeked, or call playAction() directly if seek is fast
                     // For simplicity, let's try playing directly after setting currentTime
                     playAction();
                 } else {
                     console.log(`[Audio] Current time close enough (${audioRef.current.currentTime.toFixed(2)}s), not seeking.`);
                     playAction();
                 }
            } else {
                 console.log(`[Audio] Audio not ready (state ${audioRef.current.readyState}), seeking to ${seekTimeSeconds.toFixed(2)}s and waiting for canplay.`);
                 // Set the time, the 'canplay' event or subsequent interaction should trigger play
                 audioRef.current.currentTime = seekTimeSeconds;
                 setPlayingParagraphIndex(index); // Set index for UI highlight
                 setIsAudioLoading(true); // Show loading
                 // Don't call play() yet, let 'canplay' handle it if src was just set, or rely on subsequent toggle if already loaded
                 // If audio was already loaded but paused, we might need to call play() after a delay or on canplay event.
            }
        }
    }, [audioSrc, isPlaying, playingParagraphIndex]);

    const pauseAudio = useCallback(() => {
        if (audioRef.current) {
            audioRef.current.pause();
            // State update handled by 'onPause' event
        }
    }, []);

    const togglePlayback = useCallback((timestampMs: number, index: number) => {
        if (playingParagraphIndex === index && isPlaying) {
            pauseAudio();
        } else {
            playAudioFromTimestamp(timestampMs, index);
        }
    }, [isPlaying, playingParagraphIndex, pauseAudio, playAudioFromTimestamp]);


    // Mutation for saving (no changes needed here, but note onSuccess invalidates sessionMeta)
    const saveParagraphMutation = useMutation({
        mutationFn: ({ index, newText }: { index: number; newText: string }) => {
            return updateTranscriptParagraph(session.id, index, newText);
        },
        onSuccess: (updatedStructuredTranscript, variables) => {
            queryClient.setQueryData(['transcript', session.id], updatedStructuredTranscript);
            queryClient.invalidateQueries({ queryKey: ['sessionMeta', session.id] });
            console.log(`[Transcription Save Success] Paragraph ${variables.index} saved. Invalidated sessionMeta query.`);
            setActiveEditIndex(null);
        },
        onError: (error, variables) => {
            console.error(`Error saving paragraph ${variables.index}:`, error);
            // TODO: Add user feedback (Toast?)
            setActiveEditIndex(null); // Close edit mode even on error for now
        }
    });

    // Scroll handling (no changes)
    const debouncedScrollSave = useCallback( debounce((scrollTop: number) => { if (onScrollUpdate) { onScrollUpdate(scrollTop); } }, 150), [onScrollUpdate] );
    const handleScroll = (event: React.UIEvent<HTMLDivElement>) => { if (!restoreScrollRef.current && event.currentTarget) { debouncedScrollSave(event.currentTarget.scrollTop); } if (restoreScrollRef.current) { restoreScrollRef.current = false; } };
    useEffect(() => { if (isTabActive) { restoreScrollRef.current = true; } else { restoreScrollRef.current = false; } }, [isTabActive]);
    useEffect(() => { if (restoreScrollRef.current && viewportRef.current) { requestAnimationFrame(() => { if (restoreScrollRef.current && viewportRef.current) { if (viewportRef.current.scrollTop !== initialScrollTop) { viewportRef.current.scrollTop = initialScrollTop; } else { restoreScrollRef.current = false; } } }); } }, [isTabActive, initialScrollTop]);


    // --- Effect to load audio source when component mounts or session/audioPath changes ---
    useEffect(() => {
        if (audioRef.current && audioSrc && audioRef.current.currentSrc !== audioSrc) {
            console.log("[Audio Effect] Setting audio source URL:", audioSrc);
            audioRef.current.src = audioSrc;
            audioRef.current.load(); // Trigger loading metadata
            setIsAudioLoading(true); // Indicate loading started
            setAudioReady(false); // Not ready until 'canplay' fires
        } else if (!audioSrc) {
            // Clear state if audio becomes unavailable
             setAudioReady(false);
             setIsPlaying(false);
             setPlayingParagraphIndex(null);
             setAudioError(null);
             setIsAudioLoading(false);
        }
    }, [audioSrc]); // Depend only on audioSrc

    if (!session) {
        return <Box p="4"><Text color="gray" style={{ fontStyle: 'italic' }}>Session data not available.</Text></Box>;
    }

    const paragraphs = transcriptContent || [];

    const handleSaveParagraphInternal = async (index: number, newText: string) => {
        // Pause playback if saving the currently playing paragraph
        if (isPlaying && playingParagraphIndex === index) {
            pauseAudio();
        }
        saveParagraphMutation.mutate({ index, newText });
    };

    return (
        <Flex direction="column" style={{ height: '100%', minHeight: 0, border: '1px solid var(--gray-a6)', borderRadius: 'var(--radius-3)' }}>
             {/* --- Audio Element (Hidden) --- */}
             {/* Render audio tag only if audioSrc exists */}
             {audioSrc && (
                <audio
                    ref={audioRef}
                    // src={audioSrc} // Set in useEffect
                    preload="metadata" // Load metadata (duration etc.) but not full audio
                    onCanPlay={handleAudioCanPlay}
                    onError={handleAudioError}
                    onEnded={handleAudioEnded}
                    onPause={handleAudioPause}
                    onPlay={handleAudioPlay}
                    onTimeUpdate={handleAudioTimeUpdate} // Add time update handler
                    onWaiting={handleAudioWaiting} // Handle buffering
                    onPlaying={handleAudioPlaying} // Handle end of buffering
                    controls={false} // Hide default controls
                    style={{ display: 'none' }}
                 />
             )}
            {/* --- End Audio Element --- */}

             <Flex align="baseline" justify="between" px="3" py="2" style={{ borderBottom: '1px solid var(--gray-a6)', flexShrink: 0 }} gap="3" wrap="wrap" >
                {/* --- Update Metadata Header to include token count --- */}
                <Flex align="center" gap="3" wrap="wrap" style={{ minWidth: 0, flexGrow: 1 }}>
                    {renderHeaderDetail(PersonIcon, session.clientName, "Client")}
                    {renderHeaderDetail(CalendarIcon, session.date, "Date", undefined, true)}
                    {renderHeaderDetail(SessionTypeIcon, session.sessionType, "Session Type", 'session')}
                    {renderHeaderDetail(BookmarkIcon, session.therapy, "Therapy Type", 'therapy')}
                    {/* Display Token Count */}
                    {(typeof transcriptTokenCount === 'number') && renderHeaderDetail(
                        ArchiveIcon, // Use ArchiveIcon for tokens
                        transcriptTokenCount,
                        `Transcript Tokens`,
                        undefined,
                        false,
                        true // Flag as token value
                    )}
                </Flex>
                 {/* --- End Update --- */}
                <Box flexShrink="0">
                    <Button variant="ghost" size="1" onClick={onEditDetailsClick} aria-label="Edit session details">
                        <Pencil1Icon width="14" height="14" />
                        <Text ml="1">Edit Details</Text>
                    </Button>
                </Box>
            </Flex>

            {/* Display Audio Status/Error */}
            <Box px="3" py="1" style={{
                backgroundColor: audioError ? 'var(--red-a3)' : (isAudioLoading ? 'var(--amber-a3)' : 'transparent'),
                borderBottom: audioError || isAudioLoading ? `1px solid ${audioError ? 'var(--red-a6)' : 'var(--amber-a6)'}` : 'none',
                display: audioError || isAudioLoading ? 'block' : 'none', // Only show if error or loading
                transition: 'background-color 0.3s ease',
            }}>
                <Flex align="center" gap="2">
                    {isAudioLoading && <Spinner size="1" />}
                    <Text size="1" color={audioError ? "red" : (isAudioLoading ? "amber" : "gray")}>
                        {audioError || (isAudioLoading ? 'Loading audio...' : '')}
                    </Text>
                </Flex>
            </Box>

            <ScrollArea type="auto" scrollbars="vertical" ref={viewportRef} onScroll={handleScroll} style={{ flexGrow: 1, minHeight: 0 }} >
                {isLoadingTranscript && ( <Flex align="center" justify="center" style={{minHeight: '100px'}}><Spinner size="2" /><Text ml="2" color="gray">Loading transcript...</Text></Flex> )}
                {transcriptError && !isLoadingTranscript && ( <Flex align="center" justify="center" style={{minHeight: '100px'}}><Text color="red">Error loading transcript: {transcriptError.message}</Text></Flex> )}

                <Box p="3" className="space-y-3">
                     {!isLoadingTranscript && !transcriptError && paragraphs.length > 0 && paragraphs.map((paragraph, index) => (
                        <TranscriptParagraph
                            key={paragraph.id ?? `p-${index}`}
                            paragraph={paragraph}
                            index={index}
                            onSave={handleSaveParagraphInternal}
                            activeEditIndex={activeEditIndex}
                            setActiveEditIndex={setActiveEditIndex}
                            isSaving={saveParagraphMutation.isPending && saveParagraphMutation.variables?.index === index}
                            // --- Pass playback state and handler down ---
                            onPlayToggle={togglePlayback} // Pass the combined play/pause handler
                            isPlaying={isPlaying && playingParagraphIndex === index} // Is this specific paragraph playing?
                            // --- End playback props ---
                        />
                    ))}
                     {!isLoadingTranscript && !transcriptError && transcriptContent && paragraphs.length === 0 && (
                        <Flex align="center" justify="center" style={{minHeight: '100px'}}>
                            <Text color="gray" style={{ fontStyle: 'italic' }}>
                                {session.status === 'completed' ? 'Transcription is empty.' : 'Transcription not available yet.'}
                            </Text>
                        </Flex>
                    )}
                     {!isLoadingTranscript && !transcriptError && transcriptContent === undefined && (
                          <Flex align="center" justify="center" style={{minHeight: '100px'}}>
                             <Text color="gray" style={{ fontStyle: 'italic' }}>
                                 No transcription content available.
                             </Text>
                          </Flex>
                     )}
                </Box>
            </ScrollArea>
        </Flex>
    );
}
