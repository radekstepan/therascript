// src/components/SessionView/Transcription.tsx
import React from 'react';
import type { Session } from '../../types';
import { TranscriptParagraph } from '../Transcription/TranscriptParagraph'; // Correct path
import { Box, Text } from '@radix-ui/themes'; // Remove ScrollArea from themes
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'; // Import the standalone package

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
            {/* Use ScrollAreaPrimitive */}
            <ScrollAreaPrimitive.Root
                className="flex-grow overflow-hidden" // Use flex-grow and hide overflow on Root
                type="auto"
                style={{ flexGrow: 1, minHeight: 0 }}
            >
                <ScrollAreaPrimitive.Viewport className="h-full w-full rounded-[inherit]">
                    <Box p="3" className="space-y-3"> {/* Padding inside viewport */}
                        {paragraphs.length > 0 ? paragraphs.map((paragraph, index) => (
                            <TranscriptParagraph
                                key={index}
                                paragraph={paragraph}
                                index={index}
                                onSave={handleSaveParagraph}
                                // Pass necessary props here if needed
                            />
                        )) : (
                            <Text color="gray" style={{ fontStyle: 'italic' }}>No transcription available.</Text>
                        )}
                    </Box>
                </ScrollAreaPrimitive.Viewport>
                {/* Example styling - adjust classes as needed for your theme */}
                <ScrollAreaPrimitive.Scrollbar orientation="vertical" className="flex select-none touch-none p-0.5 bg-[--gray-a3] transition-colors duration-[160ms] ease-out data-[orientation=vertical]:w-2.5">
                     <ScrollAreaPrimitive.Thumb className="flex-1 bg-[--gray-a7] rounded-[10px] relative before:content-[''] before:absolute before:top-1/2 before:left-1/2 before:-translate-x-1/2 before:-translate-y-1/2 before:w-full before:h-full before:min-w-[44px] before:min-h-[44px] hover:bg-[--gray-a8]" />
                </ScrollAreaPrimitive.Scrollbar>
                <ScrollAreaPrimitive.Corner className="bg-[--gray-a5]" />
            </ScrollAreaPrimitive.Root>
        </Box>
    );
}
