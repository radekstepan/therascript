import React from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { ScrollArea } from '../ui/ScrollArea';
import { Button } from '../ui/Button';
import { Bot, User, Loader2, Star } from '../icons/Icons';
import { currentChatMessagesAtom, isChattingAtom, starMessageAtom } from '../../store';
import type { ChatMessage } from '../../types';

interface ChatMessagesProps {
    chatScrollRef: React.RefObject<HTMLDivElement | null>;
    activeChatId: number | null;
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
        <ScrollArea className="flex-grow border rounded-md mb-4" elRef={chatScrollRef}>
            <div className="space-y-3 p-3">
                {/* Placeholder messages */}
                {chatMessages.length === 0 && activeChatId === null && (
                    <p className="text-center text-gray-500 italic py-4">Start a new chat or select one from the list below.</p>
                )}
                {chatMessages.length === 0 && activeChatId !== null && (
                    <p className="text-center text-gray-500 italic py-4">No messages in this chat yet. Start typing below.</p>
                )}
                {/* Actual messages */}
                {chatMessages.map((msg) => (
                    <div key={msg.id} className={`flex items-start space-x-2 group ${msg.sender === 'user' ? 'justify-end' : ''}`}>
                        {msg.sender === 'ai' && <Bot className="h-5 w-5 text-blue-600 flex-shrink-0 mt-1" />}
                        {/* Message bubble container */}
                        <div className={`relative rounded-lg p-2 px-3 text-sm max-w-[85%] break-words shadow-sm ${msg.sender === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-800'}`}>
                            {/* 7. Star button - Adjust positioning */}
                            {msg.sender === 'user' && (
                                <Button
                                    variant="ghost" size="icon"
                                    // Center vertically: top-1/2 and transform -translate-y-1/2
                                    // Adjust left offset as needed (e.g., -left-8 or less)
                                    // Ensure button size is appropriate (h-6 w-6 p-1)
                                    className="absolute -left-8 top-1/2 transform -translate-y-1/2 h-6 w-6 p-1 opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-yellow-500 focus:opacity-100" // Added focus:opacity-100
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
                {/* Loading indicator */}
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

// Add missing CSS utility classes if needed in global.css
/*
.top-1\/2 { top: 50%; }
.transform { transform: translate(var(--tw-translate-x, 0), var(--tw-translate-y, 0)) rotate(var(--tw-rotate, 0)) skewX(var(--tw-skew-x, 0)) skewY(var(--tw-skew-y, 0)) scaleX(var(--tw-scale-x, 1)) scaleY(var(--tw-scale-y, 1)); }
.\-translate-y-1\/2 { --tw-translate-y: -50%; }
.focus\:opacity-100:focus { opacity: 1; }
*/
