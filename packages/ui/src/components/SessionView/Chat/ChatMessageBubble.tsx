// packages/ui/src/components/SessionView/Chat/ChatMessageBubble.tsx
import React, { useRef } from 'react'; // Added useRef
import {
  Box,
  Flex,
  Text,
  IconButton,
  Tooltip,
  Spinner,
} from '@radix-ui/themes';
import { StarIcon, StarFilledIcon, CopyIcon } from '@radix-ui/react-icons';
import ReactMarkdown from 'react-markdown';
import { cn } from '../../../utils';
import { useAnimatedText } from '../../../hooks/useAnimatedText'; // Import the hook
import type { ChatMessage } from '../../../types';

interface ChatMessageBubbleProps {
  message: ChatMessage;
  isCurrentlyStreaming: boolean;
  isAiResponding: boolean; // Pass this down
  renderMd: boolean;
  onStarClick: (message: ChatMessage) => void; // Callback for starring
  // Updated onCopyClick prop signature
  onCopyClick: (payload: { text: string; html?: string }) => void;
}

export function ChatMessageBubble({
  message,
  isCurrentlyStreaming,
  isAiResponding,
  renderMd,
  onStarClick,
  onCopyClick,
}: ChatMessageBubbleProps) {
  const animatedText = useAnimatedText(
    message.text,
    message.sender === 'ai' && isCurrentlyStreaming // Enable only for streaming AI message
  );

  const displayText = isCurrentlyStreaming ? animatedText : message.text;
  const showWaitingIndicator =
    isAiResponding && isCurrentlyStreaming && displayText === '';

  // Ref for the Markdown content container
  const markdownContainerRef = useRef<HTMLDivElement>(null);

  // Copy button logic
  const showCopyButton = message.sender === 'ai' && !isCurrentlyStreaming;

  const handleCopy = () => {
    if (message.sender === 'ai' && renderMd && markdownContainerRef.current) {
      onCopyClick({
        html: markdownContainerRef.current.innerHTML,
        text: message.text, // Original Markdown source as fallback
      });
    } else {
      onCopyClick({ text: message.text });
    }
  };

  return (
    <Flex
      key={message.id}
      direction="column"
      align={message.sender === 'user' ? 'end' : 'start'}
    >
      <Box
        p="3"
        className={cn(
          'rounded-md shadow-sm max-w-[85%] relative group',
          message.sender === 'user'
            ? 'bg-[--accent-a3] text-[--accent-a11]'
            : 'bg-[--gray-a3] text-[--gray-a12]',
          showWaitingIndicator && 'min-h-[3rem]'
        )}
      >
        {/* Star Button (Action to create template) */}
        {message.sender === 'user' && (
          <Tooltip content={'Save as template'}>
            <IconButton
              variant="ghost"
              color={'gray'}
              size="1"
              className={cn(
                'absolute top-1 right-1 p-0.5 transition-opacity z-10',
                'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
              )}
              onClick={() => onStarClick(message)}
              aria-label={'Save message as template'}
            >
              <StarIcon width={14} height={14} />
            </IconButton>
          </Tooltip>
        )}

        {/* Copy Button */}
        {showCopyButton && (
          <Tooltip content="Copy message text">
            <IconButton
              variant="ghost"
              color="gray"
              size="1"
              className="absolute top-1 right-1 p-0.5 transition-opacity opacity-0 group-hover:opacity-100 focus-visible:opacity-100 z-10"
              onClick={handleCopy} // Use the new handleCopy function
              aria-label="Copy message text"
            >
              <CopyIcon width={14} height={14} />
            </IconButton>
          </Tooltip>
        )}

        {/* Message Content */}
        {showWaitingIndicator ? (
          <Flex
            align="center"
            justify="center"
            gap="2"
            className="h-full py-1 text-[--gray-a10]"
          >
            <Spinner size="1" />
            <Text size="1" style={{ fontStyle: 'italic' }}>
              Waiting for response...
            </Text>
          </Flex>
        ) : (
          <>
            {message.sender === 'ai' && renderMd ? (
              <Box className="markdown-ai-message" ref={markdownContainerRef}>
                {' '}
                {/* Assign ref here */}
                <ReactMarkdown>{displayText}</ReactMarkdown>
              </Box>
            ) : (
              <Text
                size="2"
                style={{
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {displayText}
              </Text>
            )}
          </>
        )}
      </Box>
    </Flex>
  );
}
