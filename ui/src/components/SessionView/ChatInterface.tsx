import React, { useRef } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useParams, useNavigate } from 'react-router-dom';
import { ChatHeader, ChatMessages, ChatInput } from './';
import { activeSessionAtom, startNewChatAtom, chatErrorAtom, activeChatIdAtom } from '../../store';
import { Loader2 } from '../icons/Icons';
import { cn } from '../../utils'; // Import cn

export function ChatInterface() {
    const { chatId } = useParams<{ chatId?: string }>();
    const navigate = useNavigate();
    const session = useAtomValue(activeSessionAtom);
    const startNewChatAction = useSetAtom(startNewChatAtom);
    const setChatError = useSetAtom(chatErrorAtom);
    const activeChatId = useAtomValue(activeChatIdAtom);
    const chatScrollRef = useRef<HTMLDivElement | null>(null);

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
         // Replace Flex with div + Tailwind
         return (
             <div className="flex flex-grow p-4 justify-center items-center">
                  <Loader2 className="h-6 w-6 animate-spin text-gray-400 dark:text-gray-500" />
                  {/* Replace Text with p */}
                  <p className="ml-2 text-gray-500 dark:text-gray-400">Loading chat...</p>
              </div>
        );
     }

    return (
        // Replace Flex with div + Tailwind for layout
        <div className={cn("flex flex-col flex-grow min-h-0 h-full")}>
             <ChatHeader
                activeChatId={activeChatId}
                onNewChatClick={handleNewChatClick}
             />
             {/* Replace Divider with hr */}
             <hr className="flex-shrink-0 my-0 border-gray-200 dark:border-gray-700" />
             {/* Chat Content Wrapper - Replace Flex with div */}
             <div className={cn("flex flex-col flex-grow space-y-4 overflow-hidden min-h-0 p-4")}>
                <ChatMessages
                    chatScrollRef={chatScrollRef}
                    activeChatId={activeChatId}
                />
                <ChatInput />
            </div>
        </div>
    );
}
