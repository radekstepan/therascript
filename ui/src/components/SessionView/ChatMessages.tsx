import React from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { Bot, User, Loader2, Star } from '../icons/Icons';
import { Button } from '../ui/Button'; // Use new Button
import { currentChatMessagesAtom, isChattingAtom, starMessageAtom } from '../../store';
import type { ChatMessage } from '../../types';
import { cn } from '../../utils'; // Import cn

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
        // Use div with overflow and Tailwind styling
        <div
            ref={chatScrollRef as React.RefObject<HTMLDivElement>}
            // Use Tailwind classes for border, rounding, margin, overflow
            className="flex-grow border border-gray-200 dark:border-gray-700 rounded-md mb-4 overflow-y-auto p-3 bg-white dark:bg-gray-900"
        >
            <div className="space-y-3 p-1"> {/* Reduced padding inside scroll area */}
                {/* Placeholder messages */}
                {chatMessages.length === 0 && activeChatId === null && (
                    <p className="text-center text-gray-500 dark:text-gray-400 italic py-4">Start a new chat or select one from the list.</p> // Use p
                )}
                {chatMessages.length === 0 && activeChatId !== null && (
                    <p className="text-center text-gray-500 dark:text-gray-400 italic py-4">No messages yet. Start typing below.</p> // Use p
                )}
                {/* Actual messages */}
                {chatMessages.map((msg) => (
                     // Use div + flex for layout
                    <div key={msg.id} className={cn('group flex items-start gap-2', msg.sender === 'user' ? 'justify-end' : 'justify-start')}>
                         {msg.sender === 'ai' && <Bot className="h-5 w-5 text-brand-DEFAULT flex-shrink-0 mt-1" aria-hidden="true" />}
                         {/* Message bubble container - Use div + flex */}
                         <div className={cn("flex items-center max-w-[85%]", msg.sender === 'user' ? 'order-2' : 'order-1')}>
                             {/* Star button for user messages */}
                             {msg.sender === 'user' && (
                                <Button
                                    variant="ghost" // Use ghost variant
                                    size="iconXs" // Use smallest icon size
                                    // Tailwind positioning and group-hover visibility
                                    className={cn(
                                        "-ml-8 mr-1 h-6 w-6 p-0 flex items-center justify-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity",
                                        msg.starred ? "text-yellow-400 hover:text-yellow-500" : "text-gray-400 hover:text-yellow-400 dark:text-gray-500 dark:hover:text-yellow-400"
                                    )}
                                    title={msg.starred ? "Unstar message" : "Star message as template"}
                                    onClick={() => handleStarClick(msg)}
                                    aria-label={msg.starred ? "Unstar message" : "Star message"}
                                >
                                    <Star size={14} filled={!!msg.starred} />
                                </Button>
                            )}
                            {/* The actual message bubble - div + Tailwind */}
                            <div className={cn(
                                'rounded-lg p-2 px-3 text-sm break-words shadow-sm',
                                msg.sender === 'user'
                                    ? 'bg-brand-DEFAULT text-white dark:bg-brand-500 dark:text-gray-900'
                                    : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
                            )}>
                                {msg.text}
                            </div>
                        </div>
                        {msg.sender === 'user' && <User className="h-5 w-5 text-gray-400 dark:text-gray-500 flex-shrink-0 mt-1 order-1" aria-hidden="true" />}
                    </div>
                ))}
                {/* Loading indicator */}
                {isChatting && (
                    <div className="flex items-start space-x-2">
                        <Bot className="h-5 w-5 text-blue-600 flex-shrink-0 mt-1" />
                        {/* div + Tailwind for loading bubble */}
                        <div className="rounded-lg p-2 px-3 text-sm bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 italic flex items-center shadow-sm">
                            <Loader2 className="inline mr-1 h-4 w-4 animate-spin" /> Thinking...
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
