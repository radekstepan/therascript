import React, { useState, useRef, useEffect, Dispatch, SetStateAction } from 'react';
import { Button, TextArea, Flex, Box, IconButton } from '@radix-ui/themes';
import { Pencil1Icon, CheckIcon, Cross1Icon, PlayIcon, UpdateIcon } from '@radix-ui/react-icons';
import { cn } from '../../utils';

interface TranscriptParagraphProps {
    paragraph: string;
    index: number;
    // onSave accepts index and text, returns Promise (for mutation)
    onSave: (index: number, newText: string) => Promise<void> | void;
    activeEditIndex: number | null;
    setActiveEditIndex: Dispatch<SetStateAction<number | null>>;
    isSaving: boolean; // Add prop to indicate saving state for this paragraph
}

export function TranscriptParagraph({
    paragraph,
    index,
    onSave,
    activeEditIndex,
    setActiveEditIndex,
    isSaving, // Use the prop
}: TranscriptParagraphProps) {
    const [editValue, setEditValue] = useState(paragraph);
    const containerRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
    const isEditing = activeEditIndex === index;

    // Update dimensions and focus textarea when editing starts
    useEffect(() => {
        if (isEditing && containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            setDimensions({
                width: rect.width,
                height: rect.height
            });
            // Focus and select text in the textarea when it becomes visible
             requestAnimationFrame(() => { // Ensure textarea is rendered
                 if(textareaRef.current) {
                     textareaRef.current.focus();
                     textareaRef.current.select();
                 }
             });
        }
        // Reset editValue if the paragraph prop changes externally while not editing this specific item
        if (!isEditing && paragraph !== editValue) {
            setEditValue(paragraph);
        }
    }, [isEditing, paragraph]); // Rerun effect if isEditing or paragraph changes


    const handleEditClick = () => {
        setEditValue(paragraph); // Ensure edit starts with the current, potentially updated, paragraph value
        setActiveEditIndex(index); // Set this paragraph as the one being edited
    };

    const handleCancel = () => {
        if (isSaving) return; // Don't cancel if currently saving
        setActiveEditIndex(null); // Exit edit mode for this paragraph
        setEditValue(paragraph); // Reset textarea value to original on cancel
    };

    // Make handleSave async to potentially await the onSave prop
    const handleSave = async () => {
        const trimmedValue = editValue.trim();
        if (isSaving) return; // Prevent double save

        // Only call save if the trimmed text actually changed
        if (trimmedValue !== paragraph.trim()) {
            try {
                // Call the async onSave function passed from parent (likely triggers mutation)
                await onSave(index, trimmedValue);
                // Parent's mutation's onSuccess handler should call setActiveEditIndex(null)
            } catch (error) {
                // Error handling might be done within the mutation's onError
                console.error(`Error saving paragraph ${index} from TranscriptParagraph:`, error);
            }
        } else {
            // If no change, just close edit mode
            setActiveEditIndex(null);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            handleSave(); // Trigger save on Ctrl/Cmd+Enter
        } else if (e.key === 'Escape') {
            e.preventDefault();
            handleCancel(); // Trigger cancel on Escape
        }
    };

    // Placeholder for play functionality
    const handlePlayClick = () => {
        console.log(`▶️ Simulate PLAY event for paragraph index ${index}: "${paragraph.substring(0, 70)}..."`);
        // TODO Add actual audio playback logic here if needed
    };

    // Common text styles for display and edit modes
    // TODO these should be outside of this component
    const textStyles = {
        whiteSpace: 'pre-wrap' as const,
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--font-size-2)', // Use theme font size
        lineHeight: 'var(--line-height-3)', // Use theme line height
        wordBreak: 'break-word' as const,
        color: 'var(--gray-a12)', // Use theme text color
    };

    // Function to render the paragraph content (visible or hidden for layout)
    const renderContent = (isVisible: boolean = true) => (
        <Flex align="start" gap="2" className="group p-1" style={{ visibility: isVisible ? 'visible' : 'hidden' }}>
            <Box
                as="div"
                className="flex-grow" // Takes available space
                style={textStyles}
            >
                {/* TODO handle empty paragraphs on the backend and trim them too */}
                {paragraph.trim() ? paragraph : <span style={{ fontStyle: 'italic', color: 'var(--gray-a9)'}}>[Empty Paragraph]</span>}
            </Box>
            {/* Action Icons */}
            <Flex align="center" gap="1" className="flex-shrink-0 mt-0.5">
                 {/* Play Button */}
                <IconButton
                    variant="ghost"
                    color="gray"
                    size="1"
                    className={cn(
                        "transition-opacity p-0 h-5 w-5",
                        !isEditing && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100" // Show on hover/focus when not editing
                    )}
                    onClick={handlePlayClick}
                    title="Play paragraph (Not Implemented)"
                    aria-label="Play paragraph"
                    disabled={isEditing} // Disable while editing this one
                >
                    <PlayIcon />
                </IconButton>
                {/* Edit Button */}
                <IconButton
                    variant="ghost"
                    color="gray"
                    size="1"
                    className={cn(
                        "transition-opacity p-0 h-5 w-5",
                         !isEditing && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100" // Show on hover/focus when not editing
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
            className={cn(
                "rounded transition-colors duration-150",
                // Apply hover background only when NOT editing this specific paragraph
                !isEditing && "hover:bg-[--gray-a3]"
             )}
            style={{ position: 'relative' }} // Positioning context for the editor overlay
        >
            {isEditing ? (
                <>
                    {/* Editor Overlay */}
                    <Box
                        style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            zIndex: 10,
                            padding: 'var(--space-1)',
                            backgroundColor: 'var(--color-panel-solid)',
                            borderRadius: 'var(--radius-2)',
                            boxShadow: 'var(--shadow-3)',
                            border: `1px solid var(--gray-a6)`
                        }}
                        // Prevent click propagation to avoid exiting edit mode accidentally
                        onClick={(e) => e.stopPropagation()}
                    >
                        <Flex direction="column" gap="2">
                            <TextArea
                                ref={textareaRef}
                                value={editValue}
                                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setEditValue(e.target.value)}
                                placeholder="Enter paragraph text..."
                                size="2"
                                style={{
                                    ...textStyles,
                                    width: '100%',
                                    minHeight: dimensions.height > 50 ? `${dimensions.height}px` : '80px', // Ensure a minimum height, use measured height if larger
                                    backgroundColor: 'var(--color-panel-translucent)', // Slightly different bg for textarea? Or keep solid.
                                    resize: 'vertical', // Allow vertical resize
                                    boxSizing: 'border-box',
                                    borderRadius: 'var(--radius-2)',
                                    border: '1px solid var(--gray-a7)', // Internal border for textarea
                                }}
                                onKeyDown={handleKeyDown}
                                aria-label={`Edit paragraph ${index + 1}`}
                                disabled={isSaving} // Disable textarea while saving
                            />
                            <Flex justify="end" gap="2" mt="1">
                                <Button onClick={handleCancel} size="1" variant="soft" color="gray" title="Cancel (Esc)" disabled={isSaving}>
                                    <Cross1Icon /> Cancel
                                </Button>
                                <Button onClick={handleSave} size="1" variant="solid" title="Save (Ctrl+Enter)" disabled={isSaving}>
                                    {isSaving ? (
                                        <UpdateIcon className="animate-spin" /> // Show spinner icon
                                    ) : (
                                        <CheckIcon />
                                    )} Save
                                </Button>
                            </Flex>
                        </Flex>
                    </Box>
                    {/* Render original content invisibly below overlay to maintain layout space */}
                    {renderContent(false)}
                </>
            ) : (
                // Render the visible content when not editing
                renderContent(true)
            )}
        </Box>
    );
}
