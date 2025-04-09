// src/components/SessionView/Transcription.tsx
import React from 'react';
import type { Session } from '../../types';
import { TranscriptParagraph } from '../Transcription/TranscriptParagraph'; // Import the new component

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
      return <p className="italic text-gray-500 dark:text-gray-400 p-4">Loading transcript...</p>;
    }

    const sourceContent = editTranscriptContent;
    // Split into paragraphs, ensuring empty lines between paragraphs are handled
    // and filter out paragraphs that are only whitespace.
    const paragraphs = sourceContent.split(/\n\s*\n/).filter(p => p.trim() !== '');


    // Handler to update the full transcript when a single paragraph is saved
    const handleSaveParagraph = (index: number, newText: string) => {
        // Use the current state value of editTranscriptContent for consistency
        const baseContentForSave = editTranscriptContent; // Or pass session.transcription if preferred
        const currentParagraphs = baseContentForSave.split(/\n\s*\n/).filter(p => p.trim() !== ''); // Use same split logic

        if (index >= 0 && index < currentParagraphs.length) {
            currentParagraphs[index] = newText; // Update the specific paragraph
        } else {
            console.warn("Paragraph index out of bounds during save.");
            return; // Avoid proceeding if index is invalid
        }

        // Re-join with double newlines to preserve paragraph structure
        const newTranscript = currentParagraphs.join('\n\n');
        onContentChange(newTranscript); // Call the prop function passed from SessionView
    };

    return (
        <div className="flex flex-col flex-grow min-h-0">
          {/* Add padding to the container, not individual paragraphs directly unless needed */}
          <div className="space-y-3 p-3"> {/* Adjust spacing/padding as needed */}
             {paragraphs.length > 0 ? paragraphs.map((paragraph, index) => (
               <TranscriptParagraph
                    key={index} // Use index as key, assuming paragraphs don't drastically reorder
                    paragraph={paragraph}
                    index={index}
                    onSave={handleSaveParagraph}
               />
             )) : (
               <p className="italic text-gray-500 dark:text-gray-400 p-3">
                 No transcription available.
               </p>
             )}
          </div>
        </div>
      );
}
