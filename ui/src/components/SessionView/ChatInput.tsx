import React from 'react';
import { Button, TextField, Flex, Box, Text, IconButton } from '@radix-ui/themes';
import { StarIcon, PaperPlaneIcon, StopIcon, Cross2Icon } from '@radix-ui/react-icons';
import * as Toast from '@radix-ui/react-toast';
import { StarredTemplatesList } from '../StarredTemplates'; // Keep this component relatively simple
import { useChatInput } from '../../hooks/useChatInput'; // Import the hook

interface ChatInputProps {
    disabled?: boolean;
}

export function ChatInput({ disabled = false }: ChatInputProps) {
    // Use the custom hook
    const {
        inputRef,
        currentQuery, setCurrentQuery,
        showTemplates, setShowTemplates,
        isToastVisible, toastMessage,
        chatError,
        isAiResponding,
        handleSelectTemplate,
        handleKeyDown,
        handleSubmitClick,
        handleCancelClick,
        handleToastOpenChange,
        showCancelButton,
        sendButtonDisabled,
        starredButtonDisabled,
        inputFieldDisabled,
    } = useChatInput(disabled); // Pass the disabled prop to the hook

    return (
        <>
            <Flex direction="column" gap="1">
                <Flex align="start" gap="2" width="100%">
                    {/* Starred Templates Button & Popover */}
                    <Box position="relative" flexShrink="0">
                        <IconButton
                            type="button"
                            variant="soft"
                            size="2"
                            title="Show Starred Templates"
                            onClick={() => setShowTemplates((prev) => !prev)}
                            aria-label="Show starred templates"
                            disabled={starredButtonDisabled}
                        >
                            <StarIcon width={16} height={16} />
                        </IconButton>
                        {showTemplates && (
                            <StarredTemplatesList
                                onSelectTemplate={handleSelectTemplate}
                                onClose={() => setShowTemplates(false)}
                            />
                        )}
                    </Box>

                    {/* Main Text Input */}
                    <TextField.Root
                        ref={inputRef}
                        size="2"
                        style={{ flexGrow: 1 }}
                        placeholder="Ask about the session..."
                        value={currentQuery}
                        onChange={(e) => setCurrentQuery(e.target.value)}
                        disabled={inputFieldDisabled}
                        aria-label="Chat input message"
                        onKeyDown={handleKeyDown}
                        aria-invalid={!!chatError} // Indicate error state
                        aria-describedby={chatError ? "chat-input-error" : undefined}
                    />

                    {/* Send / Cancel Button */}
                    {showCancelButton ? (
                        <IconButton
                            type="button"
                            color="red"
                            variant="solid"
                            size="2"
                            onClick={handleCancelClick}
                            title="Cancel response (Not Implemented)"
                            aria-label="Cancel AI response"
                            disabled={!isAiResponding} // Cancel only enabled when AI is responding
                        >
                            <StopIcon />
                        </IconButton>
                    ) : (
                        <IconButton
                            type="button"
                            variant="solid"
                            size="2"
                            onClick={handleSubmitClick}
                            disabled={sendButtonDisabled}
                            title="Send message"
                            aria-label="Send message"
                        >
                            <PaperPlaneIcon />
                        </IconButton>
                    )}
                </Flex>

                {/* Error Message Display */}
                {chatError && <Text id="chat-input-error" size="1" color="red" align="center" mt="1">{chatError}</Text>}
            </Flex>

            {/* Toast Notification Area */}
            <Toast.Provider>
                <Toast.Root
                    open={isToastVisible}
                    onOpenChange={handleToastOpenChange}
                    duration={5000}
                    className="bg-[--color-panel-solid] rounded-md shadow-[hsl(206_22%_7%_/_35%)_0px_10px_38px_-10px,_hsl(206_22%_7%_/_20%)_0px_10px_20px_-15px] p-[15px] grid [grid-template-areas:_'title_action'_'description_action'] grid-cols-[auto_max-content] gap-x-[15px] items-center data-[state=open]:animate-slideIn data-[state=closed]:animate-hide data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=cancel]:translate-x-0 data-[swipe=cancel]:transition-[transform_200ms_ease-out] data-[swipe=end]:animate-swipeOut z-50"
                >
                    <Toast.Description className="[grid-area:_description] m-0 text-[--gray-a11] text-[13px] leading-[1.3]">{toastMessage}</Toast.Description>
                    <Toast.Close className="[grid-area:_action]" asChild>
                        <IconButton variant="ghost" color="gray" size="1" aria-label="Close">
                            <Cross2Icon />
                        </IconButton>
                    </Toast.Close>
                </Toast.Root>
                 <Toast.Viewport className="fixed bottom-0 right-0 flex flex-col p-6 gap-3 w-[390px] max-w-[100vw] m-0 list-none z-[2147483647] outline-none" />
            </Toast.Provider>
        </>
    );
}
