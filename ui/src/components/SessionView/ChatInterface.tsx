// src/components/SessionView/ChatInterface.tsx
import React, { useRef } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useParams, useNavigate } from 'react-router-dom';
// Removed Card imports
import { Card, Flex, Text, Divider } from '@tremor/react'; // Import Tremor
import { ChatHeader, ChatMessages, ChatInput } from './'; // Import siblings
import { activeSessionAtom, startNewChatAtom, chatErrorAtom, activeChatIdAtom } from '../../store'; // Added activeChatIdAtom
import { Loader2 } from '../icons/Icons'; // Keep icon import

export function ChatInterface() {
    // Removed sessionId param as it's less relevant here now
    const { chatId } = useParams<{ chatId?: string }>();
    const navigate = useNavigate();
    const session = useAtomValue(activeSessionAtom);
    const startNewChatAction = useSetAtom(startNewChatAtom);
    const setChatError = useSetAtom(chatErrorAtom);
    const activeChatId = useAtomValue(activeChatIdAtom); // Read atom for consistency
    const chatScrollRef = useRef<HTMLDivElement | null>(null);
    // const activeChatIdNum = chatId ? parseInt(chatId, 10) : null; // Use atom value

     const handleNewChatClick = async () => {
        const currentSessionId = session?.id;
        if (currentSessionId) {
            const result = await startNewChatAction({ sessionId: currentSessionId });
            if (result.success) {
                navigate(`/sessions/${currentSessionId}/chats/${result.newChatId}`);
            } else {
                 setChatError(result.error);
            }
        } else {
            setChatError("Cannot start new chat: Session context is missing.");
        }
    };

     if (activeChatId === null) {
         // This might indicate loading or an issue, SessionView should ideally handle this state
         return (
             <Flex className="flex-grow p-4" justifyContent="center" alignItems="center">
                  <Loader2 className="h-6 w-6 animate-spin text-tremor-content-subtle" />
                  <Text className="ml-2 text-tremor-content-subtle">Loading chat...</Text>
              </Flex>
        );
     }

    return (
        // Use Flex column for layout. ChatInterface is now expected to be INSIDE a Card in SessionView.
        // Apply h-full and min-h-0 to ensure it fills the parent Card.
        <Flex flexDirection="col" className="flex-grow min-h-0 h-full">
             <ChatHeader
                activeChatId={activeChatId} // Use atom value
                onNewChatClick={handleNewChatClick}
             />
             <Divider className="flex-shrink-0 my-0" /> {/* Use Tremor Divider */}
             {/* Chat Content Wrapper */}
             {/* Added px-4 pb-4 for padding, removed pt-4 as header/divider has padding */}
             <Flex flexDirection="col" className="flex-grow space-y-4 overflow-hidden min-h-0 p-4">
                <ChatMessages
                    chatScrollRef={chatScrollRef}
                    activeChatId={activeChatId} // Use atom value
                />
                <ChatInput />
            </Flex> {/* Added missing closing tag */}
        </Flex>
        // Removed outer Card/CardContent. Parent SessionView provides the Card.
    );
}
