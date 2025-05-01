// packages/ui/src/components/SessionView/Chat/ChatMessageBubble.tsx
import React from 'react';
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
  onCopyClick: (text: string) => void; // Callback for copying
  isStarMutationPending: boolean; // Pass mutation state
}

export function ChatMessageBubble({
  message,
  isCurrentlyStreaming,
  isAiResponding,
  renderMd,
  onStarClick,
  onCopyClick,
  isStarMutationPending,
}: ChatMessageBubbleProps) {
  // Call the hook unconditionally at the top level
  const animatedText = useAnimatedText(
    message.text,
    message.sender === 'ai' && isCurrentlyStreaming // Enable only for streaming AI message
  );

  // Determine display text
  const displayText = isCurrentlyStreaming ? animatedText : message.text;
  // ===================== CHANGE START =====================
  // REMOVED: const showBlinkingCursor = isCurrentlyStreaming;
  // ===================== CHANGE END =====================

  // Show spinner *only* if AI is responding AND this is the streaming message AND no text has arrived yet
  const showWaitingIndicator =
    isAiResponding && isCurrentlyStreaming && displayText === '';
  // Copy button logic remains the same
  const showCopyButton = message.sender === 'ai' && !isCurrentlyStreaming;

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
          // Add min-height when showing the waiting indicator
          showWaitingIndicator && 'min-h-[3rem]'
        )}
      >
        {/* Star Button */}
        {message.sender === 'user' && (
          <Tooltip
            content={
              message.starred
                ? 'Unstar this message'
                : 'Star this message (Save as template)'
            }
          >
            <IconButton
              variant="ghost"
              color={message.starred ? 'yellow' : 'gray'}
              size="1"
              className={cn(
                'absolute top-1 right-1 p-0.5 transition-opacity z-10',
                message.starred
                  ? 'opacity-100'
                  : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
              )}
              onClick={() => onStarClick(message)}
              aria-label={message.starred ? 'Unstar message' : 'Star message'}
              disabled={isStarMutationPending}
            >
              {message.starred ? (
                <StarFilledIcon width={14} height={14} />
              ) : (
                <StarIcon width={14} height={14} />
              )}
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
              onClick={() => onCopyClick(message.text)}
              aria-label="Copy message text"
            >
              <CopyIcon width={14} height={14} />
            </IconButton>
          </Tooltip>
        )}

        {/* Message Content */}
        {/* ===================== CHANGE START ===================== */}
        {/* Show waiting indicator instead of just spinner */}
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
            {/* Render text or markdown */}
            {message.sender === 'ai' && renderMd ? (
              <Box className="markdown-ai-message">
                <ReactMarkdown>{displayText}</ReactMarkdown>
                {/* Removed cursor span */}
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
                {/* Removed cursor span */}
              </Text>
            )}
            {/* REMOVED: Blinking cursor span */}
            {/* {showBlinkingCursor && (<span ...></span>)} */}
          </>
        )}
        {/* ===================== CHANGE END ===================== */}

        {/* Display Starred Name */}
        {message.starred && message.starredName && (
          <Flex
            align="center"
            gap="1"
            mt="1"
            justify={message.sender === 'user' ? 'end' : 'start'}
          >
            <StarFilledIcon
              width={12}
              height={12}
              className="text-yellow-600"
            />
            <Text size="1" color="gray" style={{ fontStyle: 'italic' }}>
              {message.starredName}
            </Text>
          </Flex>
        )}
      </Box>
    </Flex>
  );
}
