import React, { useState, useRef, useEffect } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import {
    StarIcon,
    PaperPlaneIcon, // Send Icon
    StopIcon,       // Cancel Icon
    Cross2Icon      // Close Icon for Toast
} from '@radix-ui/react-icons';
import * as Toast from '@radix-ui/react-toast'; // Import Toast components
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { StarredTemplatesList } from '../StarredTemplates';
import {
    currentQueryAtom,
    isChattingAtom,
    activeChatIdAtom,
    chatErrorAtom, // Keep for non-toast errors
    handleChatSubmitAtom,
    cancelChatResponseAtom,
    toastMessageAtom, // Import toast message atom
} from '../../store';
import { cn } from '../../utils';

export function ChatInput() {
    const [currentQuery, setCurrentQuery] = useAtom(currentQueryAtom);
    const isChatting = useAtomValue(isChattingAtom);
    const activeChatId = useAtomValue(activeChatIdAtom);
    const [chatError, setChatError] = useAtom(chatErrorAtom);
    const handleChatSubmitAction = useSetAtom(handleChatSubmitAtom);
    const cancelChatAction = useSetAtom(cancelChatResponseAtom);

    // Toast State
    const toastMessageContent = useAtomValue(toastMessageAtom); // Read value from atom
    const setToastMessageAtom = useSetAtom(toastMessageAtom);   // Get setter for atom

    // Local state to control the *visual* open state, synced with the atom
    const [isToastVisible, setIsToastVisible] = useState(false);

    const inputRef = useRef<HTMLInputElement>(null);
    const [showTemplates, setShowTemplates] = useState(false);

    // Effect to sync local visibility state WITH the atom message
    useEffect(() => {
        // If there's a message in the atom, make the toast visible
        // If there's no message, ensure the toast is hidden
        setIsToastVisible(!!toastMessageContent);
    }, [toastMessageContent]);


    // Focus input when active chat changes
    useEffect(() => {
        if (activeChatId !== null && inputRef.current) {
            inputRef.current.focus();
        }
    }, [activeChatId]);

    // Clear specific feedback error when user starts typing again
    useEffect(() => {
        if (chatError === "Cannot send an empty message." && currentQuery !== '') {
            setChatError('');
        }
         if (chatError === "Please select a chat first." && currentQuery !== '') {
             setChatError('');
         }
    }, [currentQuery, chatError, setChatError]);

    const handleSelectTemplate = (text: string) => {
        setCurrentQuery(prev => prev ? `${prev} ${text}` : text);
        setShowTemplates(false);
        inputRef.current?.focus();
    };

     const trySubmit = () => {
        if (isChatting) {
            // Set the atom, the useEffect above will handle showing the toast
            setToastMessageAtom("Please wait for the AI to finish responding.");
            return false;
         } else if (!currentQuery.trim()) {
             // Silently ignore empty submission
             console.log("Submit blocked: Empty message.");
            return false;
         } else if (activeChatId === null) {
            setChatError("Please select a chat first."); // Use regular error for this
            return false;
         } else {
            setChatError(''); // Clear regular errors
            handleChatSubmitAction();
            requestAnimationFrame(() => { inputRef.current?.focus(); });
            return true;
         }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
             e.preventDefault();
             trySubmit();
        }
    };

    const handleSubmitClick = (e: React.MouseEvent<HTMLButtonElement>) => {
        e.preventDefault();
        if (!isChatting) {
           trySubmit();
        }
    };

    const handleCancelClick = (e: React.MouseEvent<HTMLButtonElement>) => {
         e.preventDefault();
         cancelChatAction(); // This will set the "cancelled" toast message in the atom
         inputRef.current?.focus();
    };

    // Handler for when Radix *reports* the toast visibility changes
    // We use this ONLY to clear the atom state when the toast hides
    const handleToastOpenChange = (open: boolean) => {
        setIsToastVisible(open); // Keep local state in sync with Radix state
        // Clear the atom message ONLY when the toast visually closes
        if (!open) {
             setToastMessageAtom(null);
        }
    };

    // Determine button state
    const showCancelButton = isChatting;
    const sendButtonDisabled = !currentQuery.trim() || activeChatId === null;

    return (
        <>
            <div className="flex-shrink-0 pt-2">
                <div className="relative flex items-start space-x-2 w-full">
                    {/* Starred Templates Button */}
                    <div className="relative flex-shrink-0">
                        <Button type="button" variant="secondary" size="icon" title="Show Starred Templates" onClick={() => setShowTemplates(prev => !prev)} aria-label="Show starred templates" disabled={activeChatId === null}>
                          <StarIcon width={16} height={16} />
                        </Button>
                        {showTemplates && ( <StarredTemplatesList onSelectTemplate={handleSelectTemplate} onClose={() => setShowTemplates(false)} /> )}
                    </div>

                    {/* Chat Input */}
                    <Input
                        ref={inputRef}
                        placeholder="Ask about the session..."
                        value={currentQuery}
                        onChange={(e) => setCurrentQuery(e.target.value)}
                        disabled={activeChatId === null}
                        className="flex-grow h-10"
                        aria-label="Chat input message"
                        onKeyDown={handleKeyDown}
                    />

                    {/* Conditional Send/Cancel ICON Button */}
                    {showCancelButton ? (
                        <Button
                            type="button"
                            variant="destructive"
                            size="icon"
                            onClick={handleCancelClick}
                            className="h-10 w-10 flex-shrink-0"
                            icon={StopIcon}
                            title="Cancel response"
                            aria-label="Cancel AI response"
                        />
                    ) : (
                        <Button
                            type="button"
                            size="icon"
                            onClick={handleSubmitClick}
                            disabled={sendButtonDisabled}
                            className="h-10 w-10 flex-shrink-0"
                            icon={PaperPlaneIcon}
                            title="Send message"
                            aria-label="Send message"
                        />
                    )}
                </div>
            </div>
            {/* Error/Feedback Area - Only for non-toast errors */}
            {chatError && (
                    <p className={cn(
                        "text-sm text-center flex-shrink-0 mt-1",
                         "text-red-600 dark:text-red-500"
                    )}>
                        {chatError}
                    </p>
            )}

            {/* Toast Root - Control open state by local state synced with atom */}
             <Toast.Root
                open={isToastVisible} // Use the local visibility state
                onOpenChange={handleToastOpenChange} // Use the handler to clear atom on close
                duration={5000}
                className="bg-gray-900 dark:bg-gray-50 rounded-md shadow-[hsl(206_22%_7%_/_35%)_0px_10px_38px_-10px,_hsl(206_22%_7%_/_20%)_0px_10px_20px_-15px] p-4 grid gap-x-4 items-center data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full data-[state=open]:slide-in-from-bottom-full"
                style={{ gridTemplateColumns: 'auto max-content' }}
             >
                <Toast.Description className="text-sm text-gray-100 dark:text-gray-900">
                    {/* Read the content directly from the atom state */}
                    {toastMessageContent}
                </Toast.Description>
                 <Toast.Close
                    className="text-gray-400 hover:text-gray-100 dark:text-gray-500 dark:hover:text-gray-900 p-1 rounded-full -m-1 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 dark:focus:ring-offset-gray-50 focus:ring-blue-500"
                    aria-label="Close"
                 >
                     <Cross2Icon />
                 </Toast.Close>
            </Toast.Root>
        </>
    );
}
