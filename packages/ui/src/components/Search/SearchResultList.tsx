// NEW FILE: packages/ui/src/components/Search/SearchResultList.tsx
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Card, Flex, Text, Badge, Tooltip } from '@radix-ui/themes';
import { ChatBubbleIcon, FileTextIcon } from '@radix-ui/react-icons';
import type { SearchResultItem } from '../../types';
import { formatTimestamp } from '../../helpers';

interface SearchResultListProps {
    results: SearchResultItem[];
    query: string;
}

export function SearchResultList({ results, query }: SearchResultListProps) {
    const navigate = useNavigate();

    const handleResultClick = (item: SearchResultItem) => {
        // Construct the correct URL based on whether it's a session or standalone chat
        const path = item.sessionId
            ? `/sessions/${item.sessionId}/chats/${item.chatId}`
            : `/chats/${item.chatId}`;
        // TODO: Ideally, navigate and also scroll/highlight the specific message 'item.id'
        console.log(`Navigating to ${path} for message ID ${item.id}`);
        navigate(path);
    };

    // WARNING: Using dangerouslySetInnerHTML requires trusting the backend snippet generation.
    // The backend should ideally only insert simple, safe tags like <mark> or <strong>.
    // A safer alternative is to parse the snippet and apply highlighting on the frontend.
    const renderSnippet = (snippet: string) => {
        // Simple replacement for backend's [HL] tags with <mark>
        const highlightedHtml = snippet
            .replace(/\[HL\]/g, '<mark style="background-color: var(--yellow-a6); padding: 0.1em 0; border-radius: var(--radius-1);">')
            .replace(/\[\/HL\]/g, '</mark>');
        return { __html: highlightedHtml };
    };

    return (
        <Card size="2" mt="4">
            <Box mb="3">
                <Text size="2" color="gray">
                    Found {results.length} results for <Text weight="bold">"{query}"</Text>
                </Text>
            </Box>
            <Flex direction="column" gap="3">
                {results.map((item) => (
                    <Box
                        key={item.id}
                        p="3"
                        style={{ backgroundColor: 'var(--gray-a2)', borderRadius: 'var(--radius-3)', cursor: 'pointer' }}
                        onClick={() => handleResultClick(item)}
                        tabIndex={0} // Make it focusable
                        onKeyDown={(e) => { if (e.key === 'Enter') handleResultClick(item); }}
                        aria-label={`Search result from ${item.sender}, click to view chat`}
                    >
                        <Flex justify="between" align="start" mb="2" gap="2">
                            <Flex align="center" gap="2" style={{ minWidth: 0 }}>
                                {item.sessionId ? (
                                    <Tooltip content="Session Chat">
                                        <FileTextIcon className="text-gray-500 flex-shrink-0" />
                                    </Tooltip>
                                ) : (
                                    <Tooltip content="Standalone Chat">
                                        <ChatBubbleIcon className="text-gray-500 flex-shrink-0" />
                                    </Tooltip>
                                )}
                                <Text size="1" weight="medium" color="gray" truncate>
                                    {item.sender === 'user' ? 'User' : 'AI'} @ {formatTimestamp(item.timestamp)}
                                </Text>
                            </Flex>
                            <Tooltip content="Search Relevance Rank">
                                <Badge variant="soft" color="gray" size="1">Rank {item.rank.toFixed(2)}</Badge>
                            </Tooltip>
                        </Flex>
                        {/* Render the highlighted snippet */}
                        <Text
                            as="p"
                            size="2"
                            style={{ lineHeight: 1.5 }}
                            dangerouslySetInnerHTML={renderSnippet(item.snippet)}
                        />
                    </Box>
                ))}
            </Flex>
        </Card>
    );
}
