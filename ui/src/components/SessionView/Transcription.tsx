import React, { useState } from 'react';
import { Textarea } from '../ui/Textarea'; // Import new Textarea
import { Button } from '../ui/Button'; // Import new Button
import { Card } from '../ui/Card'; // Import new Card for focus state
import { Pencil1Icon, ArchiveIcon, Cross1Icon } from '@radix-ui/react-icons'; // Available icons
import type { Session } from '../../types';

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

    const [editingParagraphIndex, setEditingParagraphIndex] = useState<number | null>(null);
    const [currentEditValue, setCurrentEditValue] = useState<string>('');

     if (!session) {
        return <p className="italic text-gray-500 dark:text-gray-400 p-4">Loading transcript...</p>;
    }

    const sourceContent = editTranscriptContent;
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
        const baseContentForSave = editTranscriptContent;
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
            <div className="flex-grow flex flex-col min-h-0 relative">
                    <div className="flex-grow min-h-0 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 p-1">
                        <div className="space-y-4 p-3">
                            {paragraphs.length > 0 ? paragraphs.map((paragraph, index) => (
                                <div key={index} className="relative group">
                                    {editingParagraphIndex === index ? (
                                        <Card className="p-2 border-blue-500 shadow-md ring-1 ring-blue-500 dark:border-blue-600 dark:ring-blue-600">
                                            <div className="flex flex-col items-stretch gap-2">
                                                <Textarea
                                                    value={currentEditValue}
                                                    onChange={handleParagraphContentChange}
                                                    className="w-full whitespace-pre-wrap text-sm font-mono leading-relaxed p-2 resize-none"
                                                    rows={Math.max(3, paragraph.split('\n').length + 1)}
                                                    autoFocus
                                                />
                                                <div className="flex justify-end space-x-2">
                                                    {/* Use icon prop */}
                                                    <Button onClick={handleSaveParagraph} size="xs" variant="default" icon={ArchiveIcon}>
                                                        Save
                                                    </Button>
                                                    <Button onClick={handleCancelParagraphEdit} size="xs" variant="secondary" icon={Cross1Icon}>
                                                        Cancel
                                                    </Button>
                                                </div>
                                            </div>
                                        </Card>
                                    ) : (
                                        <div className="flex items-start gap-2 p-1 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors duration-150">
                                            <pre className="flex-grow whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300 font-mono leading-relaxed">
                                                {paragraph}
                                            </pre>
                                            {/* Use icon prop for icon-only button */}
                                            <Button
                                                variant="ghost"
                                                size="iconXs"
                                                icon={Pencil1Icon} // Use icon prop
                                                className="flex-shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity text-gray-400 hover:text-blue-600 dark:text-gray-500 dark:hover:text-blue-500"
                                                onClick={() => handleEditClick(index, paragraph)}
                                                title="Edit this paragraph"
                                                aria-label="Edit paragraph"
                                            />
                                        </div>
                                    )}
                                </div>
                            )) : (
                                <p className="italic text-gray-500 dark:text-gray-400 p-3">
                                    No transcription available.
                                </p>
                            )}
                        </div>
                    </div>
            </div>
        </div>
    );
}
