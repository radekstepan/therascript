/*
Modified File: src/components/SessionView/Transcription.tsx
Using @radix-ui/themes ScrollArea
+ Attempting baseline alignment for header items
+ Added state management for activeEditIndex
*/
import React, { useState } from 'react';
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

// --- Helper functions (unchanged placeholders for brevity) ---
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

interface TranscriptionProps {
    session: Session | null;
    onEditDetailsClick: () => void;
    editTranscriptContent: string;
    onContentChange: (value: string) => void;
}

export function Transcription({
    session,
    onEditDetailsClick,
    editTranscriptContent,
    onContentChange,
}: TranscriptionProps) {
    const [activeEditIndex, setActiveEditIndex] = useState<number | null>(null);

    if (!session) {
        return <Box p="4"><Text color="gray" style={{ fontStyle: 'italic' }}>Loading session data...</Text></Box>;
    }

    const sourceContent = editTranscriptContent;
    const paragraphs = sourceContent.split(/\n\s*\n/).filter(p => p.trim() !== '');

    const handleSaveParagraph = (index: number, newText: string) => {
        const baseContentForSave = editTranscriptContent;
        const currentParagraphs = baseContentForSave.split(/\n\s*\n/);
        if (index >= 0 && index < currentParagraphs.length) {
            let paragraphIndexInFullSplit = -1;
            let visibleIndexCounter = -1;
            for (let i = 0; i < currentParagraphs.length; i++) {
                if (currentParagraphs[i].trim() !== '') {
                    visibleIndexCounter++;
                    if (visibleIndexCounter === index) {
                        paragraphIndexInFullSplit = i;
                        break;
                    }
                }
            }

            if (paragraphIndexInFullSplit !== -1) {
                currentParagraphs[paragraphIndexInFullSplit] = newText;
            } else {
                console.warn("Paragraph index mapping failed during save.");
                return;
            }
        } else {
            console.warn("Paragraph index out of bounds during save.");
            return;
        }
        const newTranscript = currentParagraphs.join('\n\n');
        onContentChange(newTranscript);
    };

    return (
        <Flex direction="column" style={{ height: '100%', minHeight: 0, border: '1px solid var(--gray-a6)', borderRadius: 'var(--radius-3)' }}>
            <Flex
                align="baseline"
                justify="between"
                px="3" py="2"
                style={{ borderBottom: '1px solid var(--gray-a6)', flexShrink: 0 }}
                gap="3"
            >
                <Flex direction="column" gap="1" style={{ minWidth: 0 }}>
                    <Flex align="center" gap="3" wrap="wrap">
                        {renderHeaderDetail(PersonIcon, session.clientName, "Client")}
                        {renderHeaderDetail(CalendarIcon, session.date, "Date")}
                        {renderHeaderDetail(SessionTypeIcon, session.sessionType, "Session Type", 'session')}
                        {renderHeaderDetail(BookmarkIcon, session.therapy, "Therapy Type", 'therapy')}
                    </Flex>
                </Flex>
                <Box flexShrink="0">
                    <Button variant="ghost" size="1" onClick={onEditDetailsClick} aria-label="Edit session details">
                        <Pencil1Icon width="14" height="14" />
                        <Text ml="1">Edit</Text>
                    </Button>
                </Box>
            </Flex>

            <ScrollArea
                type="auto"
                scrollbars="vertical"
                style={{ flexGrow: 1, minHeight: 0 }}
            >
                <Box p="3" className="space-y-3">
                    {paragraphs.length > 0 ? paragraphs.map((paragraph, index) => (
                        <TranscriptParagraph
                            key={index}
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
