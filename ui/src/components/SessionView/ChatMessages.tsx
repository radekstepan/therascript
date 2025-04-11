// src/components/SessionView/ChatMessages.tsx
import React, { useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { StarIcon, StarFilledIcon, CheckIcon, Cross1Icon, InfoCircledIcon } from '@radix-ui/react-icons';
import { Button, TextField, Flex, Box, Text, IconButton, Dialog, Heading, Spinner, Strong, Callout } from '@radix-ui/themes';
import { currentChatMessagesAtom, isChattingAtom, starMessageAtom, activeChatIdAtom } from '../../store'; // Fixed typo
import type { ChatMessage } from '../../types';
import { cn } from '../../utils';

interface ChatMessagesProps {
  activeChatId: number | null;
}

export function ChatMessages({ activeChatId }: ChatMessagesProps) {
  const chatMessages = useAtomValue(currentChatMessagesAtom);
  const isChatting = useAtomValue(isChattingAtom);
  const starMessageAction = useSetAtom(starMessageAtom);

  const [isNamingDialogOpen, setIsNamingDialogOpen] = useState(false);
  const [messageToName, setMessageToName] = useState<ChatMessage | null>(null);
  const [templateNameInput, setTemplateNameInput] = useState('');
  const [namingError, setNamingError] = useState<string | null>(null);

  const handleStarClick = (message: ChatMessage) => {
    if (activeChatId === null) return;
    if (message.starred) {
      starMessageAction({ chatId: activeChatId, messageId: message.id, shouldStar: false });
    } else {
      setMessageToName(message);
      setTemplateNameInput(message.starredName || message.text.substring(0, 50) + (message.text.length > 50 ? '...' : ''));
      setNamingError(null);
      setIsNamingDialogOpen(true);
    }
  };

  const handleCancelName = () => {
    setIsNamingDialogOpen(false);
    setMessageToName(null);
    setTemplateNameInput('');
    setNamingError(null);
  };

  const handleConfirmName = () => {
    if (!messageToName || activeChatId === null) return;
    const finalName = templateNameInput.trim();
    if (!finalName) {
      setNamingError("Please enter a name for the starred template.");
      return;
    }
    starMessageAction({ chatId: activeChatId, messageId: messageToName.id, shouldStar: true, name: finalName });
    handleCancelName();
  };

  return (
    <>
      <Box className="space-y-3 p-1">
        {chatMessages.length === 0 && activeChatId === null && (
          <Text color="gray" size="2" align="center" my="4" style={{ fontStyle: 'italic' }}>
            Start a new chat or select one.
          </Text>
        )}
        {chatMessages.length === 0 && activeChatId !== null && (
          <Text color="gray" size="2" align="center" my="4" style={{ fontStyle: 'italic' }}>
            No messages yet. Start typing below.
          </Text>
        )}
        {chatMessages.map((msg) => (
          <Flex
            key={msg.id}
            gap="2"
            align="start"
            className="group relative"
            justify={msg.sender === 'user' ? 'end' : 'start'}
          >
            {msg.sender === 'ai' && (
              <Box
                style={{ maxWidth: 'calc(100% - 1rem)' }}
                className={cn('rounded-lg p-2 px-3 text-sm shadow-sm break-words', 'bg-[--gray-a3] text-[--gray-a12]')}
              >
                <Text size="2">{msg.text}</Text>
              </Box>
            )}
            {msg.sender === 'user' && (
              <>
                <Box className="flex-shrink-0 self-center mt-px">
                  {msg.starred ? (
                    <IconButton
                      variant="ghost"
                      color="yellow"
                      size="1"
                      className="p-0 text-yellow-500"
                      onClick={() => handleStarClick(msg)}
                      title="Unstar message"
                      aria-label="Unstar message"
                    >
                      <StarFilledIcon width="16" height="16" />
                    </IconButton>
                  ) : (
                    <IconButton
                      variant="ghost"
                      color="gray"
                      size="1"
                      className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity p-0"
                      onClick={() => handleStarClick(msg)}
                      title="Star message as template"
                      aria-label="Star message"
                    >
                      <StarIcon width="14" height="14" />
                    </IconButton>
                  )}
                </Box>
                <Box
                  style={{ maxWidth: 'calc(100% - 2rem)' }}
                  className={cn('rounded-lg p-2 px-3 text-sm shadow-sm break-words', 'bg-blue-600 text-white dark:bg-blue-500 dark:text-white')}
                >
                  <Text size="2">{msg.text}</Text>
                </Box>
              </>
            )}
          </Flex>
        ))}
        {isChatting && (
          <Flex align="start" gap="2" justify="start">
            <Box className="rounded-lg p-2 px-3 text-sm bg-[--gray-a3] text-[--gray-a11] shadow-sm">
              <Flex align="center" gap="1" style={{ fontStyle: 'italic' }}>
                <Spinner size="1" /> Thinking...
              </Flex>
            </Box>
          </Flex>
        )}
      </Box>
      <Dialog.Root open={isNamingDialogOpen} onOpenChange={(open) => !open && handleCancelName()}>
        <Dialog.Content style={{ maxWidth: 450 }}>
          <Dialog.Title>Name This Template</Dialog.Title>
          <Dialog.Description size="2" mb="4" color="gray">
            Give a short, memorable name to easily reuse this message.
          </Dialog.Description>
          <Flex direction="column" gap="3">
            <label>
              <Text as="div" size="2" mb="1" weight="bold">Template Name</Text>
              <TextField.Root
                size="2"
                value={templateNameInput}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  setTemplateNameInput(e.target.value);
                  if (namingError) setNamingError(null);
                }}
                placeholder="Enter a short name..."
                autoFocus
              />
            </label>
            <Text size="1" color="gray" mt="1">
              Original: "<Text truncate>{messageToName?.text}</Text>"
            </Text>
            {namingError && (
              <Callout.Root color="red" size="1" mt="1">
                <Callout.Icon><InfoCircledIcon /></Callout.Icon>
                <Callout.Text>{namingError}</Callout.Text>
              </Callout.Root>
            )}
          </Flex>
          <Flex gap="3" mt="4" justify="end">
            <Dialog.Close>
              <Button variant="soft" color="gray" onClick={handleCancelName}>Cancel</Button>
            </Dialog.Close>
            <Button onClick={handleConfirmName}>Save Template</Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
}
