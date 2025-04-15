import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Box, Text, Flex, ScrollArea, Separator } from '@radix-ui/themes';
// import { starredMessagesAtom } from '../../../store'; // Removed Jotai atom
import { StarIcon, Cross1Icon } from '@radix-ui/react-icons';
import { cn } from '../../../utils';
import type { Session } from '../../../types'; // Need Session type

interface StarredTemplatesProps {
    onSelectTemplate: (text: string) => void;
    onClose: () => void;
}

export function StarredTemplatesList({ onSelectTemplate, onClose }: StarredTemplatesProps) {
    // Fetch *all* sessions to find starred messages across them.
    // This could be inefficient if there are many sessions/messages.
    // A dedicated API endpoint for starred templates would be better.
    const { data: sessions } = useQuery<Session[], Error>({ queryKey: ['sessions'] }); // Assumes sessions are cached

    const starredMessages = React.useMemo(() => {
        const allStarred: { id: number; text: string; starredName?: string }[] = [];
        if (!sessions) return allStarred;

        sessions.forEach((session) => {
            (Array.isArray(session.chats) ? session.chats : []).forEach((chat) => {
                (Array.isArray(chat.messages) ? chat.messages : []).forEach((msg) => {
                    if (msg.starred && msg.sender === 'user') { // Only show user's starred messages
                        // Ensure uniqueness just in case (shouldn't happen with unique IDs)
                        if (!allStarred.some((starred) => starred.id === msg.id)) {
                            allStarred.push({ id: msg.id, text: msg.text, starredName: msg.starredName });
                        }
                    }
                });
            });
        });
        // Optional: Sort starred messages? e.g., alphabetically by name or text
        allStarred.sort((a, b) => (a.starredName || a.text).localeCompare(b.starredName || b.text));
        return allStarred;
    }, [sessions]);

    const popoverClasses = cn(
        "absolute bottom-full mb-2 left-0 z-50",
        "w-72 max-h-60 overflow-hidden flex flex-col",
        "rounded-md border shadow-lg",
        "bg-white dark:bg-gray-900", // TODO: Use Radix Theme vars here
        "border-gray-200 dark:border-gray-700" // TODO: Use Radix Theme vars here
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
