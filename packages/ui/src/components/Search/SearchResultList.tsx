// =========================================
// File: packages/ui/src/components/Search/SearchResultList.tsx
// =========================================
/* packages/ui/src/components/Search/SearchResultList.tsx */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Card, Flex, Text, Badge, Tooltip } from '@radix-ui/themes';
import { ChatBubbleIcon, FileTextIcon, PersonIcon, BookmarkIcon } from '@radix-ui/react-icons';
import type { SearchResultItem } from '../../types';
import { formatTimestamp } from '../../helpers';
import { cn } from '../../utils';

interface SearchResultListProps {
    results: SearchResultItem[];
    query: string;
}

// Helper to format milliseconds timestamp to MM:SS
const formatParagraphTimestamp = (ms: number | undefined): string => {
    if (ms === undefined || isNaN(ms)) return '';
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

export function SearchResultList({ results, query }: SearchResultListProps) {
    const navigate = useNavigate();

    const handleResultClick = (item: SearchResultItem) => {
        let path = '/';
        let navigationState = {};

        if (item.type === 'chat') {
            if (item.chatId === null) {
                console.warn("Skipping navigation for chat item with null chatId:", item);
                return;
            }
            path = item.sessionId
                ? `/sessions/${item.sessionId}/chats/${item.chatId}`
                : `/chats/${item.chatId}`;
            // navigationState = { highlightMessageId: item.id }; // TODO: Implement message highlighting
        } else if (item.type === 'transcript' && item.sessionId) {
            path = `/sessions/${item.sessionId}`;
            // navigationState = { highlightParagraphIndex: item.id }; // item.id holds paragraphIndex for transcript results
            // TODO: Implement paragraph highlighting in SessionView/Transcription
        } else {
             console.warn("Unknown search result type or missing ID:", item);
             return;
        }

        console.log(`Navigating to ${path} for search result item:`, item);
        navigate(path, { state: navigationState });
    };

    // WARNING: Using dangerouslySetInnerHTML requires trusting the backend snippet generation.
    // Backend currently sends full text, so highlighting is not performed here.
    const renderSnippet = (snippet: string) => {
        return { __html: snippet };
    };

    // --- Only render the header if there are results to display ---
    if (results.length === 0) {
        // Return null or a specific message if needed,
        // but LandingPage now handles the "No results match filters" case.
        return null;
    }

    return (
        <Card size="2" mt="4">
            {/* Header: Showing X results... */}
            <Box mb="3">
                <Text size="2" color="gray">
                    Showing {results.length} results for <Text weight="bold">"{query}"</Text>
                </Text>
            </Box>
            {/* Results List */}
            <Flex direction="column" gap="3">
                {results.map((item) => {
                    const isChat = item.type === 'chat';
                    const isTranscript = item.type === 'transcript';

                    let displayText = '';
                    let displayIcon = <ChatBubbleIcon className="text-gray-500 flex-shrink-0" />;
                    let displayTooltip = item.sessionId ? "Session Chat Message" : "Standalone Chat Message";

                    if (isChat && item.sender) {
                        displayText = `${item.sender === 'user' ? 'User' : 'AI'} @ ${formatTimestamp(item.timestamp)}`;
                    } else if (isTranscript) {
                        displayText = `Paragraph ${item.id} @ ${formatParagraphTimestamp(item.timestamp)}`;
                        displayIcon = <FileTextIcon className="text-gray-500 flex-shrink-0" />;
                        displayTooltip = "Transcript Paragraph";
                    } else {
                        displayText = `Unknown @ ${formatTimestamp(item.timestamp)}`;
                    }

                    return (
                        <Box
                            key={`${item.type}-${item.sessionId ?? 'null'}-${item.chatId ?? 'null'}-${item.id}`}
                            p="3"
                            style={{ backgroundColor: 'var(--gray-a2)', borderRadius: 'var(--radius-3)', cursor: 'pointer' }}
                            onClick={() => handleResultClick(item)}
                            tabIndex={0}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleResultClick(item); }}
                            aria-label={`Search result from ${isChat ? item.sender ?? 'chat' : 'transcript'}, click to view`}
                        >
                            <Flex justify="between" align="start" mb="2" gap="2">
                                <Flex align="center" gap="2" style={{ minWidth: 0 }}>
                                    <Tooltip content={displayTooltip}>
                                        {displayIcon}
                                    </Tooltip>
                                    <Text size="1" weight="medium" color="gray" truncate>
                                        {displayText}
                                    </Text>
                                </Flex>
                                <Tooltip content="Search Relevance Rank (Index-based)">
                                    <Badge variant="soft" color="gray" size="1">Rank {item.rank.toFixed(0)}</Badge>
                                </Tooltip>
                            </Flex>
                            <Text
                                as="p"
                                size="2"
                                style={{ lineHeight: 1.5 }}
                                dangerouslySetInnerHTML={renderSnippet(item.snippet)}
                            />
                             {/* Context display - Now includes Client Name and Tags */}
                             <Flex justify="end" mt="1" gap="3">
                                {item.clientName && (
                                    <Tooltip content={`Client: ${item.clientName}`}>
                                         <Flex align="center" gap="1">
                                            <PersonIcon width="12" height="12" className="text-gray-500"/>
                                            <Text size="1" color="gray" truncate>{item.clientName}</Text>
                                        </Flex>
                                    </Tooltip>
                                )}
                                {/* Display Session ID only if no client name is shown (for context) */}
                                {!item.clientName && item.sessionId && (
                                     <Tooltip content={`Session ID: ${item.sessionId}`}>
                                         <Flex align="center" gap="1">
                                             <Text size="1" color="gray">Session {item.sessionId}</Text>
                                         </Flex>
                                     </Tooltip>
                                )}
                                {item.tags && item.tags.length > 0 && (
                                    <Tooltip content={`Tags: ${item.tags.join(', ')}`}>
                                        <Flex align="center" gap="1">
                                            <BookmarkIcon width="12" height="12" className="text-gray-500"/>
                                            <Text size="1" color="gray" truncate>{item.tags[0]}{item.tags.length > 1 ? ` (+${item.tags.length - 1})` : ''}</Text>
                                        </Flex>
                                    </Tooltip>
                                )}
                                {/* Display Chat ID only if no tags are shown (for context) */}
                                {(!item.tags || item.tags.length === 0) && item.chatId && (
                                    <Tooltip content={`Chat ID: ${item.chatId}`}>
                                        <Flex align="center" gap="1">
                                            <ChatBubbleIcon width="12" height="12" className="text-gray-500"/>
                                            <Text size="1" color="gray">{item.chatId}</Text>
                                        </Flex>
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
// TODO comments should not be removed
