import React, { useState } from 'react';
import { Button, TextArea, Card, Flex, Box, Text, IconButton } from '@radix-ui/themes';
import { Pencil1Icon, CheckIcon, Cross1Icon } from '@radix-ui/react-icons';
import { cn } from '../../utils';

interface TranscriptParagraphProps {
    paragraph: string;
    index: number;
    onSave: (index: number, newText: string) => void;
}

export function TranscriptParagraph({ paragraph, index, onSave }: TranscriptParagraphProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(paragraph);

    const handleEditClick = () => {
        setEditValue(paragraph);
        setIsEditing(true);
    };

    const handleCancel = () => setIsEditing(false);

    const handleSave = () => {
        // Only save if content actually changed to avoid unnecessary updates
        if (editValue !== paragraph) {
            // Allow saving empty paragraph to effectively delete it if needed?
            // Or enforce non-empty? Let's allow empty for now.
            onSave(index, editValue);
        }
        setIsEditing(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => { // Added type
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault(); handleSave();
        } else if (e.key === 'Escape') {
            e.preventDefault(); handleCancel();
        }
    };

    if (isEditing) {
        return (
             // Removed highContrast from Card
            <Card size="1" variant="surface">
                 {/* Changed gap from number to string */}
                <Flex direction="column" gap="2">
                    <TextArea
                        value={editValue}
                        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setEditValue(e.target.value)} // Added type
                        className="w-full !h-auto" // Keep Tailwind width if needed
                        placeholder="Enter paragraph text..."
                        size="2"
                        style={{
                            whiteSpace: 'pre-wrap', // Ensures wrap in textarea
                            fontFamily: 'var(--font-mono)',
                            lineHeight: 'var(--line-height-4)', // Match display style
                            minHeight: '6em', // Default min height
                            resize: 'vertical' // Allow vertical resize
                        }}
                        autoFocus
                        onKeyDown={handleKeyDown}
                        aria-label={`Edit paragraph ${index + 1}`}
                    />
                     {/* Changed gap from number to string */}
                    <Flex justify="end" gap="2" mt="1">
                         <Button onClick={handleSave} size="1" variant="solid" title="Save (Ctrl+Enter)"> <CheckIcon /> Save </Button>
                         <Button onClick={handleCancel} size="1" variant="soft" color="gray" title="Cancel (Esc)"> <Cross1Icon /> Cancel </Button>
                    </Flex>
                </Flex>
            </Card>
        );
    }

    return (
        <Box className="group relative p-1 rounded hover:bg-[--gray-a3] transition-colors duration-150">
            {/* Use Box as="pre" for semantic correctness and styling */}
            {/* The TS error was likely incorrect, Box should support as="pre" */}
            <Box as="div" className="text-sm text-[--gray-a12]"
                  style={{
                      whiteSpace: 'pre-wrap', // Crucial for respecting newlines/spaces
                      fontFamily: 'var(--font-mono)', // Use monospace for transcript feel
                      lineHeight: 'var(--line-height-4)', // Consistent line height
                      wordBreak: 'break-word' // Break long words if needed
                  }}
            >
                {/* Render paragraph text, handle potential empty string */}
                {paragraph || <span style={{ fontStyle: 'italic', color: 'var(--gray-a9)'}}>[Empty Paragraph]</span>}
            </Box>
             <IconButton
                variant="ghost" color="gray" size="1"
                className="absolute top-1 right-1 flex-shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity p-0 h-5 w-5" // Tailwind positioning and hover
                onClick={handleEditClick}
                title="Edit this paragraph"
                aria-label="Edit paragraph"
            >
                <Pencil1Icon />
            </IconButton>
        </Box>
    );
}
