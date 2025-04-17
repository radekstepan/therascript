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
    LightningBoltIcon, // <--- Use LightningBoltIcon
} from '@radix-ui/react-icons';
import { cn } from '../../../utils';
import { updateTranscriptParagraph } from '../../../api/api';
import { sessionColorMap, therapyColorMap } from '../../../constants';
import { debounce, formatIsoDateToYMD } from '../../../helpers';

type BadgeCategory = 'session' | 'therapy';

const getBadgeColor = (type: string | undefined, category: BadgeCategory): React.ComponentProps<typeof Badge>['color'] => {
    const map = category === 'session' ? sessionColorMap : therapyColorMap;
    return type ? (map[type.toLowerCase()] || map['default']) : map['default'];
};

const renderHeaderDetail = (
    IconComponent: React.ElementType,
    value: string | undefined | number, // Allow number for tokens
    label: string,
    category?: BadgeCategory,
    isDateValue?: boolean,
    isTokenValue?: boolean // Flag for token display
) => {
    // Format the date if needed, otherwise use original value
    let displayValue: string | number | undefined = isDateValue ? formatIsoDateToYMD(value as string | undefined) : value;
    // Format tokens with comma separator
    if (isTokenValue && typeof value === 'number') {
        displayValue = value.toLocaleString();
    }


    // Don't render if displayValue is empty/null/undefined after formatting
    if (displayValue === undefined || displayValue === null || displayValue === '') return null;

    const isBadge = category === 'session' || category === 'therapy';
    // Use original value for badge lookup if it's a badge category
    const badgeColor = isBadge && typeof value === 'string' ? getBadgeColor(value, category) : undefined;

    return (
        <Tooltip content={label}>
            <Flex align="center" gap="1" title={label}>
                <IconComponent className={cn("flex-shrink-0", isBadge || isTokenValue ? "opacity-80" : "text-[--gray-a10]")} width="14" height="14" />
                {isBadge && badgeColor ? (
                    // Use original value for badge text
                    <Badge color={badgeColor} variant="soft" radius="full" size="1">{value}</Badge>
                ) : isTokenValue ? (
                     <Badge color="gray" variant="soft" radius="full" size="1">{displayValue}</Badge>
                ) : (
                    // Use the potentially formatted displayValue for Text
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

// --- Token Estimation Function ---
const estimateTokens = (text: string): number => {
    if (!text) return 0;
    // Simple approximation: ~4 chars per token (adjust ratio if needed)
    return Math.round(text.length / 4);
};
// --- End Token Estimation ---

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

    // --- Calculate Estimated Tokens ---
    const estimatedTokenCount = useMemo(() => {
        if (!transcriptContent || transcriptContent.length === 0) {
            return 0;
        }
        const fullText = transcriptContent.map(p => p.text).join(' ');
        return estimateTokens(fullText);
    }, [transcriptContent]);
    // --- End Calculation ---

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
                    {renderHeaderDetail(CalendarIcon, session.date, "Date", undefined, true)}
                    {renderHeaderDetail(SessionTypeIcon, session.sessionType, "Session Type", 'session')}
                    {renderHeaderDetail(BookmarkIcon, session.therapy, "Therapy Type", 'therapy')}
                    {/* --- Render Estimated Tokens using LightningBoltIcon --- */}
                    {estimatedTokenCount > 0 && renderHeaderDetail(
                        LightningBoltIcon, // <-- Use LightningBoltIcon
                        estimatedTokenCount,
                        `Estimated Transcript Tokens (~${estimatedTokenCount.toLocaleString()})`,
                        undefined, // Not a badge category
                        false, // Not a date
                        true // Indicate this is the token value
                    )}
                    {/* --- End Render Tokens --- */}
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
                {/* Loading/Error states (no changes) */}
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
                        />
                    ))}
                     {!isLoadingTranscript && !transcriptError && transcriptContent && paragraphs.length === 0 && ( /* ... empty state ... */
                        <Flex align="center" justify="center" style={{minHeight: '100px'}}>
                            <Text color="gray" style={{ fontStyle: 'italic' }}>
                                {session.status === 'completed' ? 'Transcription is empty.' : 'Transcription not available yet.'}
                            </Text>
                        </Flex>
                    )}
                     {!isLoadingTranscript && !transcriptError && transcriptContent === undefined && ( /* ... unavailable state ... */
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
