import React from 'react';
import { useAtomValue } from 'jotai';
import { Button, Box, Text, Flex, ScrollArea, Separator } from '@radix-ui/themes';
import { starredMessagesAtom } from '../../../store'; // Adjusted path
import { StarIcon, Cross1Icon } from '@radix-ui/react-icons';
import { cn } from '../../../utils'; // Adjusted path

interface StarredTemplatesProps {
    onSelectTemplate: (text: string) => void;
    onClose: () => void;
}

export function StarredTemplatesList({ onSelectTemplate, onClose }: StarredTemplatesProps) {
    const starredMessages = useAtomValue(starredMessagesAtom);

    const popoverClasses = cn(
        "absolute bottom-full mb-2 right-0 z-50",
        "w-72 max-h-60 overflow-hidden flex flex-col",
        "rounded-md border shadow-lg",
        "bg-white dark:bg-gray-900",
        "border-gray-200 dark:border-gray-700"
    );

    return (
        <Box className={popoverClasses}>
             <Flex justify="between" align="center" p="2" flexShrink="0" className="border-b">
                 <Text size="1" weight="medium" color="gray">Starred Templates</Text>
                 <Button variant="ghost" size="1" color="gray" onClick={onClose} highContrast>
                    <Cross1Icon/>
                </Button>
             </Flex>
             <ScrollArea type="auto" scrollbars="vertical" style={{ flexGrow: 1 }}>
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
