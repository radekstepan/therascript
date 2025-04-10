/*
Modified File: src/components/SessionView/Transcription.tsx
Using @radix-ui/themes ScrollArea
+ Attempting baseline alignment for header items
+ Added state management for activeEditIndex
+ Revised scroll restoration logic for reliability
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

// --- Helper functions (Keep unchanged) ---
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
    session: Session | null;
    onEditDetailsClick: () => void;
    editTranscriptContent: string;
    onContentChange: (value: string) => void;
    isTabActive?: boolean;
    initialScrollTop?: number;
    onScrollUpdate?: (scrollTop: number) => void;
}

export function Transcription({
    session,
    onEditDetailsClick,
    editTranscriptContent,
    onContentChange,
    isTabActive,
    initialScrollTop = 0,
    onScrollUpdate,
}: TranscriptionProps) {
    const [activeEditIndex, setActiveEditIndex] = useState<number | null>(null);
    const viewportRef = useRef<HTMLDivElement | null>(null);
    // Ref to track if a scroll restoration is pending after activation
    const restoreScrollRef = useRef(false);

    // --- Scroll Saving ---
    const debouncedScrollSave = useCallback(
        debounce((scrollTop: number) => {
            // console.log("Transcript Saving scroll:", scrollTop);
            if (onScrollUpdate) {
                onScrollUpdate(scrollTop);
            }
        }, 150), // Debounce time
    [onScrollUpdate]);

    const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
        // Prevent saving scroll position during programmatic restoration
        if (!restoreScrollRef.current && event.currentTarget) {
            debouncedScrollSave(event.currentTarget.scrollTop);
        }
        // Reset the flag after the user manually scrolls *after* a restoration
        // OR if the programmatic scroll event fires (which it should)
        if (restoreScrollRef.current) {
             restoreScrollRef.current = false;
             // console.log("Transcript reset restoreScrollRef on scroll");
        }
    };

    // --- Scroll Restoration ---
    useEffect(() => {
        // When tab becomes active, mark that restoration is needed
        if (isTabActive) {
            restoreScrollRef.current = true;
            // console.log(`Transcript marked for restoration to: ${initialScrollTop}`);
        } else {
            // Ensure flag is false if tab becomes inactive
            restoreScrollRef.current = false;
        }
    }, [isTabActive]); // Only depends on isTabActive changing

    useEffect(() => {
        // If restoration is marked and ref is available, perform the scroll
        if (restoreScrollRef.current && viewportRef.current) {
            requestAnimationFrame(() => {
                 // Double-check the flag hasn't been reset by an intervening scroll event
                 if (restoreScrollRef.current && viewportRef.current) {
                     // Check if the position actually needs changing
                    if (viewportRef.current.scrollTop !== initialScrollTop) {
                        viewportRef.current.scrollTop = initialScrollTop;
                        // console.log(`Transcript RESTORED scroll to: ${initialScrollTop}`);
                        // Programmatic scroll WILL trigger handleScroll, which resets the ref.
                    } else {
                         // If already at the correct position, manually reset the flag
                        restoreScrollRef.current = false;
                        // console.log("Transcript already at target, reset restoreScrollRef");
                    }
                }
            });
        }
        // This effect depends on initialScrollTop as well, in case the saved
        // position changes while the tab is inactive
    }, [isTabActive, initialScrollTop]);


    // --- Other Component Logic ---
    if (!session) {
         return <Box p="4"><Text color="gray" style={{ fontStyle: 'italic' }}>Loading session data...</Text></Box>;
    }
    const sourceContent = editTranscriptContent;
    const paragraphs = sourceContent
        .replace(/\r\n/g, '\n') // Normalize Windows line breaks
        .split(/\n\s*\n/)       // Split on one or more blank lines
        .filter(p => p.trim() !== ''); // Remove empty paragraphs resulting from split

    const handleSaveParagraph = (index: number, newText: string) => {
        const baseContentForSave = editTranscriptContent;
        const currentParagraphsWithBlanks = baseContentForSave
            .replace(/\r\n/g, '\n')
            .split(/(\n\s*\n)/); // Split but keep delimiters

        let paragraphIndexInFullSplit = -1;
        let visibleIndexCounter = -1;

        for (let i = 0; i < currentParagraphsWithBlanks.length; i += 2) { // Step by 2 (content + delimiter)
            const contentPart = currentParagraphsWithBlanks[i];
            if (contentPart.trim() !== '') {
                visibleIndexCounter++;
                if (visibleIndexCounter === index) {
                    paragraphIndexInFullSplit = i;
                    break;
                }
            }
        }

        if (paragraphIndexInFullSplit !== -1) {
            currentParagraphsWithBlanks[paragraphIndexInFullSplit] = newText;
            const newTranscript = currentParagraphsWithBlanks.join('');
            onContentChange(newTranscript);
            setActiveEditIndex(null);
        } else {
            console.warn("Paragraph index mapping failed during save. Index:", index);
            setActiveEditIndex(null);
        }
    };

    return (
        <Flex direction="column" style={{ height: '100%', minHeight: 0, border: '1px solid var(--gray-a6)', borderRadius: 'var(--radius-3)' }}>
            {/* Header (Keep existing) */}
             <Flex
                align="baseline"
                justify="between"
                px="3" py="2"
                style={{ borderBottom: '1px solid var(--gray-a6)', flexShrink: 0 }}
                gap="3"
                wrap="wrap"
            >
                <Flex align="center" gap="3" wrap="wrap" style={{ minWidth: 0 }}>
                    {renderHeaderDetail(PersonIcon, session.clientName, "Client")}
                    {renderHeaderDetail(CalendarIcon, session.date, "Date")}
                    {renderHeaderDetail(SessionTypeIcon, session.sessionType, "Session Type", 'session')}
                    {renderHeaderDetail(BookmarkIcon, session.therapy, "Therapy Type", 'therapy')}
                </Flex>
                <Box flexShrink="0">
                    <Button variant="ghost" size="1" onClick={onEditDetailsClick} aria-label="Edit session details">
                        <Pencil1Icon width="14" height="14" />
                        <Text ml="1">Edit</Text>
                    </Button>
                </Box>
            </Flex>
            {/* Scrollable Content */}
            <ScrollArea
                type="auto"
                scrollbars="vertical"
                ref={viewportRef}
                onScroll={handleScroll} // Attach scroll handler
                style={{ flexGrow: 1, minHeight: 0 }}
            >
                <Box p="3" className="space-y-3">
                    {/* Map paragraphs (Keep existing) */}
                     {paragraphs.length > 0 ? paragraphs.map((paragraph, index) => (
                        <TranscriptParagraph
                            key={`${session.id}-${index}`} // More robust key
                            paragraph={paragraph}
                            index={index}
                            onSave={handleSaveParagraph}
                            activeEditIndex={activeEditIndex}
                            setActiveEditIndex={setActiveEditIndex}
                        />
                    )) : (
                        <Text color="gray" style={{ fontStyle: 'italic' }}>No transcription available.</Text>
                    )}
                </Box>
            </ScrollArea>
        </Flex>
    );
}
