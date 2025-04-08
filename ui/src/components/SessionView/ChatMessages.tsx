import React from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { Button, Flex, Text } from '@tremor/react'; // Import Tremor
import { Bot, User, Loader2, Star } from '../icons/Icons'; // Keep icons
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
        // Replace ScrollArea with a div having overflow and border/rounding
        <div
            ref={chatScrollRef as React.RefObject<HTMLDivElement>} // Cast ref type if needed
            className="flex-grow border border-tremor-border rounded-tremor-default mb-4 overflow-y-auto p-3" // Use Tremor classes and overflow
        >
            <div className="space-y-3 p-3">
                {/* Placeholder messages */}
                {chatMessages.length === 0 && activeChatId === null && (
                    <Text className="text-center text-tremor-content-subtle italic py-4">Start a new chat or select one from the list.</Text>
                )}
                {chatMessages.length === 0 && activeChatId !== null && (
                    <Text className="text-center text-tremor-content-subtle italic py-4">No messages yet. Start typing below.</Text>
                )}
                {/* Actual messages */}
                {chatMessages.map((msg) => (
                    <Flex key={msg.id} alignItems="start" className={`group ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`} >
                        {msg.sender === 'ai' && <Bot className="h-5 w-5 text-tremor-brand flex-shrink-0 mt-1 mr-2" aria-hidden="true" />}
                        {/* Message bubble container */}
                        <Flex alignItems="center" className={`relative max-w-[85%] ${msg.sender === 'user' ? 'order-2' : 'order-1'}`}>
                             {/* Star button for user messages - position relative to the message div */}
                             {msg.sender === 'user' && (
                                <Button
                                    variant="light" // Corrected variant
                                    // size="icon" - removed
                                    // Use Tailwind for positioning and group-hover visibility
                                    className="-ml-8 mr-1 h-6 w-6 p-0 flex items-center justify-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity text-tremor-content-subtle hover:text-yellow-500" // Adjusted classes
                                    title={msg.starred ? "Unstar message" : "Star message as template"}
                                    onClick={() => handleStarClick(msg)}
                                    aria-label={msg.starred ? "Unstar message" : "Star message"}
                                    icon={() => <Star size={14} filled={!!msg.starred} className={msg.starred ? "text-yellow-500" : ""} />} // Use icon prop with function
                                >
                                     {/* Content inside button is handled by icon prop */}
                                </Button>
                            )}
                            {/* The actual message bubble */}
                            <div className={`rounded-tremor-default p-2 px-3 text-sm break-words shadow-tremor-card ${msg.sender === 'user' ? 'bg-tremor-brand text-tremor-brand-inverted' : 'bg-tremor-background-subtle text-tremor-content'}`}>
                                {msg.text}
                            </div>
                        </Flex>
                        {msg.sender === 'user' && <User className="h-5 w-5 text-tremor-content-subtle flex-shrink-0 mt-1 ml-2 order-1" aria-hidden="true" />}
                    </Flex>
                ))}
                {/* Loading indicator */}
                {isChatting && (
                    <div className="flex items-start space-x-2">
                        <Bot className="h-5 w-5 text-blue-600 flex-shrink-0 mt-1" />
                        <div className="rounded-tremor-default p-2 px-3 text-sm bg-tremor-background-subtle text-tremor-content italic flex items-center">
                            <Loader2 className="inline mr-1 h-4 w-4 animate-spin" /> Thinking...
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
