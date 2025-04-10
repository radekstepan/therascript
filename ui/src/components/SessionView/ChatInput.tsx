// src/components/SessionView/ChatInput.tsx
import React, { useState, useRef, useEffect } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { StarIcon, PaperPlaneIcon, StopIcon, Cross2Icon } from '@radix-ui/react-icons';
import * as Toast from '@radix-ui/react-toast';
import { Button, TextField, Flex, Box, Text, IconButton } from '@radix-ui/themes';
import { StarredTemplatesList } from '../StarredTemplates';
import { addChatMessage } from '../../api/api';
import { currentQueryAtom, activeSessionIdAtom, activeChatIdAtom, chatErrorAtom, toastMessageAtom } from '../../store';

export function ChatInput() {
  const [currentQuery, setCurrentQuery] = useAtom(currentQueryAtom);
  const activeSessionId = useAtomValue(activeSessionIdAtom);
  const activeChatId = useAtomValue(activeChatIdAtom);
  const [chatError, setChatError] = useAtom(chatErrorAtom);
  const toastMessageContent = useAtomValue(toastMessageAtom);
  const setToastMessageAtom = useSetAtom(toastMessageAtom);
  const [isToastVisible, setIsToastVisible] = useState(false);
  const [isChatting, setIsChatting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [showTemplates, setShowTemplates] = useState(false);

  useEffect(() => {
    if (activeChatId !== null) {
      inputRef.current?.focus();
    }
  }, [activeChatId]);

  useEffect(() => {
    if ((chatError === "Cannot send an empty message." || chatError === "Please select a chat first.") && currentQuery !== '') {
      setChatError('');
    }
  }, [currentQuery, chatError, setChatError]);

  useEffect(() => {
    setIsToastVisible(!!toastMessageContent);
  }, [toastMessageContent]);

  const handleSelectTemplate = (text: string) => {
    setCurrentQuery((prev) => (prev ? `${prev} ${text}` : text));
    setShowTemplates(false);
    inputRef.current?.focus();
  };

  const trySubmit = async () => {
    if (isChatting) {
      setToastMessageAtom("Please wait for the AI to finish responding.");
      return false;
    }
    if (!currentQuery.trim()) {
      setChatError("Cannot send an empty message.");
      return false;
    }
    if (activeSessionId === null || activeChatId === null) {
      setChatError("Please select a chat first.");
      return false;
    }

    try {
      setIsChatting(true);
      const { userMessage, aiMessage } = await addChatMessage(activeSessionId, activeChatId, currentQuery);
      setCurrentQuery('');
      setChatError('');
      inputRef.current?.focus();
      // Update session state in parent component via props or context if needed
    } catch (err) {
      setChatError('Failed to send message.');
    } finally {
      setIsChatting(false);
    }
    return true;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      trySubmit();
    }
  };
  const handleSubmitClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    trySubmit();
  };
  const handleCancelClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setToastMessageAtom("Cancellation not supported by backend yet.");
    inputRef.current?.focus();
  };
  const handleToastOpenChange = (open: boolean) => {
    setIsToastVisible(open);
    if (!open) setToastMessageAtom(null);
  };

  const showCancelButton = isChatting;
  const sendButtonDisabled = !currentQuery.trim() || activeChatId === null || isChatting;
  const starredButtonDisabled = activeChatId === null;

  return (
    <>
      <Flex direction="column" gap="1">
        <Flex align="start" gap="2" width="100%">
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
            {showTemplates && <StarredTemplatesList onSelectTemplate={handleSelectTemplate} onClose={() => setShowTemplates(false)} />}
          </Box>
          <TextField.Root
            ref={inputRef}
            size="2"
            style={{ flexGrow: 1 }}
            placeholder="Ask about the session..."
            value={currentQuery}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCurrentQuery(e.target.value)}
            disabled={activeChatId === null || isChatting}
            aria-label="Chat input message"
            onKeyDown={handleKeyDown}
          />
          {showCancelButton ? (
            <IconButton type="button" color="red" variant="solid" size="2" onClick={handleCancelClick} title="Cancel response" aria-label="Cancel AI response">
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
        {chatError && <Text size="1" color="red" align="center" mt="1">{chatError}</Text>}
      </Flex>
      <Toast.Root
        open={isToastVisible}
        onOpenChange={handleToastOpenChange}
        duration={5000}
        className="bg-[--color-panel-solid] rounded-md shadow-[hsl(206_22%_7%_/_35%)_0px_10px_38px_-10px,_hsl(206_22%_7%_/_20%)_0px_10px_20px_-15px] p-[15px] grid [grid-template-areas:_'title_action'_'description_action'] grid-cols-[auto_max-content] gap-x-[15px] items-center data-[state=open]:animate-slideIn data-[state=closed]:animate-hide data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=cancel]:translate-x-0 data-[swipe=cancel]:transition-[transform_200ms_ease-out] data-[swipe=end]:animate-swipeOut"
      >
        <Toast.Description className="[grid-area:_description] m-0 text-[--gray-a11] text-[13px] leading-[1.3]">{toastMessageContent}</Toast.Description>
        <Toast.Close className="[grid-area:_action]" asChild>
          <IconButton variant="ghost" color="gray" size="1" aria-label="Close">
            <Cross2Icon />
          </IconButton>
        </Toast.Close>
      </Toast.Root>
    </>
  );
}
