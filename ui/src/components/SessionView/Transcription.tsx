import React from 'react';
import type { Session } from '../../types';
import { TranscriptParagraph } from '../Transcription/TranscriptParagraph';
import { Box, ScrollArea, Text } from '@radix-ui/themes';

interface TranscriptionProps {
    session: Session | null;
    editTranscriptContent: string;
    onContentChange: (value: string) => void;
}

export function Transcription({
    session,
    editTranscriptContent,
    onContentChange,
}: TranscriptionProps) {
    if (!session) {
        return <Box p="4"><Text color="gray" style={{ fontStyle: 'italic' }}>Loading transcript...</Text></Box>;
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
        <Box style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <Box px="4" py="2" style={{ borderBottom: '1px solid var(--gray-a6)', flexShrink: 0 }}>
                <Text weight="medium">Transcription</Text>
            </Box>
            <ScrollArea type="auto" scrollbars="vertical" style={{ flexGrow: 1, minHeight: 0 }}>
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
