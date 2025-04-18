// packages/ui/src/components/SessionView/Transcription/Transcription.tsx
/* packages/ui/src/components/SessionView/Transcription/Transcription.tsx */
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Session, StructuredTranscript, TranscriptParagraphData } from '../../../types';
import { TranscriptParagraph } from '../../Transcription/TranscriptParagraph';
import { Box, ScrollArea, Text, Flex, Button, Badge, Spinner, Tooltip } from '@radix-ui/themes';
import {
    Pencil1Icon,
    BookmarkIcon,
    CalendarIcon,
    PersonIcon,
    BadgeIcon as SessionTypeIcon,
    LightningBoltIcon,
    PlayIcon, // For global play/pause
    PauseIcon // For global play/pause
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

const renderHeaderDetail = (
    IconComponent: React.ElementType,
    value: string | undefined | number,
    label: string,
    category?: BadgeCategory,
    isDateValue?: boolean,
    isTokenValue?: boolean
) => {
    let displayValue: string | number | undefined = isDateValue ? formatIsoDateToYMD(value as string | undefined) : value;
    if (isTokenValue && typeof value === 'number') {
        displayValue = value.toLocaleString();
    }
    if (displayValue === undefined || displayValue === null || displayValue === '') return null;
    const isBadge = category === 'session' || category === 'therapy';
    const badgeColor = isBadge && typeof value === 'string' ? getBadgeColor(value, category) : undefined;

    return (
        <Tooltip content={label}>
            <Flex align="center" gap="1" title={label}>
                <IconComponent className={cn("flex-shrink-0", isBadge || isTokenValue ? "opacity-80" : "text-[--gray-a10]")} width="14" height="14" />
                {isBadge && badgeColor ? (
                    <Badge color={badgeColor} variant="soft" radius="full" size="1">{value}</Badge>
                ) : isTokenValue ? (
                     <Badge color="gray" variant="soft" radius="full" size="1">{displayValue}</Badge>
                ) : (
                    <Text size="1" color="gray">{displayValue}</Text>
                )}
            </Flex>
        </Tooltip>
    );
};


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

const estimateTokens = (text: string): number => {
    if (!text) return 0;
    return Math.round(text.length / 4);
};

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

    const estimatedTokenCount = useMemo(() => {
        if (!transcriptContent || transcriptContent.length === 0) { return 0; }
        const fullText = transcriptContent.map(p => p.text).join(' ');
        return estimateTokens(fullText);
    }, [transcriptContent]);

    // --- Audio URL derived from session ---
    const audioSrc = session?.audioPath ? `${API_BASE_URL}/api/sessions/${session.id}/audio` : null;

    // --- Audio Event Handlers ---
    const handleAudioCanPlay = () => {
        console.log("[Audio] Ready to play");
        setAudioReady(true);
        setAudioError(null);
    };

    const handleAudioError = (e: React.SyntheticEvent<HTMLAudioElement>) => {
        const error = (e.target as HTMLAudioElement).error;
        console.error("[Audio] Error:", error);
        setAudioError(`Audio Error: ${error?.message || 'Unknown error'}`);
        setIsPlaying(false);
        setPlayingParagraphIndex(null);
        setAudioReady(false); // Mark as not ready on error
    };

    const handleAudioEnded = () => {
        console.log("[Audio] Playback ended");
        setIsPlaying(false);
        setPlayingParagraphIndex(null);
    };

    const handleAudioPause = () => {
        console.log("[Audio] Playback paused");
        setIsPlaying(false);
        // Keep playingParagraphIndex to potentially resume
    };

    const handleAudioPlay = () => {
        console.log("[Audio] Playback started/resumed");
        setIsPlaying(true);
        setAudioError(null); // Clear error on successful play
    };

    // --- Audio Time Update Handler ---
    const handleAudioTimeUpdate = useCallback(() => {
        if (!audioRef.current || !transcriptContent) return;
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

        // Update playing index only if it changes
        if (currentParagraphIdx !== -1 && currentParagraphIdx !== playingParagraphIndex) {
            setPlayingParagraphIndex(currentParagraphIdx);
        } else if (currentParagraphIdx === -1 && playingParagraphIndex !== null) {
            // If time is outside all known paragraph ranges, clear the highlight
            // setPlayingParagraphIndex(null); // Or keep highlighting the last one? Let's keep it for now.
        }
    }, [transcriptContent, playingParagraphIndex]); // Dependency on transcriptContent and playingParagraphIndex

    // --- Playback Control Functions ---
    const playAudioFromTimestamp = (timestampMs: number, index: number) => {
        if (!audioRef.current || !audioSrc) {
            setAudioError("Audio element or source not available.");
            return;
        }
        // Ensure audio src is set
        if (audioRef.current.currentSrc !== audioSrc) {
             console.log(`[Audio] Setting src to ${audioSrc}`);
             audioRef.current.src = audioSrc;
             // Play will be triggered by 'canplay' event or resume logic
        }

        const seekTimeSeconds = timestampMs / 1000;
        console.log(`[Audio] Attempting to play paragraph ${index} from ${seekTimeSeconds.toFixed(2)}s`);

        // If paused at the same paragraph, just resume
        if (!isPlaying && playingParagraphIndex === index) {
            console.log("[Audio] Resuming playback");
            audioRef.current.play().catch(err => setAudioError(`Resume error: ${err.message}`));
        } else {
            // Seek and play
            try {
                // Only seek if the time difference is significant to avoid jitter
                if (Math.abs(audioRef.current.currentTime - seekTimeSeconds) > 0.2) {
                    console.log(`[Audio] Seeking to ${seekTimeSeconds.toFixed(2)}s`);
                    audioRef.current.currentTime = seekTimeSeconds;
                } else {
                    console.log(`[Audio] Current time close enough (${audioRef.current.currentTime.toFixed(2)}s), not seeking.`);
                }

                // Attempt to play. Browser might block this if not user-initiated.
                const playPromise = audioRef.current.play();
                if (playPromise !== undefined) {
                    playPromise.catch(err => {
                         console.error("[Audio] Playback error:", err);
                         setAudioError(`Playback error: ${err.message}. Browser might require user interaction first.`);
                         setIsPlaying(false);
                         setPlayingParagraphIndex(null);
                    });
                }
                // Set playing index immediately for UI feedback
                setPlayingParagraphIndex(index);

            } catch (err: any) {
                console.error("[Audio] Error during seek/play:", err);
                setAudioError(`Seek/Play Error: ${err.message}`);
                setIsPlaying(false);
                setPlayingParagraphIndex(null);
            }
        }
    };

    const pauseAudio = () => {
        if (audioRef.current) {
            audioRef.current.pause();
            // State update handled by 'onPause' event
        }
    };

    const togglePlayback = (timestampMs: number, index: number) => {
        if (playingParagraphIndex === index && isPlaying) {
            pauseAudio();
        } else {
            playAudioFromTimestamp(timestampMs, index);
        }
    };


    // Mutation for saving (no changes)
    const saveParagraphMutation = useMutation({
        mutationFn: ({ index, newText }: { index: number; newText: string }) => {
            return updateTranscriptParagraph(session.id, index, newText);
        },
        onSuccess: (updatedStructuredTranscript, variables) => {
            queryClient.setQueryData(['transcript', session.id], updatedStructuredTranscript);
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


    if (!session) {
        return <Box p="4"><Text color="gray" style={{ fontStyle: 'italic' }}>Session data not available.</Text></Box>;
    }

    const paragraphs = transcriptContent || [];

    const handleSaveParagraphInternal = async (index: number, newText: string) => {
        saveParagraphMutation.mutate({ index, newText });
    };


    return (
        <Flex direction="column" style={{ height: '100%', minHeight: 0, border: '1px solid var(--gray-a6)', borderRadius: 'var(--radius-3)' }}>
             {/* --- Audio Element (Hidden) --- */}
             {audioSrc && (
                <audio
                    ref={audioRef}
                    // src={audioSrc} // Set dynamically on play? Or preload? Preload seems better.
                    preload="metadata" // Load metadata (duration etc.) but not full audio
                    onCanPlay={handleAudioCanPlay}
                    onError={handleAudioError}
                    onEnded={handleAudioEnded}
                    onPause={handleAudioPause}
                    onPlay={handleAudioPlay}
                    onTimeUpdate={handleAudioTimeUpdate} // Add time update handler
                    controls={false} // Hide default controls
                    style={{ display: 'none' }}
                 />
             )}
            {/* --- End Audio Element --- */}

             <Flex align="baseline" justify="between" px="3" py="2" style={{ borderBottom: '1px solid var(--gray-a6)', flexShrink: 0 }} gap="3" wrap="wrap" >
                {/* Metadata Header */}
                <Flex align="center" gap="3" wrap="wrap" style={{ minWidth: 0, flexGrow: 1 }}>
                    {renderHeaderDetail(PersonIcon, session.clientName, "Client")}
                    {renderHeaderDetail(CalendarIcon, session.date, "Date", undefined, true)}
                    {renderHeaderDetail(SessionTypeIcon, session.sessionType, "Session Type", 'session')}
                    {renderHeaderDetail(BookmarkIcon, session.therapy, "Therapy Type", 'therapy')}
                    {estimatedTokenCount > 0 && renderHeaderDetail( LightningBoltIcon, estimatedTokenCount, `Estimated Transcript Tokens (~${estimatedTokenCount.toLocaleString()})`, undefined, false, true )}
                </Flex>
                <Box flexShrink="0">
                    <Button variant="ghost" size="1" onClick={onEditDetailsClick} aria-label="Edit session details">
                        <Pencil1Icon width="14" height="14" />
                        <Text ml="1">Edit Details</Text>
                    </Button>
                </Box>
            </Flex>

            {/* Display Audio Error if any */}
            {audioError && (
                 <Box px="3" py="1" style={{ backgroundColor: 'var(--red-a3)', borderBottom: '1px solid var(--red-a6)' }}>
                     <Text size="1" color="red">{audioError}</Text>
                 </Box>
             )}

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
