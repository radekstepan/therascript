/* packages/ui/src/components/SessionView/Chat/ChatMessages.tsx */
import React, { useState } from 'react';
import { useAtomValue } from 'jotai';
import { useQueryClient } from '@tanstack/react-query';
import {
    StarIcon,
    StarFilledIcon,
    InfoCircledIcon,
    Cross2Icon,
    CheckIcon,
    UpdateIcon,
    CopyIcon,
} from '@radix-ui/react-icons';
import { Button, TextField, Flex, Box, Text, IconButton, Dialog, Spinner, Callout, Tooltip } from '@radix-ui/themes';
import ReactMarkdown from 'react-markdown';
import { activeSessionIdAtom, renderMarkdownAtom, toastMessageAtom } from '../../../store';
import { useSetAtom } from 'jotai';
import type { ChatMessage, ChatSession } from '../../../types';
import { cn } from '../../../utils';

// Define type for the streaming message prop
interface StreamingMessage {
    id: string;
    content: string;
}

interface ChatMessagesProps {
  activeChatId: number | null;
  messages: ChatMessage[];
  streamingMessage: StreamingMessage | null;
  // --- REMOVED isCursorAnimating prop ---
}

export function ChatMessages({
    activeChatId,
    messages: chatMessages,
    streamingMessage,
    // --- REMOVED isCursorAnimating prop ---
}: ChatMessagesProps) {
  const activeSessionId = useAtomValue(activeSessionIdAtom);
  const shouldRenderMarkdown = useAtomValue(renderMarkdownAtom);
  const setToastMessage = useSetAtom(toastMessageAtom);

  const [isNamingDialogOpen, setIsNamingDialogOpen] = useState(false);
  const [messageToName, setMessageToName] = useState<ChatMessage | null>(null);
  const [templateNameInput, setTemplateNameInput] = useState('');
  const [namingError, setNamingError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const [copiedMessageId, setCopiedMessageId] = useState<number | string | null>(null);

  const handleStarClick = (message: ChatMessage) => {
    if (activeChatId === null || !activeSessionId) return;
    const queryKey = ['chat', activeSessionId, activeChatId];
    if (message.starred) {
      queryClient.setQueryData<ChatSession>(queryKey, (oldData) => {
        if (!oldData) return oldData;
        return { ...oldData, messages: (oldData.messages || []).map(msg => msg.id === message.id ? { ...msg, starred: false, starredName: undefined } : msg), };
      });
    } else {
      setMessageToName(message);
      setTemplateNameInput(message.starredName || message.text.substring(0, 50) + (message.text.length > 50 ? '...' : ''));
      setNamingError(null);
      setIsNamingDialogOpen(true);
    }
  };

  const handleCancelName = () => { setIsNamingDialogOpen(false); setMessageToName(null); setTemplateNameInput(''); setNamingError(null); };

  const handleConfirmName = () => {
    if (!messageToName || activeChatId === null || !activeSessionId) return;
    const finalName = templateNameInput.trim();
    if (!finalName) { setNamingError("Please enter a name for the starred template."); return; }
    const queryKey = ['chat', activeSessionId, activeChatId];
    // TODO we need to actually make a request to star the message
    queryClient.setQueryData<ChatSession>(queryKey, (oldData) => {
      if (!oldData) return oldData;
      return { ...oldData, messages: (oldData.messages || []).map(msg => msg.id === messageToName.id ? { ...msg, starred: true, starredName: finalName } : msg), };
    });
    handleCancelName();
  };

  const handleCopyClick = (messageId: number | string, textToCopy: string) => {
      navigator.clipboard.writeText(textToCopy)
          .then(() => {
              setCopiedMessageId(messageId);
              setToastMessage("Copied to clipboard!");
              setTimeout(() => setCopiedMessageId(null), 1500);
          })
          .catch(err => {
              console.error('Failed to copy text: ', err);
              setToastMessage("Error copying text.");
          });
  };

  const getMessageKey = (msg: ChatMessage | StreamingMessage | { id: number | string }): string => {
      return `msg-${String(msg.id)}`;
  };

  return (
    <>
      {/* Remove is-streaming class */}
      <Box className={cn("space-y-3 p-1")}>
        {/* Render completed messages */}
        {chatMessages.map((msg) => (
          <Flex
            key={getMessageKey(msg)}
            gap="2"
            align="start"
            className="group relative"
            justify={msg.sender === 'user' ? 'end' : 'start'}
          >
            {/* AI message */}
            {msg.sender === 'ai' && (
              <Box
                  style={{ maxWidth: 'calc(100% - 1rem)', position: 'relative', paddingRight: '2rem' }}
                  className={cn('rounded-lg p-2 px-3 text-sm shadow-sm break-words', 'bg-[--gray-a3] text-[--gray-a12]')} >
                 <Tooltip content="Copy message">
                     <IconButton
                         variant="ghost" color="gray" size="1" highContrast
                         className="absolute top-1 right-1 opacity-0 group-hover:opacity-70 focus-visible:opacity-100 transition-opacity"
                         style={{ zIndex: 5 }}
                         onClick={() => handleCopyClick(msg.id, msg.text)}
                         aria-label="Copy message"
                     >
                         {copiedMessageId === msg.id ? <CheckIcon /> : <CopyIcon />}
                     </IconButton>
                 </Tooltip>
                {shouldRenderMarkdown ? (
                    <div className="markdown-ai-message">
                        <ReactMarkdown>{msg.text}</ReactMarkdown>
                    </div>
                 ) : (
                    <Text size="2">{msg.text}</Text>
                 )}
              </Box>
            )}
            {/* User message */}
            {msg.sender === 'user' && (
              <>
                <Box className="flex-shrink-0 self-center mt-px">
                   {msg.starred ? (
                     <IconButton variant="ghost" color="yellow" size="1" className="p-0 text-yellow-500" onClick={() => handleStarClick(msg)} title="Unstar message" aria-label="Unstar message" >
                       <StarFilledIcon width="16" height="16" />
                     </IconButton>
                   ) : (
                     <IconButton variant="ghost" color="gray" size="1" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity p-0" onClick={() => handleStarClick(msg)} title="Star message as template" aria-label="Star message" >
                       <StarIcon width="14" height="14" />
                     </IconButton>
                   )}
                </Box>
                <Box
                    style={{ maxWidth: 'calc(100% - 2rem)', position: 'relative', paddingRight: '2rem' }}
                    className={cn('rounded-lg p-2 px-3 text-sm shadow-sm break-words', 'bg-blue-600 text-white dark:bg-blue-500 dark:text-white')} >
                    <Tooltip content="Copy message">
                        <IconButton
                            variant="ghost" color="gray" size="1" highContrast
                            className="absolute top-1 right-1 opacity-0 group-hover:opacity-70 focus-visible:opacity-100 transition-opacity text-white/70 hover:text-white/90"
                            style={{ zIndex: 5 }}
                            onClick={() => handleCopyClick(msg.id, msg.text)}
                            aria-label="Copy message"
                        >
                            {copiedMessageId === msg.id ? <CheckIcon /> : <CopyIcon />}
                        </IconButton>
                    </Tooltip>
                  <Text size="2">{msg.text}</Text>
                </Box>
              </>
            )}
          </Flex>
        ))}

        {/* Render the streaming AI message */}
        {streamingMessage && (
            <Flex
                key={getMessageKey(streamingMessage)}
                gap="2"
                align="start"
                justify="start"
                className="group relative"
            >
                <Box
                    style={{ maxWidth: 'calc(100% - 1rem)', position: 'relative', paddingRight: '2rem' }}
                    className={cn('rounded-lg p-2 px-3 text-sm shadow-sm break-words', 'bg-[--gray-a3] text-[--gray-a11]')}
                >
                    {shouldRenderMarkdown ? (
                         <div className="markdown-ai-message">
                            <ReactMarkdown>
                                {streamingMessage.content}
                            </ReactMarkdown>
                            {/* Keep inline style setting animation to running */}
                            <span className="streaming-cursor" style={{ animationPlayState: 'running' }}></span>
                         </div>
                     ) : (
                         <Text size="2">
                            {streamingMessage.content}
                             {/* Keep inline style setting animation to running */}
                            <span className="streaming-cursor" style={{ animationPlayState: 'running' }}></span>
                         </Text>
                     )}
                 </Box>
            </Flex>
        )}
      </Box>

      {/* Naming Dialog */}
      <Dialog.Root open={isNamingDialogOpen} onOpenChange={(open) => !open && handleCancelName()}>
        <Dialog.Content style={{ maxWidth: 450 }}>
          <Dialog.Title>Name This Template</Dialog.Title>
          <Dialog.Description size="2" mb="4" color="gray"> Give a short, memorable name to easily reuse this message. </Dialog.Description>
          <Flex direction="column" gap="3">
            <label> <Text as="div" size="2" mb="1" weight="bold">Template Name</Text>
              <TextField.Root size="2" value={templateNameInput} onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setTemplateNameInput(e.target.value); if (namingError) setNamingError(null); }} placeholder="Enter a short name..." autoFocus />
            </label>
            <Text size="1" color="gray" mt="1"> Original: "<Text truncate>{messageToName?.text}</Text>" </Text>
            {namingError && ( <Callout.Root color="red" size="1" mt="1"> <Callout.Icon><InfoCircledIcon /></Callout.Icon> <Callout.Text>{namingError}</Callout.Text> </Callout.Root> )}
          </Flex>
          <Flex gap="3" mt="4" justify="end">
            <Button variant="soft" color="gray" onClick={handleCancelName}> <Cross2Icon /> Cancel </Button>
            <Button onClick={handleConfirmName}> <CheckIcon /> Save Template </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
}

// Define props interface if it wasn't done above correctly
interface ChatMessagesProps {
  activeChatId: number | null;
  messages: ChatMessage[];
  streamingMessage: StreamingMessage | null;
  // isCursorAnimating prop removed
}
