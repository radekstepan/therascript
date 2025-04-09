// src/components/Transcription/TranscriptParagraph.tsx
import React, { useState } from 'react';
import { Button, TextArea, Card, Flex, Box, Text, IconButton } from '@radix-ui/themes';
// Import PlayIcon
import { Pencil1Icon, CheckIcon, Cross1Icon, PlayIcon } from '@radix-ui/react-icons';
import { cn } from '../../utils';

interface TranscriptParagraphProps {
    paragraph: string;
    index: number;
    onSave: (index: number, newText: string) => void;
    // Add a prop for handling the play action later if needed
    // onPlay?: (index: number) => void;
}

export function TranscriptParagraph({ paragraph, index, onSave /*, onPlay */ }: TranscriptParagraphProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(paragraph);

    const handleEditClick = () => {
        setEditValue(paragraph);
        setIsEditing(true);
    };

    const handleCancel = () => setIsEditing(false);

    const handleSave = () => {
        if (editValue !== paragraph) {
            onSave(index, editValue);
        }
        setIsEditing(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault(); handleSave();
        } else if (e.key === 'Escape') {
            e.preventDefault(); handleCancel();
        }
    };

    // --- Function to simulate play click ---
    const handlePlayClick = () => {
        console.log(`▶️ Simulate PLAY event for paragraph index ${index}: "${paragraph.substring(0, 70)}..."`);
        // Later, you would call a function passed via props or context:
        // if (onPlay) {
        //   onPlay(index);
        // }
    };
    // --- End simulation function ---

    if (isEditing) {
        // --- Editing View (Unchanged) ---
        return (
            <Card size="1" variant="surface">
                <Flex direction="column" gap="2">
                    <TextArea
                        value={editValue}
                        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setEditValue(e.target.value)}
                        className="w-full !h-auto"
                        placeholder="Enter paragraph text..."
                        size="2"
                        style={{
                            whiteSpace: 'pre-wrap',
                            fontFamily: 'var(--font-mono)',
                            lineHeight: 'var(--line-height-4)',
                            minHeight: '6em',
                            resize: 'vertical'
                        }}
                        autoFocus
                        onKeyDown={handleKeyDown}
                        aria-label={`Edit paragraph ${index + 1}`}
                    />
                    <Flex justify="end" gap="2" mt="1">
                         <Button onClick={handleSave} size="1" variant="solid" title="Save (Ctrl+Enter)"> <CheckIcon /> Save </Button>
                         <Button onClick={handleCancel} size="1" variant="soft" color="gray" title="Cancel (Esc)"> <Cross1Icon /> Cancel </Button>
                    </Flex>
                </Flex>
            </Card>
        );
        // --- End Editing View ---
    }

    return (
        // Outer Box purely for hover background effect now
        <Box className="rounded hover:bg-[--gray-a3] transition-colors duration-150">
            {/* Main Flex container with group for hover effects */}
            <Flex align="start" gap="2" className="group p-1">
                 {/* Text Box */}
                 <Box
                    as="div"
                    className="text-sm text-[--gray-a12] flex-grow"
                    style={{
                        whiteSpace: 'pre-wrap',
                        fontFamily: 'var(--font-mono)',
                        lineHeight: 'var(--line-height-4)',
                        wordBreak: 'break-word',
                    }}
                 >
                    {paragraph || <span style={{ fontStyle: 'italic', color: 'var(--gray-a9)'}}>[Empty Paragraph]</span>}
                </Box>

                 {/* --- MODIFICATION START: Container for Icons --- */}
                 {/* Wrap icons in a Flex to control their layout and spacing */}
                 <Flex align="center" gap="1" className="flex-shrink-0 mt-0.5">
                      {/* Play Button */}
                      <IconButton
                        variant="ghost" color="gray" size="1"
                        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity p-0 h-5 w-5" // Hover visibility
                        onClick={handlePlayClick}
                        title="Play paragraph"
                        aria-label="Play paragraph"
                    >
                        <PlayIcon />
                    </IconButton>

                    {/* Edit Button */}
                    <IconButton
                        variant="ghost" color="gray" size="1"
                        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity p-0 h-5 w-5" // Hover visibility
                        onClick={handleEditClick}
                        title="Edit this paragraph"
                        aria-label="Edit paragraph"
                    >
                        <Pencil1Icon />
                    </IconButton>
                 </Flex>
                 {/* --- MODIFICATION END --- */}
            </Flex>
        </Box>
    );
}
