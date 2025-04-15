import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Session, SessionMetadata } from '../../../types';
import { TranscriptParagraph } from '../../Transcription/TranscriptParagraph';
import { Box, ScrollArea, Text, Flex, Button, Badge, Spinner } from '@radix-ui/themes'; // Import Spinner
import {
    Pencil1Icon,
    BookmarkIcon,
    CalendarIcon,
    PersonIcon,
    BadgeIcon as SessionTypeIcon,
} from '@radix-ui/react-icons';
import { cn } from '../../../utils';
import { updateTranscriptParagraph } from '../../../api/api';
import { sessionColorMap, therapyColorMap } from '../../../constants'; // Import color maps
import { debounce } from '../../../helpers'; // Import debounce

// Define category type locally or import if defined centrally
type BadgeCategory = 'session' | 'therapy';

// Moved outside component as it doesn't depend on props/state
const getBadgeColor = (type: string | undefined, category: BadgeCategory): React.ComponentProps<typeof Badge>['color'] => {
    const map = category === 'session' ? sessionColorMap : therapyColorMap;
    return type ? (map[type.toLowerCase()] || map['default']) : map['default'];
};

// Moved outside component as it doesn't depend on props/state
const renderHeaderDetail = (
    IconComponent: React.ElementType,
    value: string | undefined,
    label: string,
    category?: BadgeCategory
) => {
    if (!value) return null;
    const isBadge = category === 'session' || category === 'therapy';
    const badgeColor = isBadge ? getBadgeColor(value, category) : undefined;
    return (
        <Flex align="center" gap="1" title={label}>
            <IconComponent className={cn("flex-shrink-0", isBadge ? "opacity-80" : "text-[--gray-a10]")} width="14" height="14" />
            {isBadge && badgeColor ? (
                <Badge color={badgeColor} variant="soft" radius="full" size="1">{value}</Badge>
            ) : (
                <Text size="1" color="gray">{value}</Text>
            )}
        </Flex>
    );
};


interface TranscriptionProps {
    session: SessionMetadata & { id: number }; // Need ID and metadata fields
    transcriptContent: string | undefined; // Receive transcript content directly
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

    // Mutation for saving a paragraph
    const saveParagraphMutation = useMutation({
        mutationFn: ({ index, newText }: { index: number; newText: string }) => {
            // Backend expects paragraphIndex, not array index if different
            // Assuming API uses 0-based index corresponding to split paragraphs
            return updateTranscriptParagraph(session.id, index, newText);
        },
        onSuccess: (updatedFullTranscript, variables) => {
            // Update the transcript query cache directly
            queryClient.setQueryData(['transcript', session.id], updatedFullTranscript);
            setActiveEditIndex(null); // Close editor on success
        },
        onError: (error, variables) => {
            console.error(`Error saving paragraph ${variables.index}:`, error);
            // TODO: Optionally show an error message near the paragraph or via toast
        }
    });

    const debouncedScrollSave = useCallback(
        debounce((scrollTop: number) => {
            if (onScrollUpdate) {
                onScrollUpdate(scrollTop);
            }
        }, 150),
    [onScrollUpdate]);

    const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
        if (!restoreScrollRef.current && event.currentTarget) {
            debouncedScrollSave(event.currentTarget.scrollTop);
        }
        if (restoreScrollRef.current) {
             restoreScrollRef.current = false;
        }
    };

    useEffect(() => {
        if (isTabActive) {
            restoreScrollRef.current = true;
        } else {
            restoreScrollRef.current = false;
        }
    }, [isTabActive]);

    useEffect(() => {
        if (restoreScrollRef.current && viewportRef.current) {
            requestAnimationFrame(() => {
                 if (restoreScrollRef.current && viewportRef.current) {
                    if (viewportRef.current.scrollTop !== initialScrollTop) {
                        viewportRef.current.scrollTop = initialScrollTop;
                    } else {
                        restoreScrollRef.current = false;
                    }
                }
            });
        }
    }, [isTabActive, initialScrollTop]);

    if (!session) {
        // This case might not be reachable if SessionView handles loading/error first
        return <Box p="4"><Text color="gray" style={{ fontStyle: 'italic' }}>Session data not available.</Text></Box>;
    }

    const sourceContent = transcriptContent ?? ''; // Use empty string if undefined

    // TODO: Backend should ideally return pre-split paragraphs or structured text.
    // This split might not match backend expectations for paragraphIndex in PATCH.
    const paragraphs = sourceContent
        .replace(/\r\n/g, '\n') // Normalize line breaks
        .split(/\n\s*\n/) // Split on blank lines
        .filter(p => p.trim() !== ''); // Remove empty paragraphs resulting from split

    // Handler passed to TranscriptParagraph component
    const handleSaveParagraphInternal = async (index: number, newText: string) => {
        // Index here corresponds to the index in the `paragraphs` array derived above.
        // Ensure this matches the `paragraphIndex` expected by the API.
        saveParagraphMutation.mutate({ index, newText });
    };


    return (
        <Flex direction="column" style={{ height: '100%', minHeight: 0, border: '1px solid var(--gray-a6)', borderRadius: 'var(--radius-3)' }}>
             <Flex
                align="baseline"
                justify="between"
                px="3" py="2"
                style={{ borderBottom: '1px solid var(--gray-a6)', flexShrink: 0 }}
                gap="3"
                wrap="wrap"
            >
                {/* Display metadata from session prop */}
                <Flex align="center" gap="3" wrap="wrap" style={{ minWidth: 0, flexGrow: 1 }}>
                    {renderHeaderDetail(PersonIcon, session.clientName, "Client")}
                    {renderHeaderDetail(CalendarIcon, session.date, "Date")}
                    {renderHeaderDetail(SessionTypeIcon, session.sessionType, "Session Type", 'session')}
                    {renderHeaderDetail(BookmarkIcon, session.therapy, "Therapy Type", 'therapy')}
                </Flex>
                <Box flexShrink="0">
                    <Button variant="ghost" size="1" onClick={onEditDetailsClick} aria-label="Edit session details">
                        <Pencil1Icon width="14" height="14" />
                        <Text ml="1">Edit Details</Text>
                    </Button>
                </Box>
            </Flex>

            <ScrollArea
                type="auto"
                scrollbars="vertical"
                ref={viewportRef}
                onScroll={handleScroll}
                style={{ flexGrow: 1, minHeight: 0 }}
            >
                {isLoadingTranscript && (
                    <Flex align="center" justify="center" style={{minHeight: '100px'}}>
                        <Spinner size="2" />
                        <Text ml="2" color="gray">Loading transcript...</Text>
                    </Flex>
                )}
                {transcriptError && !isLoadingTranscript && ( // Show error only if not loading
                     <Flex align="center" justify="center" style={{minHeight: '100px'}}>
                         <Text color="red">Error loading transcript: {transcriptError.message}</Text>
                     </Flex>
                )}
                <Box p="3" className="space-y-3">
                     {!isLoadingTranscript && !transcriptError && paragraphs.length > 0 && paragraphs.map((paragraph, index) => (
                        <TranscriptParagraph
                            key={`${session.id}-p-${index}`}
                            paragraph={paragraph}
                            index={index}
                            onSave={handleSaveParagraphInternal} // Pass the internal handler
                            activeEditIndex={activeEditIndex}
                            setActiveEditIndex={setActiveEditIndex}
                            isSaving={saveParagraphMutation.isPending && saveParagraphMutation.variables?.index === index}
                        />
                    ))}
                     {/* Show message only if not loading, no error, and paragraphs array is empty */}
                     {!isLoadingTranscript && !transcriptError && paragraphs.length === 0 && transcriptContent !== undefined && (
                        <Flex align="center" justify="center" style={{minHeight: '100px'}}>
                            <Text color="gray" style={{ fontStyle: 'italic' }}>
                                {transcriptContent === '' ? 'Transcription is empty.' : 'No transcription content found.'}
                            </Text>
                        </Flex>
                    )}
                </Box>
            </ScrollArea>
        </Flex>
    );
}
