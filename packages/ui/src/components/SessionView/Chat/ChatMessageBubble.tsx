// packages/ui/src/components/SessionView/Chat/ChatMessageBubble.tsx
import React, { useRef } from 'react';
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
import { useAnimatedText } from '../../../hooks/useAnimatedText';
import type { ChatMessage } from '../../../types';

interface ChatMessageBubbleProps {
  message: ChatMessage;
  isCurrentlyStreaming: boolean;
  isAiResponding: boolean; // Pass this down
  renderMd: boolean;
  onStarClick: (message: ChatMessage) => void; // Callback for starring
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
    message.sender === 'ai' && isCurrentlyStreaming
  );

  const displayText = isCurrentlyStreaming ? animatedText : message.text;
  const showWaitingIndicator =
    isAiResponding && isCurrentlyStreaming && displayText === '';

  const markdownContainerRef = useRef<HTMLDivElement>(null);

  const showCopyButton = message.sender === 'ai' && !isCurrentlyStreaming;
  const isUser = message.sender === 'user';

  const handleCopy = () => {
    if (message.sender === 'ai' && renderMd && markdownContainerRef.current) {
      onCopyClick({
        html: markdownContainerRef.current.innerHTML,
        text: message.text,
      });
    } else {
      onCopyClick({ text: message.text });
    }
  };

  return (
    <Flex
      key={message.id}
      direction="column"
      align={isUser ? 'end' : 'start'}
      className="mb-2"
    >
      <Box
        p="4"
        className={cn(
          'relative group shadow-sm transition-all duration-200',
          'max-w-[90%] md:max-w-[85%] lg:max-w-[75%]',
          // Modern bubble shapes: fully rounded with subtle differences
          isUser
            ? 'bg-[var(--accent-9)] text-white rounded-2xl'
            : 'bg-[var(--gray-2)] text-[var(--gray-12)] rounded-2xl border border-[var(--gray-4)]',
          showWaitingIndicator && 'min-h-[3rem] flex items-center'
        )}
        style={{
          // Subtle pop
          boxShadow: isUser
            ? '0 2px 8px -2px var(--accent-a5)'
            : '0 2px 4px -2px rgba(0,0,0,0.05)',
        }}
      >
        {/* Star Button */}
        {isUser && (
          <Tooltip content={'Save as template'}>
            <IconButton
              variant="ghost"
              color="gray"
              size="1"
              className={cn(
                'absolute -top-2 -left-2 p-0.5 transition-all z-10 bg-[var(--color-panel-solid)] rounded-full shadow-sm border border-[var(--gray-5)]',
                'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
              )}
              onClick={() => onStarClick(message)}
              aria-label={'Save message as template'}
            >
              <StarIcon width={12} height={12} />
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
              className={cn(
                'absolute top-2 right-2 p-0.5 transition-all z-10',
                'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                'hover:bg-[var(--gray-a4)] rounded-md'
              )}
              onClick={handleCopy}
              aria-label="Copy message text"
            >
              <CopyIcon width={14} height={14} />
            </IconButton>
          </Tooltip>
        )}

        {/* Message Content */}
        {showWaitingIndicator ? (
          <Flex align="center" gap="2" className="text-[var(--gray-11)] px-1">
            <Spinner size="1" />
            <Text size="2" style={{ fontStyle: 'italic' }}>
              Thinking...
            </Text>
          </Flex>
        ) : (
          <Box className={cn(isUser ? 'text-white' : 'markdown-ai-message')}>
            {!isUser && renderMd ? (
              <Box ref={markdownContainerRef}>
                <ReactMarkdown>{displayText}</ReactMarkdown>
              </Box>
            ) : (
              <Text
                size="2"
                style={{
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  lineHeight: 1.6,
                }}
              >
                {displayText}
              </Text>
            )}
          </Box>
        )}
      </Box>
    </Flex>
  );
}
