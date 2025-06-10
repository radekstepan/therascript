import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom'; // Added useLocation
import { Box, Card, Flex, Text, Badge, Tooltip } from '@radix-ui/themes';
import {
  ChatBubbleIcon,
  FileTextIcon,
  PersonIcon,
  BookmarkIcon,
} from '@radix-ui/react-icons';
import type { SearchResultItem } from '../../types';
import { formatTimestamp } from '../../helpers';

const formatParagraphTimestamp = (ms: number | undefined): string => {
  if (ms === undefined || isNaN(ms)) return '';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

interface SearchResultListProps {
  results: SearchResultItem[];
  query: string;
  totalHits: number; // Add total hits for display
}

export function SearchResultList({
  results,
  query,
  totalHits,
}: SearchResultListProps) {
  const navigate = useNavigate();
  const location = useLocation(); // Get current location

  const handleResultClick = (item: SearchResultItem) => {
    let path = '/';
    let hash = '';

    if (item.type === 'chat') {
      if (item.chatId === null || item.chatId === undefined) {
        console.warn(
          'Skipping navigation for chat item with null/undefined chatId:',
          item
        );
        return;
      }
      path = item.sessionId
        ? `/sessions/${item.sessionId}/chats/${item.chatId}`
        : `/chats/${item.chatId}`;
    } else if (item.type === 'transcript' && item.sessionId) {
      path = `/sessions/${item.sessionId}`;
      // item.id for transcript is sessionId_paragraphIndex
      // We need to extract the paragraphIndex part for the hash.
      // The item.id is the ES document ID, which for transcripts is sessionId_paragraphIndex
      const idParts = String(item.id).split('_');
      if (idParts.length > 1) {
        const paragraphIndex = idParts[idParts.length - 1];
        if (!isNaN(parseInt(paragraphIndex, 10))) {
          hash = `#paragraph-${paragraphIndex}`;
        } else {
          console.warn(
            `Could not parse paragraphIndex from transcript item.id: ${item.id}`
          );
        }
      } else {
        console.warn(
          `Transcript item.id format unexpected: ${item.id}. Expected 'sessionId_paragraphIndex'.`
        );
      }
    } else {
      console.warn('Unknown search result type or missing ID:', item);
      return;
    }
    console.log(`Navigating to ${path}${hash} for search result item:`, item);

    // If already on the same base path, React Router might not trigger a re-render
    // that useEffects listening to `location.hash` would catch without a full navigation.
    // Explicitly navigate.
    if (location.pathname === path && location.hash === hash) {
      // If already on the exact URL, manually trigger scroll if possible
      const elementId = hash.substring(1); // remove #
      const targetElement = document.getElementById(elementId);
      if (targetElement) {
        targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } else {
      navigate({ pathname: path, hash: hash });
    }
  };

  const renderSnippet = (item: SearchResultItem) => {
    // Prefer highlighted snippet if available
    if (item.highlights?.text && item.highlights.text.length > 0) {
      return { __html: item.highlights.text.join(' ... ') }; // Join if multiple fragments
    }
    return { __html: item.snippet }; // Fallback to plain snippet (already HTML escaped by ES usually)
  };

  if (results.length === 0) {
    return null; // Handled by LandingPage for "No results"
  }

  return (
    <Card size="2" mt="4">
      <Box mb="3">
        <Text size="2" color="gray">
          Showing {results.length} of {totalHits} results for{' '}
          <Text weight="bold">"{query}"</Text>
        </Text>
      </Box>
      <Flex direction="column" gap="3">
        {results.map((item) => {
          const isChat = item.type === 'chat';
          const isTranscript = item.type === 'transcript';
          let displayText = '';
          let displayIcon = (
            <ChatBubbleIcon className="text-gray-500 flex-shrink-0" />
          );
          let displayTooltip = item.sessionId
            ? 'Session Chat Message'
            : 'Standalone Chat Message';

          if (isChat && item.sender) {
            displayText = `${item.sender === 'user' ? 'User' : 'AI'} @ ${formatTimestamp(item.timestamp)}`;
          } else if (isTranscript) {
            // item.id for transcript is sessionId_paragraphIndex, extract paragraphIndex for display
            const parts = String(item.id).split('_');
            const paragraphIndexDisplay =
              parts.length > 1
                ? parts[parts.length - 1]
                : String(item.id).substring(String(item.sessionId).length + 1);
            displayText = `Paragraph ${paragraphIndexDisplay} @ ${formatParagraphTimestamp(item.timestamp)}`;
            displayIcon = (
              <FileTextIcon className="text-gray-500 flex-shrink-0" />
            );
            displayTooltip = 'Transcript Paragraph';
          } else {
            displayText = `Unknown @ ${formatTimestamp(item.timestamp)}`;
          }

          return (
            <Box
              key={`${item.type}-${item.id}`}
              p="3"
              style={{
                backgroundColor: 'var(--gray-a2)',
                borderRadius: 'var(--radius-3)',
                cursor: 'pointer',
              }}
              onClick={() => handleResultClick(item)}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleResultClick(item);
              }}
              aria-label={`Search result from ${item.type}, click to view`}
            >
              <Flex justify="between" align="start" mb="2" gap="2">
                <Flex align="center" gap="2" style={{ minWidth: 0 }}>
                  <Tooltip content={displayTooltip}>{displayIcon}</Tooltip>
                  <Text size="1" weight="medium" color="gray" truncate>
                    {displayText}
                  </Text>
                </Flex>
                {item.score !== undefined && (
                  <Tooltip
                    content={`Relevance Score: ${item.score.toFixed(2)}`}
                  >
                    <Badge variant="soft" color="gray" size="1">
                      Score {item.score.toFixed(2)}
                    </Badge>
                  </Tooltip>
                )}
              </Flex>
              <Text
                as="p"
                size="2"
                style={{ lineHeight: 1.5 }}
                dangerouslySetInnerHTML={renderSnippet(item)}
              />
              <Flex justify="end" mt="2" gap="3">
                {item.clientName && (
                  <Tooltip content={`Client: ${item.clientName}`}>
                    <Flex align="center" gap="1">
                      <PersonIcon
                        width="12"
                        height="12"
                        className="text-gray-500"
                      />
                      <Text size="1" color="gray" truncate>
                        {item.clientName}
                      </Text>
                    </Flex>
                  </Tooltip>
                )}
                {item.tags && item.tags.length > 0 && (
                  <Tooltip content={`Tags: ${item.tags.join(', ')}`}>
                    <Flex align="center" gap="1">
                      <BookmarkIcon
                        width="12"
                        height="12"
                        className="text-gray-500"
                      />
                      <Text size="1" color="gray" truncate>
                        {item.tags[0]}
                        {item.tags.length > 1
                          ? ` (+${item.tags.length - 1})`
                          : ''}
                      </Text>
                    </Flex>
                  </Tooltip>
                )}
                {!item.clientName && item.sessionId && (
                  <Tooltip content={`Session ID: ${item.sessionId}`}>
                    <Text size="1" color="gray">
                      S: {item.sessionId}
                    </Text>
                  </Tooltip>
                )}
                {(!item.tags || item.tags.length === 0) && item.chatId && (
                  <Tooltip content={`Chat ID: ${item.chatId}`}>
                    <Text size="1" color="gray">
                      C: {item.chatId}
                    </Text>
                  </Tooltip>
                )}
              </Flex>
            </Box>
          );
        })}
      </Flex>
    </Card>
  );
}
