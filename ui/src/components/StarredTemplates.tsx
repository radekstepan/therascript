import React from 'react';
import { useAtomValue } from 'jotai';
import { Button, Box, Text, Flex, ScrollArea, Separator } from '@radix-ui/themes'; // Use Themes components
import { starredMessagesAtom } from '../store';
import { StarIcon, Cross1Icon } from '@radix-ui/react-icons';
import type { StarredTemplatesProps } from '../types';
import { cn } from '../utils';

export function StarredTemplatesList({ onSelectTemplate, onClose }: StarredTemplatesProps) {
    const starredMessages = useAtomValue(starredMessagesAtom);

    // Using Box for the popover container
    const popoverClasses = cn(
        "absolute bottom-full mb-2 right-0 z-10",
        "w-72 max-h-60 overflow-hidden flex flex-col", // Flex direction column
        "rounded-md border shadow-lg", // Keep base structure classes
        // Explicit background and border for solid appearance in light/dark modes:
        "bg-white dark:bg-gray-900", // Example: White/Dark Gray background
        "border-gray-200 dark:border-gray-700" // Example: Matching border
    );

    return (
        <Box className={popoverClasses}>
             <Flex justify="between" align="center" p="2" flexShrink="0" className="border-b">
                 <Text size="1" weight="medium" color="gray">Starred Templates</Text>
                 <Button variant="ghost" size="1" color="gray" onClick={onClose} highContrast>
                    <Cross1Icon/> {/* Use icon directly */}
                </Button>
             </Flex>
             {/* ScrollArea for the list */}
             <ScrollArea type="auto" scrollbars="vertical" style={{ flexGrow: 1 }}> {/* Use flexGrow */}
                 <Box p="1">
                    {(!starredMessages || starredMessages.length === 0) ? (
                         <Flex align="center" justify="center" p="4" style={{ minHeight: 80 }}>
                             <Text size="2" color="gray" align="center">
                                No starred messages yet. Star a user message to create a template.
                             </Text>
                         </Flex>
                    ) : (
                        starredMessages.map(msg => {
                            const displayName = msg.starredName || (msg.text.substring(0, 50) + (msg.text.length > 50 ? '...' : ''));
                            return (
                                <Button
                                    key={msg.id}
                                    variant="ghost"
                                    onClick={() => onSelectTemplate(msg.text)}
                                    className="block w-full h-auto text-left p-2 text-sm rounded whitespace-normal justify-start" // Keep some Tailwind for layout
                                    style={{ whiteSpace: 'normal', justifyContent: 'flex-start', textAlign: 'left' }} // Ensure multiline works
                                    title={`Insert: "${msg.text.substring(0, 100)}${msg.text.length > 100 ? '...' : ''}"`}
                                    size="2" // Themes size
                                 >
                                    {/* Display the name or snippet */}
                                    {displayName}
                                </Button>
                            );
                         })
                     )}
                 </Box>
            </ScrollArea>
        </Box>
    );
}
