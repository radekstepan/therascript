// packages/ui/src/components/SessionView/Chat/ChatMessageBubble.tsx
import React, { useRef } from 'react';
import { Box, Flex, Text, Spinner, Callout } from '@radix-ui/themes';
import {
  StarIcon,
  CopyIcon,
  ExclamationTriangleIcon,
} from '@radix-ui/react-icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { cn } from '../../../utils';
import { useAnimatedText } from '../../../hooks/useAnimatedText';
import type { ChatMessage } from '../../../types';

interface ChatMessageBubbleProps {
  message: ChatMessage;
  isCurrentlyStreaming: boolean;
  isAiResponding: boolean;
  renderMd: boolean;
  onStarClick: (message: ChatMessage) => void;
  onCopyClick: (payload: { text: string; html?: string }) => void;
  tokensPerSecond?: number | null;
}

export function ChatMessageBubble({
  message,
  isCurrentlyStreaming,
  isAiResponding,
  renderMd,
  onStarClick,
  onCopyClick,
  tokensPerSecond,
}: ChatMessageBubbleProps) {
  const animatedText = useAnimatedText(
    message.text,
    message.sender === 'ai' && isCurrentlyStreaming
  );

  let displayText = isCurrentlyStreaming ? animatedText : message.text;

  let thinkingText: string | null = null;
  const thinkStart = displayText.indexOf('<think>');
  if (thinkStart !== -1) {
    const thinkEnd = displayText.indexOf('</think>');
    if (thinkEnd === -1) {
      thinkingText = displayText.substring(thinkStart + 7);
      // Only show whatever text comes after the incomplete think tag, or before the start.
      displayText = displayText.substring(0, thinkStart);
    } else {
      thinkingText = displayText.substring(thinkStart + 7, thinkEnd);
      displayText =
        displayText.substring(0, thinkStart) +
        displayText.substring(thinkEnd + 8);
    }
  }

  const showWaitingIndicator =
    isAiResponding &&
    isCurrentlyStreaming &&
    displayText === '' &&
    !thinkingText;

  const markdownContainerRef = useRef<HTMLDivElement>(null);

  const showCopyButton = message.sender === 'ai' && !isCurrentlyStreaming;
  const isUser = message.sender === 'user';
  const showMetrics =
    !isUser &&
    message.completionTokens !== null &&
    message.completionTokens !== undefined &&
    message.completionTokens > 0 &&
    message.duration !== null &&
    message.duration !== undefined &&
    message.duration > 10;
  const displayTokensPerSecond = showMetrics
    ? (message.completionTokens! * 1000) / message.duration!
    : (tokensPerSecond ?? null);
  const displayMetrics =
    displayTokensPerSecond !== null || isCurrentlyStreaming;

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
      align="start"
      className="mb-4 group"
    >
      <Box
        px="3"
        py="2"
        className={cn(
          'relative shadow-sm transition-all duration-200 w-fit',
          'max-w-[90%] md:max-w-[85%] lg:max-w-[75%]',
          // Modern bubble shapes: fully rounded with subtle differences
          isUser
            ? 'bg-[var(--accent-9)] text-white rounded-lg ml-auto'
            : 'bg-[var(--gray-2)] text-[var(--gray-12)] rounded-lg border border-[var(--gray-4)]',
          showWaitingIndicator && 'min-h-[3rem] flex items-center'
        )}
        style={{
          // Subtle pop
          boxShadow: isUser
            ? '0 2px 8px -2px var(--accent-a5)'
            : '0 2px 4px -2px rgba(0,0,0,0.05)',
        }}
      >
        {/* Message Content */}
        {showWaitingIndicator ? (
          <Flex align="center" gap="2" className="text-[var(--gray-11)] px-1">
            <Spinner size="1" />
            <Text size="2" style={{ fontStyle: 'italic' }}>
              Analyzing context...
            </Text>
          </Flex>
        ) : (
          <Box className={cn(isUser ? 'text-white' : 'markdown-ai-message')}>
            {thinkingText && (
              <Box
                mb={displayText.trim() ? '3' : '0'}
                className="text-[var(--gray-9)] italic overflow-hidden"
                style={{
                  fontSize: '0.85em',
                  whiteSpace: 'nowrap',
                  textOverflow: 'ellipsis',
                  maxWidth: '100%',
                }}
              >
                {thinkingText}
              </Box>
            )}
            {displayText.trim() !== '' &&
              (!isUser && renderMd ? (
                <Box ref={markdownContainerRef}>
                  <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
                    {displayText}
                  </ReactMarkdown>
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
              ))}
          </Box>
        )}
      </Box>

      {message.isTruncated && (
        <Box
          mt="2"
          width="100%"
          className="max-w-[90%] md:max-w-[85%] lg:max-w-[75%]"
        >
          <Callout.Root color="amber" size="1">
            <Callout.Icon>
              <ExclamationTriangleIcon />
            </Callout.Icon>
            <Callout.Text>
              Context limit reached. Some older messages or parts of the
              transcript were truncated and ignored by the LLM.
            </Callout.Text>
          </Callout.Root>
        </Box>
      )}

      {/* Metrics Row - only for AI messages */}
      {!isUser && displayMetrics && (
        <Flex
          mt="1"
          width="100%"
          justify="start"
          className="text-[var(--gray-9)]"
        >
          <Text size="1">
            {isCurrentlyStreaming
              ? `~${(tokensPerSecond ?? 0).toFixed(1)} tokens/s`
              : `${message.completionTokens} tokens (${displayTokensPerSecond!.toFixed(1)} tokens/s)`}
          </Text>
        </Flex>
      )}
      {/* Action Row */}
      {(showCopyButton || isUser) && (
        <Flex
          mt="1"
          width="100%"
          justify={isUser ? 'end' : 'start'}
          className={cn(
            'opacity-0 group-hover:opacity-100 transition-opacity duration-200',
            'text-[var(--gray-9)]'
          )}
        >
          {showCopyButton && (
            <Flex
              align="center"
              gap="1"
              className="cursor-pointer hover:text-[var(--gray-11)]"
              onClick={handleCopy}
            >
              <CopyIcon width={12} height={12} />
              <Text size="1">Copy</Text>
            </Flex>
          )}
          {isUser && (
            <Flex
              align="center"
              gap="1"
              className="cursor-pointer hover:text-[var(--gray-11)]"
              onClick={() => onStarClick(message)}
            >
              <StarIcon width={12} height={12} />
              <Text size="1">Save as template</Text>
            </Flex>
          )}
        </Flex>
      )}
    </Flex>
  );
}
