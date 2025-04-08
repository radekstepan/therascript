import React, { useState } from 'react';
// UI Components
import { Textarea, Button, Flex, Card, Text } from '@tremor/react'; // Import Tremor components
import { Edit, Save, X } from '../icons/Icons'; // Import Save and X icons

import type { Session } from '../../types';

// Props interface - Ensure it receives necessary props for paragraph editing
interface TranscriptionProps {
    session: Session | null; // Allow session to potentially be null during loading phases
    isEditingOverall: boolean; // Renamed to avoid confusion with paragraph editing
    editTranscriptContent: string;
    onContentChange: (value: string) => void;
    // We might not need onEditToggle and onSave passed here if they only control the overall state
    // Let's keep them for now in case the parent needs them for other reasons
    onEditToggle?: () => void;
    onSave?: () => void;
}

export function Transcription({
    session,
    isEditingOverall, // Use the renamed prop
    editTranscriptContent,
    onContentChange,
}: TranscriptionProps) {

    // Local state for inline paragraph editing
    const [editingParagraphIndex, setEditingParagraphIndex] = useState<number | null>(null);
    const [currentEditValue, setCurrentEditValue] = useState<string>('');

    // Add check for session prop
     if (!session && !isEditingOverall) { // Check logic: Allow editing even if session is null?
        return <Text className="italic text-tremor-content-subtle p-4">Loading transcript...</Text>; // Or null
    }

    // Use editTranscriptContent when overall editing is active, otherwise use session.transcription for display
    // Default to empty string if session or transcription is null/undefined when not editing overall
    const sourceContent = isEditingOverall ? editTranscriptContent : (session?.transcription || '');
    // Split transcript into paragraphs for inline editing view
    // Filter out empty strings that might result from multiple newlines
    const paragraphs = sourceContent.split('\n\n').filter(p => p.trim() !== '');

    const handleEditClick = (index: number, text: string) => {
        setEditingParagraphIndex(index);
        setCurrentEditValue(text);
    };

    const handleCancelParagraphEdit = () => {
        setEditingParagraphIndex(null);
        setCurrentEditValue('');
    };

    const handleSaveParagraph = () => {
        if (editingParagraphIndex === null) return;

        // Create a mutable copy of the paragraphs derived from the *current* editTranscriptContent
        // This ensures we're updating the state that gets saved eventually.
        // Use sourceContent as a base in case editTranscriptContent hasn't been updated yet from initial load
        const baseContentForSave = isEditingOverall ? editTranscriptContent : (session?.transcription || '');
        const currentParagraphs = baseContentForSave.split('\n\n').filter(p => p.trim() !== '');

        // Ensure the index is valid before updating
        if (editingParagraphIndex >= 0 && editingParagraphIndex < currentParagraphs.length) {
            currentParagraphs[editingParagraphIndex] = currentEditValue; // Update the edited paragraph
        } else {
            // Handle edge case: if the paragraph structure changed unexpectedly
            console.warn("Paragraph index out of bounds during save.");
             // Optionally, append if index is somehow invalid but we have content
             // currentParagraphs.push(currentEditValue);
        }

        const newTranscript = currentParagraphs.join('\n\n');

        onContentChange(newTranscript); // Update the parent's state
        handleCancelParagraphEdit(); // Exit editing mode for the paragraph
    };

    const handleParagraphContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
         setCurrentEditValue(e.target.value);
    };


    return (
        <div className="flex-grow flex flex-col min-h-0"> {/* Reduced space-y, full height */}
             {/* Header is controlled by parent SessionView based on isEditingOverall */}

            {/* Main content area for transcript */}
            <div className="flex-grow flex flex-col min-h-0 relative"> {/* Added relative for potential absolute positioning */}
                {isEditingOverall ? (
                    // Overall Edit Mode: Show the single large Textarea
                    <Textarea
                        value={editTranscriptContent}
                        onValueChange={onContentChange} // Use Tremor's onValueChange
                        className="flex-grow w-full whitespace-pre-wrap !text-sm font-mono !leading-relaxed p-3 h-full resize-none" // Force font/leading, ensure full height, no resize handle
                        placeholder="Enter or paste transcription here..."
                        autoFocus
                    />
                ) : (
                    // View Mode with Inline Paragraph Editing
                    // Use a div with overflow-y-auto instead of ScrollArea
                    <div className="flex-grow overflow-y-auto border border-tremor-border rounded-tremor-default p-1">
                        <div className="space-y-4 p-3"> {/* Add space between paragraphs */}
                            {paragraphs.length > 0 ? paragraphs.map((paragraph, index) => (
                                <div key={index} className="relative group"> {/* Outer container per paragraph, needs group */}
                                    {editingParagraphIndex === index ? (
                                        // --- Editing mode for this paragraph ---
                                        <Card className="p-2 border-tremor-brand shadow-tremor-input ring-1 ring-tremor-brand"> {/* Use Card for focus state */}
                                        <Flex flexDirection="col" alignItems='stretch' className="gap-2">
                                            <Textarea
                                                value={currentEditValue}
                                                onChange={handleParagraphContentChange} // Standard onChange for controlled Textarea
                                                className="w-full whitespace-pre-wrap !text-sm !font-mono !leading-relaxed p-2 resize-none" // Force font/leading
                                                rows={Math.max(3, paragraph.split('\n').length + 1)} // Basic auto-sizing attempt
                                                autoFocus
                                            />
                                                <Flex justifyContent="end" className="space-x-2">
                                                <Button onClick={handleSaveParagraph} size="xs" variant="primary" icon={Save}>
                                                     Save
                                                </Button>
                                                <Button onClick={handleCancelParagraphEdit} size="xs" variant="secondary" icon={X}>
                                                     Cancel
                                                </Button>
                                            </Flex>
                                            </Flex>
                                        </Card>
                                    ) : (
                                        // --- View mode for this paragraph ---
                                        // Use padding and relative positioning for the button
                                        <div className="p-1 rounded-tremor-small hover:bg-tremor-background-muted transition-colors duration-150">
                                            <pre className="whitespace-pre-wrap text-tremor-default text-tremor-content font-mono leading-relaxed">
                                                {paragraph}
                                            </pre>
                                            {/* Edit Button (fixed size, appears on hover) */}
                                            <Button
                                                variant="light" size="xs"
                                                // Use absolute positioning top-right within the relative parent
                                                className="absolute top-1 right-1 h-6 w-6 p-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity text-tremor-content-subtle hover:text-tremor-brand hover:bg-tremor-background-muted"
                                                onClick={() => handleEditClick(index, paragraph)}
                                                title="Edit this paragraph"
                                                aria-label="Edit paragraph" // Accessibility
                                                icon={Edit} // Use Tremor icon prop
                                            />
                                        </div>
                                    )}
                                </div>
                            )) : (
                                // Display if no transcription content
                                <Text className="italic text-tremor-content-subtle p-3">
                                        No transcription available.
                                        {/* Only show edit hint if session exists but transcription is empty */}
                                        { session && !session.transcription && ' You can edit the session details to add one.'}
                                </Text>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
