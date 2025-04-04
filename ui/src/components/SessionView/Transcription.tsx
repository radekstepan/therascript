import React, { useState } from 'react';
// UI Components
import { Textarea } from '../ui/Textarea';
import { ScrollArea } from '../ui/ScrollArea';
import { Button } from '../ui/Button';
import { Edit, Save, X } from '../icons/Icons'; // Import Save and X icons
// Import types
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
        return <div className="text-gray-500 italic">Loading transcript...</div>; // Or null
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
        <div className="flex-grow flex flex-col min-h-0 space-y-2"> {/* Reduced space-y */}
             {/* Header is controlled by parent SessionView based on isEditingOverall */}
             {/* Removed h2 from here */}
            <div className="flex-grow flex flex-col min-h-0">
                {isEditingOverall ? (
                    // Overall Edit Mode: Show the single large Textarea
                    <Textarea
                        value={editTranscriptContent}
                        onChange={(e: any) => onContentChange(e.target.value)}
                        className="flex-grow w-full whitespace-pre-wrap text-sm font-mono border border-gray-300 rounded-md p-3"
                        placeholder="Enter or paste transcription here..."
                        autoFocus
                    />
                ) : (
                    // View Mode with Inline Paragraph Editing
                    <ScrollArea className="flex-grow border rounded-md p-1"> {/* Added padding to ScrollArea's inner div */}
                        <div className="space-y-3 p-2"> {/* Add space between paragraphs */}
                            {paragraphs.length > 0 ? paragraphs.map((paragraph, index) => (
                                <div key={index}> {/* Outer container per paragraph */}
                                    {editingParagraphIndex === index ? (
                                        // --- Editing mode for this paragraph ---
                                        <div className="space-y-2 p-2 border border-blue-300 rounded-md bg-white"> {/* Add padding and bg */}
                                            <Textarea
                                                value={currentEditValue}
                                                onChange={handleParagraphContentChange}
                                                className="w-full whitespace-pre-wrap text-sm font-mono border border-gray-300 rounded p-2 focus:ring-1 focus:ring-blue-500" // Simplified border/focus
                                                rows={Math.max(3, paragraph.split('\n').length + 1)} // Basic auto-sizing attempt
                                                autoFocus
                                            />
                                            <div className="flex items-center space-x-2 justify-end">
                                                <Button onClick={handleSaveParagraph} size="sm" variant="default" className="h-7 px-2 text-xs">
                                                    <Save size={14} className="mr-1" /> Save
                                                </Button>
                                                <Button onClick={handleCancelParagraphEdit} size="sm" variant="ghost" className="h-7 px-2 text-xs">
                                                    <X size={14} className="mr-1" /> Cancel
                                                </Button>
                                            </div>
                                        </div>
                                    ) : (
                                        // --- View mode for this paragraph ---
                                        // Use flexbox to align text and button
                                        <div className="relative group flex items-start space-x-2 p-1 rounded hover:bg-gray-50 transition-colors duration-150"> {/* Flex container with group */}
                                            {/* Paragraph Text (takes available space) */}
                                            <pre className="flex-grow whitespace-pre-wrap text-sm text-gray-700 py-1 font-mono min-w-0"> {/* Use flex-grow, min-w-0 prevents overflow issues */}
                                                {paragraph}
                                            </pre>
                                            {/* Edit Button (fixed size, appears on hover) */}
                                            <Button
                                                variant="ghost" size="icon"
                                                // Removed absolute positioning. Added flex-shrink-0. Adjusted style/size slightly.
                                                className="flex-shrink-0 h-6 w-6 p-1 mt-0.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity text-gray-400 hover:text-blue-600 hover:bg-gray-200 rounded-full"
                                                onClick={() => handleEditClick(index, paragraph)}
                                                title="Edit this paragraph"
                                                aria-label="Edit paragraph" // Accessibility
                                            >
                                                <Edit size={14} />
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            )) : (
                                // Display if no transcription content
                                <div className="p-3"> {/* Wrap placeholder message */}
                                    <pre className="whitespace-pre-wrap text-sm text-gray-500 font-mono italic">
                                        No transcription available.
                                        {/* Only show edit hint if session exists but transcription is empty */}
                                        { session && !session.transcription && ' You can edit the session details to add one.'}
                                    </pre>
                                </div>
                            )}
                        </div>
                    </ScrollArea>
                )}
            </div>
        </div>
    );
}
