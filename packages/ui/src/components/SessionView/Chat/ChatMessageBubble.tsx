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
  streamPhase?: 'thinking' | 'responding' | null;
  isAiResponding: boolean;
  renderMd: boolean;
  onStarClick: (message: ChatMessage) => void;
  onCopyClick: (payload: { text: string; html?: string }) => void;
  tokensPerSecond?: number | null;
}

function splitThinkingText(text: string) {
  const thinkRegex = /<think>([\s\S]*?)(<\/think>|$)/g;
  const thinkingParts: string[] = [];
  let visibleText = '';
  let lastIndex = 0;

  for (const match of text.matchAll(thinkRegex)) {
    const matchIndex = match.index ?? 0;
    visibleText += text.slice(lastIndex, matchIndex);
    const reasoningText = match[1]?.trim();
    if (reasoningText) {
      thinkingParts.push(reasoningText);
    }
    lastIndex = matchIndex + match[0].length;
  }

  visibleText += text.slice(lastIndex);

  return {
    thinkingText: thinkingParts.length > 0 ? thinkingParts.join('\n\n') : null,
    visibleText,
  };
}

export function ChatMessageBubble({
  message,
  isCurrentlyStreaming,
  streamPhase,
  isAiResponding,
  renderMd,
  onStarClick,
  onCopyClick,
  tokensPerSecond,
}: ChatMessageBubbleProps) {
  const { thinkingText, visibleText } = splitThinkingText(message.text);
  const animatedText = useAnimatedText(
    visibleText,
    message.sender === 'ai' && isCurrentlyStreaming
  );
  const displayText = isCurrentlyStreaming ? animatedText : visibleText;
  const showThinkingMarquee =
    Boolean(thinkingText) && isCurrentlyStreaming && streamPhase === 'thinking';

  const showWaitingIndicator =
    isAiResponding &&
    isCurrentlyStreaming &&
    streamPhase === 'thinking' &&
    displayText.trim() === '' &&
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

  // Show metrics if we have a real avg tokens/s OR if we are currently streaming (either thinking or responding)
  const displayTokensPerSecond = showMetrics
    ? (message.completionTokens! * 1000) / message.duration!
    : (tokensPerSecond ?? null);

  // If streaming but no tokens yet, we might still show 0.0 or ~0.0 if we have tokensPerSecond
  const displayMetrics =
    displayTokensPerSecond !== null ||
    (isCurrentlyStreaming && tokensPerSecond !== null);

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
            <Box className="thinking-ticker" aria-label="Model is thinking">
              <Box className="thinking-ticker-track">
                <Text size="2" style={{ fontStyle: 'italic' }}>
                  Thinking
                </Text>
                <Text size="2" style={{ fontStyle: 'italic' }}>
                  Reviewing context
                </Text>
                <Text size="2" style={{ fontStyle: 'italic' }}>
                  Preparing response
                </Text>
                <Text size="2" style={{ fontStyle: 'italic' }}>
                  Thinking
                </Text>
                <Text size="2" style={{ fontStyle: 'italic' }}>
                  Reviewing context
                </Text>
                <Text size="2" style={{ fontStyle: 'italic' }}>
                  Preparing response
                </Text>
              </Box>
            </Box>
          </Flex>
        ) : (
          <Box className={cn(isUser ? 'text-white' : 'markdown-ai-message')}>
            {showThinkingMarquee && (
              <Box
                mb={displayText.trim() ? '3' : '0'}
                className="thinking-inline-strip"
                aria-label="Model reasoning"
              >
                <Text size="1" className="thinking-inline-label">
                  Thinking
                </Text>
                <Box className="thinking-inline-marquee">
                  <Box className="thinking-inline-track">
                    <Text size="1" className="thinking-inline-copy">
                      {thinkingText}
                    </Text>
                    <Text
                      size="1"
                      className="thinking-inline-copy"
                      aria-hidden="true"
                    >
                      {thinkingText}
                    </Text>
                  </Box>
                </Box>
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
            {isCurrentlyStreaming && displayTokensPerSecond !== null
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
