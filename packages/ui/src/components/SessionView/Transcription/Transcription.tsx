import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
// Import the new structured transcript types
import type { SessionMetadata, StructuredTranscript, TranscriptParagraphData } from '../../../types';
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
    // Update session prop type if needed, ensure ID is present
    session: SessionMetadata & { id: number; fileName: string; transcriptPath: string };
    // transcriptContent is now StructuredTranscript
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
    transcriptContent, // Now StructuredTranscript | undefined
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
            // Backend expects paragraphIndex (0-based index of the paragraph in the array)
            return updateTranscriptParagraph(session.id, index, newText);
        },
        onSuccess: (updatedStructuredTranscript, variables) => {
            // Update the transcript query cache directly with the full updated array
            queryClient.setQueryData(['transcript', session.id], updatedStructuredTranscript);
            setActiveEditIndex(null); // Close editor on success
        },
        onError: (error, variables) => {
            console.error(`Error saving paragraph ${variables.index}:`, error);
            // TODO: Optionally show an error message near the paragraph or via toast
            // Maybe reset the activeEditIndex or revert the text? For now, just log.
            setActiveEditIndex(null); // Close editor even on error for simplicity
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

    // Use transcriptContent directly (it's already an array or undefined)
    const paragraphs = transcriptContent || []; // Use empty array if undefined

    // Handler passed to TranscriptParagraph component
    const handleSaveParagraphInternal = async (index: number, newText: string) => {
        // Index here corresponds to the index in the `paragraphs` array
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
                     {/* Map over the paragraphs array */}
                     {!isLoadingTranscript && !transcriptError && paragraphs.length > 0 && paragraphs.map((paragraph, index) => (
                        <TranscriptParagraph
                            // Use paragraph.id or index as key. Ensure uniqueness.
                            key={paragraph.id ?? `p-${index}`}
                            // Pass the whole paragraph object
                            paragraph={paragraph}
                            index={index} // Pass index for saving
                            onSave={handleSaveParagraphInternal} // Pass the internal handler
                            activeEditIndex={activeEditIndex}
                            setActiveEditIndex={setActiveEditIndex}
                            isSaving={saveParagraphMutation.isPending && saveParagraphMutation.variables?.index === index}
                        />
                    ))}
                     {/* Show message only if not loading, no error, and paragraphs array is empty */}
                     {/* Check if transcriptContent exists but is empty array */}
                     {!isLoadingTranscript && !transcriptError && transcriptContent && paragraphs.length === 0 && (
                        <Flex align="center" justify="center" style={{minHeight: '100px'}}>
                            <Text color="gray" style={{ fontStyle: 'italic' }}>
                                Transcription is empty.
                            </Text>
                        </Flex>
                    )}
                     {/* Handle case where transcript is explicitly undefined (still loading or failed) */}
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
