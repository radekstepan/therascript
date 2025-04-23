/* packages/ui/src/components/SessionView/Chat/StarredTemplates.tsx */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Box, Text, Flex, ScrollArea, Separator } from '@radix-ui/themes';
import { StarIcon, Cross1Icon } from '@radix-ui/react-icons';
import { cn } from '../../../utils';
import type { Session, ChatSession, ChatMessage } from '../../../types'; // Need Session type

interface StarredTemplatesProps {
    onSelectTemplate: (text: string) => void;
    onClose: () => void;
}

export function StarredTemplatesList({ onSelectTemplate, onClose }: StarredTemplatesProps) {
    // TODO: This component is temporarily broken because fetchSessions no longer fetches
    // full chat messages for performance reasons. A dedicated API endpoint is needed
    // to fetch *only* starred messages/templates.
    // const { data: sessions } = useQuery<Session[], Error>({ queryKey: ['sessions'] });
    const sessions: Session[] = []; // Temporary empty data

    const starredMessages = React.useMemo(() => {
        const allStarred: { id: number; text: string; starredName?: string }[] = [];
        if (!sessions) return allStarred;

        // This logic will not run correctly until sessions include full message data again
        // or a new endpoint is used.
        sessions.forEach((session) => {
            (Array.isArray(session.chats) ? session.chats : []).forEach((chat) => {
                 // We need the full ChatSession with messages here, but Session type only has metadata
                 // This check will likely always fail now as chat.messages doesn't exist on the Pick<> type
                 // The `as ChatSession` cast is a temporary workaround to satisfy TS, but the logic is flawed
                 if (Array.isArray((chat as ChatSession).messages)) {
                    (chat as ChatSession).messages!.forEach((msg: ChatMessage) => {
                        if (msg.starred && msg.sender === 'user') {
                            if (!allStarred.some((starred) => starred.id === msg.id)) {
                                allStarred.push({ id: msg.id, text: msg.text, starredName: msg.starredName });
                            }
                        }
                    });
                 }
            });
        });
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
                                {/* TODO: Update this message or remove the feature until fixed */}
                                Starred messages unavailable (needs API update).
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
