/* packages/ui/src/components/SessionView/Chat/StarredTemplatesList.tsx */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Box, Text, Flex, ScrollArea, Separator, Spinner } from '@radix-ui/themes'; // Added Spinner
import { StarIcon, Cross1Icon, InfoCircledIcon } from '@radix-ui/react-icons';
import { cn } from '../../../utils';
import type { ChatMessage } from '../../../types'; // Only need ChatMessage
import { fetchStarredMessages } from '../../../api/api'; // Import API function

interface StarredTemplatesProps {
    onSelectTemplate: (text: string) => void;
    onClose: () => void;
}

export function StarredTemplatesList({ onSelectTemplate, onClose }: StarredTemplatesProps) {
    // --- Fetch starred messages using React Query ---
    const { data: starredMessages, isLoading, error } = useQuery<ChatMessage[], Error>({
        queryKey: ['starredMessages'], // Unique query key
        queryFn: fetchStarredMessages, // Call the new API function
        staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    });
    // --- End Fetch ---

    const popoverClasses = cn(
        "absolute bottom-full mb-2 left-0 z-50",
        "w-72 max-h-60 overflow-hidden flex flex-col",
        "rounded-md border shadow-lg",
        "bg-[--color-panel-solid] border-[--gray-a6]"
    );

    return (
        <Box className={popoverClasses} style={{ backgroundColor: 'var(--color-panel-solid)', borderColor: 'var(--gray-a6)' }}>
             <Flex justify="between" align="center" p="2" flexShrink="0" className="border-b" style={{ borderColor: 'var(--gray-a6)'}}>
                 <Text size="1" weight="medium" color="gray">Starred Templates</Text>
                 <Button variant="ghost" size="1" color="gray" onClick={onClose} highContrast>
                    <Cross1Icon/>
                </Button>
             </Flex>
             <ScrollArea type="auto" scrollbars="vertical" style={{ flexGrow: 1 }}>
                 <Box p="1">
                    {isLoading ? (
                        <Flex align="center" justify="center" p="4" style={{ minHeight: 80 }}>
                            <Spinner size="2"/> <Text ml="2" size="2" color="gray">Loading...</Text>
                        </Flex>
                    ) : error ? (
                         <Flex align="center" justify="center" p="4" style={{ minHeight: 80 }}>
                            <InfoCircledIcon className="text-red-500 mr-2" />
                            <Text size="1" color="red">Error: {error.message}</Text>
                         </Flex>
                     ) : !starredMessages || starredMessages.length === 0 ? (
                         <Flex align="center" justify="center" p="4" style={{ minHeight: 80 }}>
                             <Text size="2" color="gray" align="center">
                                No starred messages found. <br/> Click the ☆ next to a user message to save it as a template.
                             </Text>
                         </Flex>
                    ) : (
                        // Sort messages by name or text snippet
                        [...starredMessages]
                            .sort((a, b) => (a.starredName || a.text).localeCompare(b.starredName || b.text))
                            .map(msg => {
                                const displayName = msg.starredName || (msg.text.substring(0, 50) + (msg.text.length > 50 ? '...' : ''));
                                return (
                                    <Button
                                        key={msg.id}
                                        variant="ghost"
                                        onClick={() => onSelectTemplate(msg.text)}
                                        className="block w-full h-auto text-left p-2 text-sm rounded whitespace-normal justify-start"
                                        style={{ whiteSpace: 'normal', justifyContent: 'flex-start', textAlign: 'left' }}
                                        title={`Insert: "${msg.text.substring(0, 100)}${msg.text.length > 100 ? '...' : ''}"`}
                                        size="2"
                                    >
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
