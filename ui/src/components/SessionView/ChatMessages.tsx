// src/components/SessionView/ChatMessages.tsx
import React, { useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { Bot, User, Loader2, Star, Check, X } from '../icons/Icons';
import { Button } from '../ui/Button'; // Use new Button
import { Input } from '../ui/Input'; // Use new Input
import { Label } from '../ui/Label'; // Use new Label
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '../ui/Dialog'; // Import Dialog components
import { currentChatMessagesAtom, isChattingAtom, starMessageAtom, activeChatIdAtom } from '../../store';
import type { ChatMessage } from '../../types';
import { cn } from '../../utils'; // Import cn

interface ChatMessagesProps {
    chatScrollRef: React.RefObject<HTMLDivElement | null>;
    activeChatId: number | null; // Keep this prop
}

export function ChatMessages({ chatScrollRef, activeChatId }: ChatMessagesProps) {
    const chatMessages = useAtomValue(currentChatMessagesAtom);
    const isChatting = useAtomValue(isChattingAtom);
    const starMessageAction = useSetAtom(starMessageAtom);
    // activeChatId is needed for the star action payload, so get it directly or keep the prop

    // State for the naming dialog
    const [isNamingDialogOpen, setIsNamingDialogOpen] = useState(false);
    const [messageToName, setMessageToName] = useState<ChatMessage | null>(null);
    const [templateNameInput, setTemplateNameInput] = useState('');

    const handleStarClick = (message: ChatMessage) => {
        if (activeChatId === null) {
            console.warn("Cannot star/unstar message: No active chat selected.");
            return;
        }

        if (message.starred) {
            // --- Unstarring ---
            starMessageAction({
                chatId: activeChatId,
                messageId: message.id,
                shouldStar: false
                // No name needed when unstarring
            });
        } else {
            // --- Starring ---
            // Open the dialog to get a name
            setMessageToName(message);
            // Suggest a name based on the first part of the message
            setTemplateNameInput(message.text.substring(0, 50) + (message.text.length > 50 ? '...' : ''));
            setIsNamingDialogOpen(true);
        }
    };

    const handleCancelName = () => {
        setIsNamingDialogOpen(false);
        setMessageToName(null);
        setTemplateNameInput('');
    };

    const handleConfirmName = () => {
        if (!messageToName || activeChatId === null) return;

        const finalName = templateNameInput.trim();
        // Basic validation: ensure name is not empty (can be more complex)
        if (!finalName) {
            alert("Please enter a name for the starred template.");
            return; // Keep dialog open
        }

        starMessageAction({
            chatId: activeChatId,
            messageId: messageToName.id,
            shouldStar: true,
            name: finalName // Pass the entered name
        });

        // Close dialog and reset state
        handleCancelName();
    };

    const handleNameInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setTemplateNameInput(e.target.value);
    };

    return (
        <>
            {/* Message List */}
            <div
                ref={chatScrollRef as React.RefObject<HTMLDivElement>}
                className="flex-grow border border-gray-200 dark:border-gray-700 rounded-md mb-4 overflow-y-auto p-3 bg-white dark:bg-gray-900"
            >
                <div className="space-y-3 p-1"> {/* Reduced padding inside scroll area */}
                    {chatMessages.length === 0 && activeChatId === null && (
                        <p className="text-center text-gray-500 dark:text-gray-400 italic py-4">Start a new chat or select one.</p>
                    )}
                    {chatMessages.length === 0 && activeChatId !== null && (
                        <p className="text-center text-gray-500 dark:text-gray-400 italic py-4">No messages yet. Start typing below.</p>
                    )}
                    {chatMessages.map((msg) => (
                        <div key={msg.id} className={cn('group flex items-start gap-2', msg.sender === 'user' ? 'justify-end' : 'justify-start')}>
                            {msg.sender === 'ai' && <Bot className="h-5 w-5 text-brand-DEFAULT flex-shrink-0 mt-1" aria-hidden="true" />}
                            <div className={cn("flex items-center max-w-[85%]", msg.sender === 'user' ? 'order-2' : 'order-1')}>
                                {/* Star Button Logic (unchanged visually, click handler updated) */}
                                {msg.sender === 'user' && (
                                    <Button
                                        variant="ghost"
                                        size="iconXs"
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
                                {/* Message Bubble (unchanged) */}
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
                    {isChatting && (
                         <div className="flex items-start space-x-2">
                            <Bot className="h-5 w-5 text-blue-600 flex-shrink-0 mt-1" />
                            <div className="rounded-lg p-2 px-3 text-sm bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 italic flex items-center shadow-sm">
                                <Loader2 className="inline mr-1 h-4 w-4 animate-spin" /> Thinking...
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Naming Dialog */}
            <Dialog open={isNamingDialogOpen} onOpenChange={(open) => !open && handleCancelName()}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Name This Template</DialogTitle>
                    </DialogHeader>
                    <div className="py-4 space-y-2">
                        <Label htmlFor="templateName">Template Name</Label>
                        <Input
                            id="templateName"
                            value={templateNameInput}
                            onChange={handleNameInputChange}
                            placeholder="Enter a short name for this template"
                            autoFocus
                        />
                        <p className="text-xs text-gray-500 dark:text-gray-400 pt-1">
                            Original message: "{messageToName?.text.substring(0, 100)}{messageToName && messageToName.text.length > 100 ? '...' : ''}"
                        </p>
                    </div>
                    <DialogFooter>
                        <Button variant="secondary" onClick={handleCancelName}>Cancel</Button>
                        <Button onClick={handleConfirmName}>Save Template</Button>
                    </DialogFooter>
                     {/* Optional: Add explicit close button if DialogContent doesn't include one by default */}
                    {/* <DialogClose className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
                        <X className="h-4 w-4" />
                        <span className="sr-only">Close</span>
                    </DialogClose> */}
                </DialogContent>
            </Dialog>
        </>
    );
}
