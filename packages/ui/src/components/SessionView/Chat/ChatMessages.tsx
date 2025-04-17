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
    CopyIcon, // <-- Import CopyIcon
} from '@radix-ui/react-icons';
import { Button, TextField, Flex, Box, Text, IconButton, Dialog, Spinner, Callout, Tooltip } from '@radix-ui/themes'; // <-- Added Tooltip
import ReactMarkdown from 'react-markdown';
import { activeSessionIdAtom, renderMarkdownAtom, toastMessageAtom } from '../../../store'; // <-- Added toastMessageAtom
import { useSetAtom } from 'jotai'; // <-- Added useSetAtom
import type { ChatMessage, ChatSession } from '../../../types';
import { cn } from '../../../utils';

// Define type for the streaming message prop
interface StreamingMessage {
    id: string; // Temporary ID for the streaming message container
    content: string;
}

interface ChatMessagesProps {
  activeChatId: number | null;
  messages: ChatMessage[]; // Receive messages as props
  streamingMessage: StreamingMessage | null; // Add prop for streaming message
}

export function ChatMessages({ activeChatId, messages: chatMessages, streamingMessage }: ChatMessagesProps) {
  const activeSessionId = useAtomValue(activeSessionIdAtom);
  const shouldRenderMarkdown = useAtomValue(renderMarkdownAtom);
  const setToastMessage = useSetAtom(toastMessageAtom); // <-- For copy feedback

  const [isNamingDialogOpen, setIsNamingDialogOpen] = useState(false);
  const [messageToName, setMessageToName] = useState<ChatMessage | null>(null);
  const [templateNameInput, setTemplateNameInput] = useState('');
  const [namingError, setNamingError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // --- State for copy feedback ---
  const [copiedMessageId, setCopiedMessageId] = useState<number | string | null>(null);
  // --- End state ---

  const handleStarClick = (message: ChatMessage) => {
    // ... (star logic remains the same)
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
    // ... (confirm name logic remains the same)
    if (!messageToName || activeChatId === null || !activeSessionId) return;
    const finalName = templateNameInput.trim();
    if (!finalName) { setNamingError("Please enter a name for the starred template."); return; }
    const queryKey = ['chat', activeSessionId, activeChatId];
    queryClient.setQueryData<ChatSession>(queryKey, (oldData) => {
      if (!oldData) return oldData;
      return { ...oldData, messages: (oldData.messages || []).map(msg => msg.id === messageToName.id ? { ...msg, starred: true, starredName: finalName } : msg), };
    });
    handleCancelName();
  };

  // --- Copy Handler ---
  const handleCopyClick = (messageId: number | string, textToCopy: string) => {
      navigator.clipboard.writeText(textToCopy)
          .then(() => {
              setCopiedMessageId(messageId);
              // Optional: Use toast instead of changing icon
              setToastMessage("Copied to clipboard!");
              setTimeout(() => setCopiedMessageId(null), 1500); // Reset after 1.5s
          })
          .catch(err => {
              console.error('Failed to copy text: ', err);
              setToastMessage("Error copying text.");
          });
  };
  // --- End Copy Handler ---

  // Helper to get a unique key for messages (handles temporary string IDs)
  const getMessageKey = (msg: ChatMessage | StreamingMessage | { id: number | string }): string => {
      return `msg-${msg.id}`;
  };


  return (
    <>
      <Box className="space-y-3 p-1">
        {/* ... (empty state rendering remains the same) ... */}
        {chatMessages.map((msg) => (
          <Flex
            key={getMessageKey(msg)} // Use helper for key
            gap="2"
            align="start"
            className="group relative" // Keep group for hover effects
            justify={msg.sender === 'user' ? 'end' : 'start'}
          >
            {/* --- Render AI message --- */}
            {msg.sender === 'ai' && (
              // --- Add position: relative and padding-right ---
              <Box
                  style={{ maxWidth: 'calc(100% - 1rem)', position: 'relative', paddingRight: '2rem' }} // Add relative positioning and padding
                  className={cn('rounded-lg p-2 px-3 text-sm shadow-sm break-words', 'bg-[--gray-a3] text-[--gray-a12]')} >
                 {/* Copy Button */}
                 <Tooltip content="Copy message">
                     <IconButton
                         variant="ghost" color="gray" size="1" highContrast
                         className="absolute top-1 right-1 opacity-0 group-hover:opacity-70 focus-visible:opacity-100 transition-opacity"
                         style={{ zIndex: 5 }} // Ensure it's clickable
                         onClick={() => handleCopyClick(msg.id, msg.text)}
                         aria-label="Copy message"
                     >
                         {/* Show Check icon temporarily on success */}
                         {copiedMessageId === msg.id ? <CheckIcon /> : <CopyIcon />}
                     </IconButton>
                 </Tooltip>
                 {/* Content */}
                {shouldRenderMarkdown ? (
                    <div className="markdown-ai-message">
                        <ReactMarkdown>{msg.text}</ReactMarkdown>
                    </div>
                 ) : (
                    <Text size="2">{msg.text}</Text>
                 )}
              </Box>
            )}
            {/* --- Render User message --- */}
            {msg.sender === 'user' && (
              <>
                <Box className="flex-shrink-0 self-center mt-px">
                   {/* Star/Unstar button */}
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
                 {/* --- Add position: relative and padding-right --- */}
                <Box
                    style={{ maxWidth: 'calc(100% - 2rem)', position: 'relative', paddingRight: '2rem' }} // Add relative positioning and padding
                    className={cn('rounded-lg p-2 px-3 text-sm shadow-sm break-words', 'bg-blue-600 text-white dark:bg-blue-500 dark:text-white')} >
                   {/* Copy Button */}
                    <Tooltip content="Copy message">
                        <IconButton
                            variant="ghost" color="gray" size="1" highContrast
                            // Adjust color for dark background
                            className="absolute top-1 right-1 opacity-0 group-hover:opacity-70 focus-visible:opacity-100 transition-opacity text-white/70 hover:text-white/90"
                            style={{ zIndex: 5 }}
                            onClick={() => handleCopyClick(msg.id, msg.text)}
                            aria-label="Copy message"
                        >
                            {copiedMessageId === msg.id ? <CheckIcon /> : <CopyIcon />}
                        </IconButton>
                    </Tooltip>
                    {/* Content */}
                  <Text size="2">{msg.text}</Text>
                </Box>
              </>
            )}
          </Flex>
        ))}

        {/* Render the streaming AI message */}
        {streamingMessage && (
            <Flex
                key={getMessageKey(streamingMessage)} // Use helper for key
                gap="2"
                align="start"
                justify="start"
                className="group relative" // Add group for hover effect on copy button
            >
                {/* --- Add position: relative and padding-right --- */}
                <Box
                    style={{ maxWidth: 'calc(100% - 1rem)', position: 'relative', paddingRight: '2rem' }} // Add relative positioning and padding
                    className={cn('rounded-lg p-2 px-3 text-sm shadow-sm break-words', 'bg-[--gray-a3] text-[--gray-a11]')}
                >
                    {/* Copy Button (appears when stream finishes, maybe disable while streaming?) */}
                    <Tooltip content="Copy message">
                        <IconButton
                            variant="ghost" color="gray" size="1" highContrast
                            className="absolute top-1 right-1 opacity-0 group-hover:opacity-70 focus-visible:opacity-100 transition-opacity"
                            style={{ zIndex: 5 }}
                            onClick={() => handleCopyClick(streamingMessage.id, streamingMessage.content)}
                             // Consider disabling while streaming if copy isn't desired until finished
                            // disabled={true}
                            aria-label="Copy message"
                        >
                            {/* Only show check if this specific temp ID was copied */}
                            {copiedMessageId === streamingMessage.id ? <CheckIcon /> : <CopyIcon />}
                        </IconButton>
                    </Tooltip>
                     {/* Content */}
                    {shouldRenderMarkdown ? (
                         <div className="markdown-ai-message">
                            <ReactMarkdown>
                                {/* Append cursor effect manually */}
                                {streamingMessage.content + '█'}
                            </ReactMarkdown>
                         </div>
                     ) : (
                         <Text size="2">
                            {streamingMessage.content}
                            {/* Blinking cursor effect */}
                            <span className="inline-block w-1 h-4 bg-gray-500 dark:bg-gray-400 ml-px animate-pulse align-baseline"></span>
                         </Text>
                     )}
                 </Box>
            </Flex>
        )}
        {/* End streaming message */}

      </Box>

      {/* Naming Dialog (remains the same) */}
      <Dialog.Root open={isNamingDialogOpen} onOpenChange={(open) => !open && handleCancelName()}>
         {/* ... dialog content ... */}
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
            <Dialog.Close> <Button variant="soft" color="gray" onClick={handleCancelName}> <Cross2Icon /> Cancel </Button> </Dialog.Close>
            <Button onClick={handleConfirmName}> <CheckIcon /> Save Template </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
}
