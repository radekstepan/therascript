/*
Modified File: src/components/SessionView/Transcription.tsx
+ Updated props interface for onSaveParagraph
+ Removed internal state management that's now handled in SessionView
+ Calls onSaveParagraph prop via internal handler
*/
import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { Session } from '../../types';
import { TranscriptParagraph } from '../Transcription/TranscriptParagraph';
import { Box, ScrollArea, Text, Flex, Button, Heading, Badge } from '@radix-ui/themes';
import {
    Pencil1Icon,
    BookmarkIcon,
    CalendarIcon,
    PersonIcon,
    BadgeIcon as SessionTypeIcon,
    PlayIcon
} from '@radix-ui/react-icons';
import { cn } from '../../utils';

// --- Helper functions (Unchanged) ---
const sessionColorMap: Record<string, React.ComponentProps<typeof Badge>['color']> = {
    'individual': 'blue', 'phone': 'sky', 'skills group': 'teal',
    'family session': 'green', 'family skills': 'green', 'couples': 'indigo',
    'couples individual': 'plum', 'default': 'gray'
};
const therapyColorMap: Record<string, React.ComponentProps<typeof Badge>['color']> = {
    'act': 'purple', 'dbt': 'amber', 'cbt': 'lime', 'erp': 'ruby',
    'mindfulness': 'cyan', 'couples act': 'violet', 'couples dbt': 'yellow',
    'dbt skills': 'orange', 'default': 'pink'
};
const getBadgeColor = (type: string | undefined, category: 'session' | 'therapy'): React.ComponentProps<typeof Badge>['color'] => {
    const map = category === 'session' ? sessionColorMap : therapyColorMap;
    return type ? (map[type.toLowerCase()] || map['default']) : map['default'];
};
const renderHeaderDetail = (
    IconComponent: React.ElementType,
    value: string | undefined,
    label: string,
    category?: 'session' | 'therapy'
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
// --- End Helper functions ---

// Simple debounce utility
const debounce = <F extends (...args: any[]) => any>(func: F, waitFor: number) => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    return (...args: Parameters<F>): void => {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => func(...args), waitFor);
    };
};

interface TranscriptionProps {
    session: Session | null; // Session now guaranteed to have transcription if not null
    onEditDetailsClick: () => void;
    // Removed editTranscriptContent and onContentChange props
    onSaveParagraph: (index: number, newText: string) => Promise<void>; // Prop to handle saving
    isTabActive?: boolean;
    initialScrollTop?: number;
    onScrollUpdate?: (scrollTop: number) => void;
}

export function Transcription({
    session,
    onEditDetailsClick,
    onSaveParagraph, // Use the specific save handler prop
    isTabActive,
    initialScrollTop = 0,
    onScrollUpdate,
}: TranscriptionProps) {
    // State to track WHICH paragraph is currently being edited
    const [activeEditIndex, setActiveEditIndex] = useState<number | null>(null);
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const restoreScrollRef = useRef(false); // For scroll restoration logic

    // --- Scroll Saving & Restoration Logic (Unchanged) ---
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
    // --- End Scroll Logic ---

    if (!session) {
        // This case should ideally not be hit if SessionView handles loading state correctly
        return <Box p="4"><Text color="gray" style={{ fontStyle: 'italic' }}>Loading session data...</Text></Box>;
    }

    // Get the transcript content directly from the session prop. It should exist.
    const sourceContent = session.transcription || '';

    const paragraphs = sourceContent
        .replace(/\r\n/g, '\n')       // Normalize line breaks
        .split(/\n\s*\n/)             // Split on blank lines
        .filter(p => p.trim() !== ''); // Remove empty paragraphs

    // This internal handler calls the prop passed down from SessionView
    // It also manages closing the edit state locally
    const handleSaveParagraphInternal = async (index: number, newText: string) => {
        try {
            await onSaveParagraph(index, newText); // Call the actual save handler passed from SessionView
            setActiveEditIndex(null); // Close edit mode for this paragraph on success
        } catch (error) {
            console.error(`Error saving paragraph ${index} from Transcription component:`, error);
            // Optionally keep the editor open or show an error specific to the paragraph
            // setActiveEditIndex(null); // Decide whether to close on error
        }
    };

    return (
        <Flex direction="column" style={{ height: '100%', minHeight: 0, border: '1px solid var(--gray-a6)', borderRadius: 'var(--radius-3)' }}>
            {/* Header (Unchanged) */}
             <Flex
                align="baseline" // Changed from center for better alignment with button
                justify="between"
                px="3" py="2"
                style={{ borderBottom: '1px solid var(--gray-a6)', flexShrink: 0 }}
                gap="3"
                wrap="wrap" // Allow wrapping on small screens
            >
                {/* Details */}
                <Flex align="center" gap="3" wrap="wrap" style={{ minWidth: 0, flexGrow: 1 }}>
                    {renderHeaderDetail(PersonIcon, session.clientName, "Client")}
                    {renderHeaderDetail(CalendarIcon, session.date, "Date")}
                    {renderHeaderDetail(SessionTypeIcon, session.sessionType, "Session Type", 'session')}
                    {renderHeaderDetail(BookmarkIcon, session.therapy, "Therapy Type", 'therapy')}
                </Flex>
                 {/* Edit Button */}
                <Box flexShrink="0">
                    <Button variant="ghost" size="1" onClick={onEditDetailsClick} aria-label="Edit session details">
                        <Pencil1Icon width="14" height="14" />
                        <Text ml="1">Edit Details</Text>
                    </Button>
                </Box>
            </Flex>

            {/* Scrollable Content Area */}
            <ScrollArea
                type="auto"
                scrollbars="vertical"
                ref={viewportRef}
                onScroll={handleScroll}
                style={{ flexGrow: 1, minHeight: 0 }}
            >
                <Box p="3" className="space-y-3">
                     {paragraphs.length > 0 ? paragraphs.map((paragraph, index) => (
                        <TranscriptParagraph
                            // Use a combination of session ID and index for a more stable key
                            key={`${session.id}-p-${index}`}
                            paragraph={paragraph}
                            index={index}
                            // Pass the internal handler which calls the prop from SessionView
                            onSave={handleSaveParagraphInternal}
                            activeEditIndex={activeEditIndex}
                            setActiveEditIndex={setActiveEditIndex} // Allow paragraph to control its edit state
                        />
                    )) : (
                        <Flex align="center" justify="center" style={{minHeight: '100px'}}>
                            <Text color="gray" style={{ fontStyle: 'italic' }}>
                                No transcription available for this session.
                            </Text>
                        </Flex>
                    )}
                </Box>
            </ScrollArea>
        </Flex>
    );
}
