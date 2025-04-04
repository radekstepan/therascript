// src/components/SessionView/ChatInterface.tsx
import React, { useRef } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useParams, useNavigate } from 'react-router-dom';
// Removed Card imports
import { ChatHeader, ChatMessages, ChatInput } from './'; // Import siblings
import { activeSessionAtom, startNewChatAtom, chatErrorAtom, activeChatIdAtom } from '../../store'; // Added activeChatIdAtom
import { Loader2 } from '../icons/Icons';

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
            <div className="flex-grow flex items-center justify-center p-4">
                 <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                 <span className="ml-2 text-gray-500">Loading chat...</span>
             </div>
        );
     }

    return (
        // Removed outer Card/CardContent. Use flex column for layout.
        <div className="flex-grow flex flex-col min-h-0 h-full">
             <ChatHeader
                activeChatId={activeChatId} // Use atom value
                onNewChatClick={handleNewChatClick}
             />
             <hr className="border-gray-200 flex-shrink-0" /> {/* Ensure hr doesn't grow */}
             {/* Chat Content Wrapper */}
             <div className="flex-grow flex flex-col space-y-4 overflow-hidden min-h-0 p-4 pt-4">
                <ChatMessages
                    chatScrollRef={chatScrollRef}
                    activeChatId={activeChatId} // Use atom value
                />
                <ChatInput />
            </div>
        </div>
    );
}
