import React, { useState, useRef, useEffect } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { StarIcon, PaperPlaneIcon, StopIcon, Cross2Icon } from '@radix-ui/react-icons';
import * as Toast from '@radix-ui/react-toast';
// Import TextField ONLY for TextField.Root
import { Button, TextField, Flex, Box, Text, IconButton } from '@radix-ui/themes';
import { StarredTemplatesList } from '../StarredTemplates';
import {
    currentQueryAtom, isChattingAtom, activeChatIdAtom, chatErrorAtom,
    handleChatSubmitAtom, cancelChatResponseAtom, toastMessageAtom
} from '../../store';
import { cn } from '../../utils';

export function ChatInput() {
    const [currentQuery, setCurrentQuery] = useAtom(currentQueryAtom);
    const isChatting = useAtomValue(isChattingAtom);
    const activeChatId = useAtomValue(activeChatIdAtom);
    const [chatError, setChatError] = useAtom(chatErrorAtom);
    const handleChatSubmitAction = useSetAtom(handleChatSubmitAtom);
    const cancelChatAction = useSetAtom(cancelChatResponseAtom);
    const toastMessageContent = useAtomValue(toastMessageAtom);
    const setToastMessageAtom = useSetAtom(toastMessageAtom);
    const [isToastVisible, setIsToastVisible] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const [showTemplates, setShowTemplates] = useState(false);

    useEffect(() => { setIsToastVisible(!!toastMessageContent); }, [toastMessageContent]);
    useEffect(() => { if (activeChatId !== null && inputRef.current) { inputRef.current.focus(); } }, [activeChatId]);
    useEffect(() => { if ((chatError === "Cannot send an empty message." || chatError === "Please select a chat first.") && currentQuery !== '') { setChatError(''); } }, [currentQuery, chatError, setChatError]);

    const handleSelectTemplate = (text: string) => {
        setCurrentQuery(prev => prev ? `${prev} ${text}` : text);
        setShowTemplates(false);
        inputRef.current?.focus();
     };
    const trySubmit = () => {
        if (isChatting) {
            setToastMessageAtom("Please wait for the AI to finish responding.");
            return false;
        } else if (!currentQuery.trim()) {
            console.log("Submit blocked: Empty message.");
            return false;
        } else if (activeChatId === null) {
            setChatError("Please select a chat first.");
            return false;
        } else {
            setChatError('');
            handleChatSubmitAction();
            requestAnimationFrame(() => { inputRef.current?.focus(); });
            return true;
        }
     };
    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); trySubmit(); }
    };
    const handleSubmitClick = (e: React.MouseEvent<HTMLButtonElement>) => {
        e.preventDefault(); if (!isChatting) { trySubmit(); }
    };
    const handleCancelClick = (e: React.MouseEvent<HTMLButtonElement>) => {
         e.preventDefault(); cancelChatAction(); inputRef.current?.focus();
    };
    const handleToastOpenChange = (open: boolean) => {
        setIsToastVisible(open); if (!open) { setToastMessageAtom(null); }
    };

    const showCancelButton = isChatting;
    const sendButtonDisabled = !currentQuery.trim() || activeChatId === null || isChatting;

    // Define the classes needed to style the input like Radix Themes
    // Adjust 'rt-r-size-2' if you need a different size
    const inputClasses = "rt-TextFieldInput rt-r-size-2";

    return (
        <>
            <Flex direction="column" gap="1">
                <Flex align="start" gap="2" width="100%">
                    <Box position="relative" flexShrink="0">
                        <IconButton type="button" variant="soft" size="2" title="Show Starred Templates" onClick={() => setShowTemplates(prev => !prev)} aria-label="Show starred templates" disabled={activeChatId === null}>
                          <StarIcon width={16} height={16} />
                        </IconButton>
                        {showTemplates && ( <StarredTemplatesList onSelectTemplate={handleSelectTemplate} onClose={() => setShowTemplates(false)} /> )}
                    </Box>

                    {/* --- WORKAROUND --- */}
                    {/* Use TextField.Root for the container styling/structure */}
                    {/* Use a standard <input> inside and apply Radix classes manually */}
                    <TextField.Root
                        size="2" // Apply size to the Root container
                        style={{ flexGrow: 1 }}
                        // Add Radix data attributes for styling consistency if needed,
                        // though Root usually handles container styles. Check browser inspector if needed.
                        // data-radix-themes-system-props="size=2"
                    >
                        <input
                            ref={inputRef}
                            className={inputClasses} // Apply Radix input classes
                            placeholder="Ask about the session..."
                            value={currentQuery}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCurrentQuery(e.target.value)}
                            disabled={activeChatId === null || isChatting}
                            aria-label="Chat input message"
                            onKeyDown={handleKeyDown}
                            // Add type="text" (though it's the default)
                            type="text"
                        />
                    </TextField.Root>
                    {/* --- END WORKAROUND --- */}


                    {showCancelButton ? (
                        <IconButton type="button" color="red" variant="solid" size="2" onClick={handleCancelClick} title="Cancel response" aria-label="Cancel AI response"> <StopIcon/> </IconButton>
                    ) : (
                        <IconButton type="button" variant="solid" size="2" onClick={handleSubmitClick} disabled={sendButtonDisabled} title="Send message" aria-label="Send message"> <PaperPlaneIcon/> </IconButton>
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
