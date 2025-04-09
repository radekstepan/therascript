// src/components/SessionView/ChatInput.tsx
import React, { useState, useRef, useEffect } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { StarIcon, PaperPlaneIcon, StopIcon, Cross2Icon } from '@radix-ui/react-icons';
import * as Toast from '@radix-ui/react-toast';
// Import TextField directly
import { Button, TextField, Flex, Box, Text, IconButton } from '@radix-ui/themes';
import { StarredTemplatesList } from '../StarredTemplates';
import {
    currentQueryAtom, isChattingAtom, activeChatIdAtom, chatErrorAtom,
    handleChatSubmitAtom, cancelChatResponseAtom, toastMessageAtom
} from '../../store';
import { cn } from '../../utils';

export function ChatInput() {
    const [currentQuery, setCurrentQuery] = useAtom(currentQueryAtom);
    const isChatting = useAtomValue(isChattingAtom); // Still need this to show cancel button
    const activeChatId = useAtomValue(activeChatIdAtom);
    const [chatError, setChatError] = useAtom(chatErrorAtom);
    const handleChatSubmitAction = useSetAtom(handleChatSubmitAtom);
    const cancelChatAction = useSetAtom(cancelChatResponseAtom);
    const toastMessageContent = useAtomValue(toastMessageAtom);
    const setToastMessageAtom = useSetAtom(toastMessageAtom);
    const [isToastVisible, setIsToastVisible] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null); // Ref for the underlying input
    const [showTemplates, setShowTemplates] = useState(false);

    // Effect to focus when active chat changes, but NOT when chatting starts/stops
    useEffect(() => {
        if (activeChatId !== null) {
            inputRef.current?.focus();
        }
    }, [activeChatId]); // Removed isChatting dependency

    // Effect to clear potential validation errors when user types
    useEffect(() => {
        if ((chatError === "Cannot send an empty message." || chatError === "Please select a chat first.") && currentQuery !== '') {
            setChatError('');
        }
    }, [currentQuery, chatError, setChatError]);

    // Effect for toast visibility
     useEffect(() => {
         setIsToastVisible(!!toastMessageContent);
     }, [toastMessageContent]);

    const handleSelectTemplate = (text: string) => {
        setCurrentQuery(prev => prev ? `${prev} ${text}` : text);
        setShowTemplates(false);
        inputRef.current?.focus();
     };

    const trySubmit = () => {
        // Remove the check for isChatting here, allow multiple submissions
        // if (isChatting) { ... return false; } // REMOVED

        if (!currentQuery.trim()) {
            console.log("Submit blocked: Empty message.");
            // setChatError("Cannot send an empty message."); // Optionally show error
            return false;
        }
        if (activeChatId === null) {
            setChatError("Please select a chat first.");
            return false;
        }

        setChatError('');
        // Call the action - it now handles adding the message and *starting* the AI response async
        handleChatSubmitAction();

        // Focus logic remains, relying on useEffect primarily, but can add direct focus here too
        requestAnimationFrame(() => {
             if (inputRef.current) { // No need to check disabled status now
                 inputRef.current.focus();
             }
         });


        return true;
     };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); trySubmit(); }
    };
    const handleSubmitClick = (e: React.MouseEvent<HTMLButtonElement>) => {
        // Remove the isChatting check
        e.preventDefault();
        trySubmit();
    };
    const handleCancelClick = (e: React.MouseEvent<HTMLButtonElement>) => {
         // Cancel logic still needs to work based on isChatting state
         e.preventDefault();
         cancelChatAction();
         inputRef.current?.focus();
    };
    const handleToastOpenChange = (open: boolean) => {
        setIsToastVisible(open); if (!open) { setToastMessageAtom(null); }
    };

    const showCancelButton = isChatting; // Keep this for showing/hiding cancel
    // Update disabled logic for Send button
    const sendButtonDisabled = !currentQuery.trim() || activeChatId === null;
    // Update disabled logic for Starred Templates button
    const starredButtonDisabled = activeChatId === null;

    return (
        <>
            <Flex direction="column" gap="1">
                <Flex align="start" gap="2" width="100%">
                    <Box position="relative" flexShrink="0">
                        {/* --- UPDATE: Removed isChatting from disabled --- */}
                        <IconButton
                             type="button" variant="soft" size="2" title="Show Starred Templates"
                             onClick={() => setShowTemplates(prev => !prev)}
                             aria-label="Show starred templates"
                             disabled={starredButtonDisabled} // Use updated variable
                         >
                          <StarIcon width={16} height={16} />
                        </IconButton>
                        {showTemplates && ( <StarredTemplatesList onSelectTemplate={handleSelectTemplate} onClose={() => setShowTemplates(false)} /> )}
                    </Box>

                    <TextField.Root
                        ref={inputRef}
                        size="2"
                        style={{ flexGrow: 1 }}
                        placeholder="Ask about the session..."
                        value={currentQuery}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCurrentQuery(e.target.value)}
                        // --- UPDATE: Removed isChatting from disabled ---
                        disabled={activeChatId === null}
                        aria-label="Chat input message"
                        onKeyDown={handleKeyDown}
                    />

                    {/* Show Cancel button *only* if chatting */}
                    {showCancelButton ? (
                        <IconButton type="button" color="red" variant="solid" size="2" onClick={handleCancelClick} title="Cancel response" aria-label="Cancel AI response"> <StopIcon/> </IconButton>
                    ) : (
                        // --- UPDATE: Removed isChatting from disabled ---
                        <IconButton
                            type="button" variant="solid" size="2"
                            onClick={handleSubmitClick}
                            disabled={sendButtonDisabled} // Use updated variable
                            title="Send message" aria-label="Send message"
                        >
                            <PaperPlaneIcon/>
                        </IconButton>
                    )}
                </Flex>

                 {chatError && ( <Text size="1" color="red" align="center" mt="1"> {chatError} </Text> )}
            </Flex>

            {/* Radix Toast components */}
            <Toast.Root open={isToastVisible} onOpenChange={handleToastOpenChange} duration={5000}
                        className="bg-[--gray-a3] rounded-md shadow-[hsl(206_22%_7%_/_35%)_0px_10px_38px_-10px,_hsl(206_22%_7%_/_20%)_0px_10px_20px_-15px] p-[15px] grid [grid-template-areas:_'title_action'_'description_action'] grid-cols-[auto_max-content] gap-x-[15px] items-center data-[state=open]:animate-slideIn data-[state=closed]:animate-hide data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=cancel]:translate-x-0 data-[swipe=cancel]:transition-[transform_200ms_ease-out] data-[swipe=end]:animate-swipeOut">
                 <Toast.Description className="[grid-area:_description] m-0 text-[--gray-a11] text-[13px] leading-[1.3]">
                     {toastMessageContent}
                 </Toast.Description>
                 <Toast.Close className="[grid-area:_action]" asChild>
                     <IconButton variant="ghost" color="gray" size="1" aria-label="Close"> <Cross2Icon /> </IconButton>
                 </Toast.Close>
            </Toast.Root>
        </>
    );
}
