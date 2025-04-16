import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Session, StructuredTranscript, TranscriptParagraphData } from '../../../types';
import { TranscriptParagraph } from '../../Transcription/TranscriptParagraph';
import { Box, ScrollArea, Text, Flex, Button, Badge, Spinner } from '@radix-ui/themes';
import {
    Pencil1Icon,
    BookmarkIcon,
    CalendarIcon,
    PersonIcon,
    BadgeIcon as SessionTypeIcon,
} from '@radix-ui/react-icons';
import { cn } from '../../../utils';
import { updateTranscriptParagraph } from '../../../api/api';
import { sessionColorMap, therapyColorMap } from '../../../constants';
// Import the date formatter
import { debounce, formatIsoDateToYMD } from '../../../helpers';

type BadgeCategory = 'session' | 'therapy';

const getBadgeColor = (type: string | undefined, category: BadgeCategory): React.ComponentProps<typeof Badge>['color'] => {
    const map = category === 'session' ? sessionColorMap : therapyColorMap;
    return type ? (map[type.toLowerCase()] || map['default']) : map['default'];
};

const renderHeaderDetail = (
    IconComponent: React.ElementType,
    value: string | undefined,
    label: string,
    category?: BadgeCategory,
    // Add optional flag to indicate if value needs date formatting
    isDateValue?: boolean
) => {
    // Format the date if needed, otherwise use original value
    const displayValue = isDateValue ? formatIsoDateToYMD(value) : value;

    // Don't render if displayValue is empty after formatting
    if (!displayValue) return null;

    const isBadge = category === 'session' || category === 'therapy';
    // Use original value for badge lookup if it's a badge category
    const badgeColor = isBadge ? getBadgeColor(value, category) : undefined;

    return (
        <Flex align="center" gap="1" title={label}>
            <IconComponent className={cn("flex-shrink-0", isBadge ? "opacity-80" : "text-[--gray-a10]")} width="14" height="14" />
            {isBadge && badgeColor ? (
                // Use original value for badge text
                <Badge color={badgeColor} variant="soft" radius="full" size="1">{value}</Badge>
            ) : (
                // Use the potentially formatted displayValue for Text
                <Text size="1" color="gray">{displayValue}</Text>
            )}
        </Flex>
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
            setActiveEditIndex(null);
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
        return <Box p="4"><Text color="gray" style={{ fontStyle: 'italic' }}>Session data not available.</Text></Box>;
    }

    const paragraphs = transcriptContent || [];

    const handleSaveParagraphInternal = async (index: number, newText: string) => {
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
                    {/* Pass the isDateValue flag */}
                    {renderHeaderDetail(CalendarIcon, session.date, "Date", undefined, true)}
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
                {transcriptError && !isLoadingTranscript && (
                     <Flex align="center" justify="center" style={{minHeight: '100px'}}>
                         <Text color="red">Error loading transcript: {transcriptError.message}</Text>
                     </Flex>
                )}
                <Box p="3" className="space-y-3">
                     {!isLoadingTranscript && !transcriptError && paragraphs.length > 0 && paragraphs.map((paragraph, index) => (
                        <TranscriptParagraph
                            // TODO: Use paragraph.id when it's reliable from backend
                            key={paragraph.id ?? `p-${index}`}
                            paragraph={paragraph}
                            index={index}
                            onSave={handleSaveParagraphInternal}
                            activeEditIndex={activeEditIndex}
                            setActiveEditIndex={setActiveEditIndex}
                            isSaving={saveParagraphMutation.isPending && saveParagraphMutation.variables?.index === index}
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
