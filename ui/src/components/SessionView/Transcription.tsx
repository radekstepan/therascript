import React, { useState } from 'react';
import { Textarea } from '../ui/Textarea'; // Import new Textarea
import { Button } from '../ui/Button'; // Import new Button
import { Card } from '../ui/Card'; // Import new Card for focus state
import { Edit, Save, X } from '../icons/Icons';
import type { Session } from '../../types';

interface TranscriptionProps {
session: Session | null;
isEditingOverall: boolean;
editTranscriptContent: string;
onContentChange: (value: string) => void;
onEditToggle?: () => void;
onSave?: () => void;
}

export function Transcription({
session,
isEditingOverall,
editTranscriptContent,
onContentChange,
}: TranscriptionProps) {

      
const [editingParagraphIndex, setEditingParagraphIndex] = useState<number | null>(null);
const [currentEditValue, setCurrentEditValue] = useState<string>('');

 if (!session && !isEditingOverall) {
    return <p className="italic text-gray-500 dark:text-gray-400 p-4">Loading transcript...</p>; // Use p
}

const sourceContent = isEditingOverall ? editTranscriptContent : (session?.transcription || '');
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
    const baseContentForSave = isEditingOverall ? editTranscriptContent : (session?.transcription || '');
    const currentParagraphs = baseContentForSave.split('\n\n').filter(p => p.trim() !== '');
    if (editingParagraphIndex >= 0 && editingParagraphIndex < currentParagraphs.length) {
        currentParagraphs[editingParagraphIndex] = currentEditValue;
    } else {
        console.warn("Paragraph index out of bounds during save.");
    }
    const newTranscript = currentParagraphs.join('\n\n');
    onContentChange(newTranscript);
    handleCancelParagraphEdit();
};

const handleParagraphContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
     setCurrentEditValue(e.target.value);
};

return (
    <div className="flex flex-col flex-grow min-h-0">
        {/* This inner container handles the content layout */}
        <div className="flex-grow flex flex-col min-h-0 relative">
            {isEditingOverall ? (
                // Overall Edit Mode: Show the single large Textarea
                <Textarea
                    value={editTranscriptContent}
                    onChange={(e) => onContentChange(e.target.value)} // Use standard onChange
                    className="flex-grow min-h-0 w-full whitespace-pre-wrap text-sm font-mono leading-relaxed p-3 resize-none border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 overflow-y-auto" // Needs to grow and scroll
                    placeholder="Enter or paste transcription here..."
                    autoFocus
                />
            ) : (
                // View Mode with Inline Paragraph Editing
                // Use a div with overflow-y-auto and Tailwind styles
                <div className="flex-grow min-h-0 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 p-1"> {/* This div needs to grow and scroll, added padding back */}
                    <div className="space-y-4 p-3">
                        {paragraphs.length > 0 ? paragraphs.map((paragraph, index) => (
                            <div key={index} className="relative group">
                                {editingParagraphIndex === index ? (
                                    // --- Editing mode for this paragraph ---
                                    // Use Card for visual distinction, could also be a simple div with border/ring
                                    <Card className="p-2 border-blue-500 shadow-md ring-1 ring-blue-500 dark:border-blue-600 dark:ring-blue-600">
                                        <div className="flex flex-col items-stretch gap-2"> {/* Use div + flex */}
                                            <Textarea
                                                value={currentEditValue}
                                                onChange={handleParagraphContentChange}
                                                className="w-full whitespace-pre-wrap text-sm font-mono leading-relaxed p-2 resize-none" // Style directly
                                                rows={Math.max(3, paragraph.split('\n').length + 1)}
                                                autoFocus
                                            />
                                            <div className="flex justify-end space-x-2"> {/* Use div + flex */}
                                                <Button onClick={handleSaveParagraph} size="xs" variant="default" icon={Save}>
                                                     Save
                                                </Button>
                                                <Button onClick={handleCancelParagraphEdit} size="xs" variant="secondary" icon={X}>
                                                     Cancel
                                                </Button>
                                            </div>
                                        </div>
                                    </Card>
                                ) : (
                                    // --- View mode for this paragraph ---
                                    // Use flex layout to place button beside the text
                                    <div className="flex items-start gap-2 p-1 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors duration-150">
                                        <pre className="flex-grow whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300 font-mono leading-relaxed"> {/* Text takes available space */}
                                            {paragraph}
                                        </pre>
                                        <Button
                                            variant="ghost"
                                            size="iconXs"
                                            className="flex-shrink-0 h-6 w-6 p-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity text-gray-400 hover:text-blue-600 dark:text-gray-500 dark:hover:text-blue-500" // Removed absolute positioning, added flex-shrink-0
                                            onClick={() => handleEditClick(index, paragraph)}
                                            title="Edit this paragraph"
                                            aria-label="Edit paragraph"
                                        >
                                            <Edit size={14} />
                                        </Button>
                                    </div>
                                )}
                            </div>
                        )) : (
                            <p className="italic text-gray-500 dark:text-gray-400 p-3"> {/* Use p */}
                                    No transcription available.
                                    { session && !session.transcription && ' You can edit the session details to add one.'}
                            </p>
                        )}
                    </div>
                </div>
            )}
        </div>
    </div>
);
}
