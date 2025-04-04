// src/components/SessionView/ChatMessages.tsx
import React from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { ScrollArea } from '../ui/ScrollArea';
import { Button } from '../ui/Button';
import { Bot, User, Loader2, Star } from '../icons/Icons';
import { currentChatMessagesAtom, isChattingAtom, starMessageAtom } from '../../store';
import type { ChatMessage } from '../../types';

interface ChatMessagesProps {
    // FIX: Allow the ref object's current property to potentially be null
    chatScrollRef: React.RefObject<HTMLDivElement | null>;
    activeChatId: number | null; // For placeholder text logic
}

export function ChatMessages({ chatScrollRef, activeChatId }: ChatMessagesProps) {
    const chatMessages = useAtomValue(currentChatMessagesAtom);
    const isChatting = useAtomValue(isChattingAtom);
    const starMessageAction = useSetAtom(starMessageAtom);

    const handleStarClick = (message: ChatMessage) => {
        if (activeChatId !== null) {
            starMessageAction({
                chatId: activeChatId,
                messageId: message.id,
                shouldStar: !message.starred
            });
        } else {
            console.warn("Cannot star message: No active chat selected.");
        }
    };

    return (
        // Pass the ref to ScrollArea's elRef prop. ScrollArea should handle the possibility of null.
        <ScrollArea className="flex-grow border rounded-md mb-4" elRef={chatScrollRef}>
            <div className="space-y-3 p-3">
                {chatMessages.length === 0 && activeChatId === null && (
                    <p className="text-center text-gray-500 italic py-4">Start a new chat or select one from the list below.</p>
                )}
                {chatMessages.length === 0 && activeChatId !== null && (
                    <p className="text-center text-gray-500 italic py-4">No messages in this chat yet. Start typing below.</p>
                )}
                {chatMessages.map((msg) => (
                    <div key={msg.id} className={`flex items-start space-x-2 group ${msg.sender === 'user' ? 'justify-end' : ''}`}>
                        {msg.sender === 'ai' && <Bot className="h-5 w-5 text-blue-600 flex-shrink-0 mt-1" />}
                        <div className={`relative rounded-lg p-2 px-3 text-sm max-w-[85%] break-words shadow-sm ${msg.sender === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-800'}`}>
                            {msg.sender === 'user' && (
                                <Button
                                    variant="ghost" size="icon"
                                    className="absolute -left-9 top-0 h-6 w-6 p-1 opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-yellow-500"
                                    title={msg.starred ? "Unstar message" : "Star message as template"}
                                    onClick={() => handleStarClick(msg)}
                                    aria-label={msg.starred ? "Unstar message" : "Star message"}
                                >
                                    <Star size={14} filled={!!msg.starred} className={msg.starred ? "text-yellow-500" : ""} />
                                </Button>
                            )}
                            {msg.text}
                        </div>
                        {msg.sender === 'user' && <User className="h-5 w-5 text-gray-500 flex-shrink-0 mt-1" />}
                    </div>
                ))}
                {isChatting && (
                    <div className="flex items-start space-x-2">
                        <Bot className="h-5 w-5 text-blue-600 flex-shrink-0 mt-1" />
                        <div className="rounded-lg p-2 px-3 text-sm bg-gray-200 text-gray-800 italic flex items-center">
                            <Loader2 className="inline mr-1 h-4 w-4 animate-spin" /> Thinking...
                        </div>
                    </div>
                )}
            </div>
        </ScrollArea>
    );
}
