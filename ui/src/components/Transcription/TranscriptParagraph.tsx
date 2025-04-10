// src/components/Transcription/TranscriptParagraph.tsx
import React, { useState, useRef, useEffect, Dispatch, SetStateAction } from 'react';
import { Button, TextArea, Flex, Box, IconButton } from '@radix-ui/themes';
import { Pencil1Icon, CheckIcon, Cross1Icon, PlayIcon } from '@radix-ui/react-icons';
import { cn } from '../../utils';

interface TranscriptParagraphProps {
    paragraph: string;
    index: number;
    onSave: (index: number, newText: string) => void;
    activeEditIndex: number | null;
    setActiveEditIndex: Dispatch<SetStateAction<number | null>>;
}

export function TranscriptParagraph({
    paragraph,
    index,
    onSave,
    activeEditIndex,
    setActiveEditIndex
}: TranscriptParagraphProps) {
    const [editValue, setEditValue] = useState(paragraph);
    const containerRef = useRef<HTMLDivElement>(null);
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
    const isEditing = activeEditIndex === index;

    useEffect(() => {
        // Update dimensions whenever isEditing becomes true
        if (isEditing && containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            setDimensions({
                width: rect.width,
                height: rect.height
            });
        }
        // Reset editValue if paragraph changes while not editing this specific item
        if (!isEditing) {
            setEditValue(paragraph);
        }
    }, [isEditing, paragraph]); // Add paragraph dependency to reset editValue if needed

    const handleEditClick = () => {
        setEditValue(paragraph); // Ensure edit starts with current paragraph value
        setActiveEditIndex(index);
    };

    const handleCancel = () => {
        setActiveEditIndex(null);
        // Optionally reset editValue, although useEffect handles external changes
        // setEditValue(paragraph);
    };

    const handleSave = () => {
        // Trim whitespace and check if it actually changed
        const trimmedValue = editValue.trim();
        if (trimmedValue !== paragraph.trim()) {
            onSave(index, trimmedValue);
        }
        setActiveEditIndex(null);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault(); handleSave();
        } else if (e.key === 'Escape') {
            e.preventDefault(); handleCancel();
        }
    };

    const handlePlayClick = () => {
        console.log(`▶️ Simulate PLAY event for paragraph index ${index}: "${paragraph.substring(0, 70)}..."`);
    };

    const textStyles = {
        whiteSpace: 'pre-wrap' as const,
        fontFamily: 'var(--font-mono)',
        lineHeight: 'var(--line-height-4)',
        wordBreak: 'break-word' as const,
    };

    // Function to render the paragraph content (visible or hidden)
    const renderContent = (isVisible: boolean = true) => (
        <Flex align="start" gap="2" className="group p-1" style={{ visibility: isVisible ? 'visible' : 'hidden' }}>
            <Box
                as="div"
                className="text-sm text-[--gray-a12] flex-grow"
                style={textStyles}
            >
                {paragraph || <span style={{ fontStyle: 'italic', color: 'var(--gray-a9)'}}>[Empty Paragraph]</span>}
            </Box>
            <Flex align="center" gap="1" className="flex-shrink-0 mt-0.5">
                <IconButton
                    variant="ghost"
                    color="gray"
                    size="1"
                    className={cn(
                        "transition-opacity p-0 h-5 w-5",
                         // Only show hover effect if not editing THIS paragraph
                        !isEditing && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    )}
                    onClick={handlePlayClick}
                    title="Play paragraph"
                    aria-label="Play paragraph"
                    disabled={isEditing} // Disable while editing this one
                >
                    <PlayIcon />
                </IconButton>
                <IconButton
                    variant="ghost"
                    color="gray"
                    size="1"
                    className={cn(
                        "transition-opacity p-0 h-5 w-5",
                         // Only show hover effect if not editing THIS paragraph
                        !isEditing && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    )}
                    onClick={handleEditClick}
                    title="Edit this paragraph"
                    aria-label="Edit paragraph"
                    disabled={isEditing} // Disable while editing this one
                >
                    <Pencil1Icon />
                </IconButton>
            </Flex>
        </Flex>
    );

    return (
        <Box
            ref={containerRef}
            // Apply hover background only when NOT editing this specific paragraph
            className={cn(
                "rounded transition-colors duration-150",
                !isEditing && "hover:bg-[--gray-a3]"
             )}
            style={{ position: 'relative' }} // Keep as positioning context
        >
            {isEditing ? (
                <>
                    {/* Edit mode overlay with solid background */}
                    <Box
                        style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%', // Cover the container
                            zIndex: 10,
                            padding: 'var(--space-1)', // Use theme spacing, matches p-1 class
                            // --- SOLID BACKGROUND ---
                            backgroundColor: 'var(--color-panel-solid)', // Use Radix solid panel color
                            // ------------------------
                            borderRadius: 'var(--radius-2)', // Match container rounding
                            boxShadow: 'var(--shadow-3)', // Add shadow for visual separation
                        }}
                    >
                        <Flex direction="column" gap="2">
                            <TextArea
                                value={editValue}
                                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setEditValue(e.target.value)}
                                placeholder="Enter paragraph text..."
                                size="2" // Use Radix size prop for padding etc.
                                style={{
                                    ...textStyles, // Keep text formatting consistent
                                    width: '100%', // Fill the overlay box width
                                    // Use minHeight based on original content, allows expansion
                                    minHeight: dimensions.height > 0 ? `${dimensions.height}px` : 'auto',
                                    // Match overlay background or let it use default TextArea bg
                                    backgroundColor: 'var(--color-panel-solid)',
                                    resize: 'none',
                                    boxSizing: 'border-box',
                                    borderRadius: 'var(--radius-2)', // Consistent rounding
                                    border: '1px solid var(--gray-a6)', // Slightly more visible border
                                    color: 'var(--gray-a12)', // Ensure text color contrasts
                                    // Remove explicit padding: '8px', rely on size="2"
                                }}
                                autoFocus // Focus the textarea when it appears
                                onFocus={(e) => e.currentTarget.select()} // Select text on focus
                                onKeyDown={handleKeyDown}
                                aria-label={`Edit paragraph ${index + 1}`}
                            />
                            <Flex justify="end" gap="2" mt="1">
                                <Button onClick={handleCancel} size="1" variant="soft" color="gray" title="Cancel (Esc)">
                                    <Cross1Icon /> Cancel
                                </Button>
                                <Button onClick={handleSave} size="1" variant="solid" title="Save (Ctrl+Enter)">
                                    <CheckIcon /> Save
                                </Button>
                            </Flex>
                        </Flex>
                    </Box>
                    {/* Render the original content invisibly to maintain layout space */}
                    {renderContent(false)}
                </>
            ) : (
                // Render the visible content when not editing
                renderContent(true)
            )}
        </Box>
    );
}
