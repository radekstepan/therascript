// src/components/Transcription/TranscriptParagraph.tsx
import React, { useState } from 'react';
import { Button } from '../ui/Button';
import { Textarea } from '../ui/Textarea';
import { Card } from '../ui/Card'; // For focus state styling
import { Pencil1Icon, CheckIcon, Cross1Icon } from '@radix-ui/react-icons'; // Changed Save to Check
import { cn } from '../../utils';

interface TranscriptParagraphProps {
    paragraph: string;
    index: number;
    onSave: (index: number, newText: string) => void;
    // Consider adding onCancel if needed, though clicking outside might suffice
}

export function TranscriptParagraph({ paragraph, index, onSave }: TranscriptParagraphProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(paragraph);

    const handleEditClick = () => {
        setEditValue(paragraph); // Reset edit value to original on edit start
        setIsEditing(true);
    };

    const handleCancel = () => {
        setIsEditing(false);
        // Optionally reset editValue, though it gets reset on next edit anyway
        // setEditValue(paragraph);
    };

    const handleSave = () => {
        // Basic validation: don't save if empty (or add more complex rules)
        if (editValue.trim()) {
            onSave(index, editValue);
            setIsEditing(false);
        } else {
            // Optional: Show an inline error or prevent saving
            console.warn("Attempted to save empty paragraph");
            // Maybe keep editing open? Or revert?
            // handleCancel(); // Revert to original if save is invalid
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { // Ctrl+Enter or Cmd+Enter to save
            e.preventDefault();
            handleSave();
        } else if (e.key === 'Escape') { // Escape to cancel
            e.preventDefault();
            handleCancel();
        }
    };


    if (isEditing) {
        return (
             // Use Card for visual editing state indication
            <Card className="p-2 border-blue-500 shadow-md ring-1 ring-blue-500 dark:border-blue-600 dark:ring-blue-600">
                <div className="flex flex-col items-stretch gap-2">
                    <Textarea
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        className="w-full whitespace-pre-wrap text-sm font-mono leading-relaxed p-2 resize-y" // Allow resize while editing
                        rows={Math.max(3, paragraph.split('\n').length + 1)} // Dynamic rows
                        autoFocus
                        onKeyDown={handleKeyDown} // Add keyboard shortcuts
                        aria-label={`Edit paragraph ${index + 1}`}
                    />
                    <div className="flex justify-end space-x-2 mt-1">
                         {/* Use Check icon for Save */}
                         <Button onClick={handleSave} size="xs" variant="default" icon={CheckIcon} title="Save (Ctrl+Enter)">
                            Save
                        </Button>
                        <Button onClick={handleCancel} size="xs" variant="secondary" icon={Cross1Icon} title="Cancel (Esc)">
                            Cancel
                        </Button>
                    </div>
                </div>
            </Card>
        );
    }

    return (
        // Non-editing view
        <div className="relative group flex items-start gap-2 p-1 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors duration-150">
            {/* Using <pre> preserves whitespace and line breaks */}
            <pre className="flex-grow whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300 font-mono leading-relaxed">
                {paragraph}
            </pre>
            <Button
                variant="ghost"
                size="iconXs"
                icon={Pencil1Icon}
                className="absolute top-1 right-1 flex-shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity text-gray-400 hover:text-blue-600 dark:text-gray-500 dark:hover:text-blue-500 p-0 h-5 w-5" // Position top-right
                onClick={handleEditClick}
                title="Edit this paragraph"
                aria-label="Edit paragraph"
            />
        </div>
    );
}
