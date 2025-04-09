import React from 'react';
import type { Session } from '../../types';
import { TranscriptParagraph } from '../Transcription/TranscriptParagraph';
import { Box, Text } from '@radix-ui/themes'; // Use Box for container

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
        // Use Themes Text component correctly
        return <Box p="4"><Text color="gray" style={{ fontStyle: 'italic' }}>Loading transcript...</Text></Box>;
    }

    const sourceContent = editTranscriptContent;
    const paragraphs = sourceContent.split(/\n\s*\n/).filter(p => p.trim() !== '');

    const handleSaveParagraph = (index: number, newText: string) => {
        const baseContentForSave = editTranscriptContent;
        // Split using the same logic to ensure indices match
        const currentParagraphs = baseContentForSave.split(/\n\s*\n/);
        if (index >= 0 && index < currentParagraphs.length) {
            // Find the *actual* paragraph corresponding to the visible one
            // This handles potential empty strings from multiple newlines
            let paragraphIndexInFullSplit = -1;
            let visibleIndexCounter = -1;
            for(let i = 0; i < currentParagraphs.length; i++) {
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
        // Apply padding to the outer Box, not the inner Text for the empty state
        <Box p="3">
            <div className="space-y-3"> {/* Keep Tailwind for spacing between paragraphs */}
                 {paragraphs.length > 0 ? paragraphs.map((paragraph, index) => (
                   <TranscriptParagraph
                        key={index}
                        paragraph={paragraph}
                        index={index}
                        onSave={handleSaveParagraph}
                   />
                 )) : (
                   // Use Themes Text component correctly, REMOVE `p="3"` here
                   <Text color="gray" style={{ fontStyle: 'italic' }}>No transcription available.</Text>
                 )}
              </div>
        </Box>
      );
}
