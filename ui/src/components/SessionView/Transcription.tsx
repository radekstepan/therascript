// src/components/SessionView/Transcription.tsx
import React from 'react';
import type { Session } from '../../types';
import { TranscriptParagraph } from '../Transcription/TranscriptParagraph';
// Import necessary components for header/metadata
import { Box, ScrollArea, Text, Flex, Button, Heading, Badge } from '@radix-ui/themes';
import {
    Pencil1Icon, // Keep for edit button
    BookmarkIcon, // Add icons for metadata
    CalendarIcon,
    PersonIcon,
    BadgeIcon as SessionTypeIcon,
    PlayIcon // Keep PlayIcon if still needed
} from '@radix-ui/react-icons';
import { cn } from '../../utils';

// --- Add helper functions for metadata display (moved from SessionHeader/SessionContent) ---
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
// --- End helper functions ---


interface TranscriptionProps {
    session: Session | null; // Accept session
    onEditDetailsClick: () => void; // Accept handler
    editTranscriptContent: string;
    onContentChange: (value: string) => void;
}

export function Transcription({
    session,
    onEditDetailsClick, // Destructure handler
    editTranscriptContent,
    onContentChange,
}: TranscriptionProps) {

    if (!session) {
        return <Box p="4"><Text color="gray" style={{ fontStyle: 'italic' }}>Loading session data...</Text></Box>;
    }

    const sourceContent = editTranscriptContent;
    const paragraphs = sourceContent.split(/\n\s*\n/).filter(p => p.trim() !== '');
    const displayTitle = session.sessionName || session.fileName;

    const handleSaveParagraph = (index: number, newText: string) => {
        // ... (save paragraph logic remains the same)
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
        <Box style={{ height: '100%', display: 'flex', flexDirection: 'column', border: '1px solid var(--gray-a6)', borderRadius: 'var(--radius-3)' }}>
             {/* --- MODIFIED HEADER --- */}
             <Flex
                align="center"
                justify="between" // Push title/details left, button right
                px="3" py="2"
                style={{ borderBottom: '1px solid var(--gray-a6)', flexShrink: 0 }}
                gap="3" // Add gap between left/right sections
            >
                {/* Left Section: Title and Details */}
                <Flex direction="column" gap="1" style={{ minWidth: 0 }}> {/* Allow shrinking */}
                    {/* Details - smaller size, wrap */}
                    <Flex align="center" gap="3" wrap="wrap">
                         {renderHeaderDetail(PersonIcon, session.clientName, "Client")}
                         {renderHeaderDetail(CalendarIcon, session.date, "Date")}
                         {renderHeaderDetail(SessionTypeIcon, session.sessionType, "Session Type", 'session')}
                         {renderHeaderDetail(BookmarkIcon, session.therapy, "Therapy Type", 'therapy')}
                    </Flex>
                </Flex>

                {/* Right Section: Edit Button */}
                <Box flexShrink="0"> {/* Prevent button shrinking */}
                     <Button
                        variant="ghost"
                        size="1"
                        onClick={onEditDetailsClick}
                        aria-label="Edit session details"
                    >
                        <Pencil1Icon width="14" height="14" />
                        <Text ml="1">Edit</Text> {/* Shorten text */}
                    </Button>
                </Box>
            </Flex>
            {/* --- END MODIFIED HEADER --- */}

            {/* Main Content Area with Scroll */}
            <ScrollArea type="auto" scrollbars="vertical" style={{ flexGrow: 1, minHeight: 0 }}>
                 {/* Removed Session Title and Metadata from here */}
                 {/* Transcript Paragraphs */}
                 <Box p="3" className="space-y-3">
                    {paragraphs.length > 0 ? paragraphs.map((paragraph, index) => (
                        <TranscriptParagraph
                            key={index}
                            paragraph={paragraph}
                            index={index}
                            onSave={handleSaveParagraph}
                        />
                    )) : (
                        <Text color="gray" style={{ fontStyle: 'italic' }}>No transcription available.</Text>
                    )}
                </Box>
            </ScrollArea>
        </Box>
    );
}

// Note: Ensure implementations for helper functions (renderHeaderDetail, getBadgeColor, color maps)
// are either present here or correctly imported if moved to a shared utils file.
// Example implementations (replace with actual logic):
// const sessionColorMap = { 'individual': 'blue', /* ... */ };
// const therapyColorMap = { 'act': 'purple', /* ... */ };
// const getBadgeColor = (type, category) => (category === 'session' ? sessionColorMap[type] : therapyColorMap[type]) || 'gray';
// const renderHeaderDetail = (Icon, value, label, category) => { ... };
