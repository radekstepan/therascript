/* packages/ui/src/components/Search/SearchResultList.tsx */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Card, Flex, Text, Badge, Tooltip } from '@radix-ui/themes';
import { ChatBubbleIcon, FileTextIcon } from '@radix-ui/react-icons';
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
            // --- FIX: Ensure chatId is present for chat types ---
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
    // For now, we assume the backend doesn't add dangerous tags. A safer approach is needed.
    // Backend currently sends full text, so highlighting is removed here.
    const renderSnippet = (snippet: string) => {
        // Simple display of the text for now
        return { __html: snippet };
    };

    return (
        <Card size="2" mt="4">
            <Box mb="3">
                <Text size="2" color="gray">
                    Found {results.length} results for <Text weight="bold">"{query}"</Text>
                </Text>
            </Box>
            <Flex direction="column" gap="3">
                {results.map((item) => {
                    const isChat = item.type === 'chat';
                    const isTranscript = item.type === 'transcript';

                    // --- FIX: Correct logic for displayText based on type ---
                    let displayText = '';
                    let displayIcon = <ChatBubbleIcon className="text-gray-500 flex-shrink-0" />;
                    let displayTooltip = item.sessionId ? "Session Chat Message" : "Standalone Chat Message";

                    if (isChat && item.sender) {
                        displayText = `${item.sender === 'user' ? 'User' : 'AI'} @ ${formatTimestamp(item.timestamp)}`;
                    } else if (isTranscript) {
                        // For transcripts, use item.id (paragraphIndex) and item.timestamp (timestampMs)
                        displayText = `Paragraph ${item.id} @ ${formatParagraphTimestamp(item.timestamp)}`;
                        displayIcon = <FileTextIcon className="text-gray-500 flex-shrink-0" />;
                        displayTooltip = "Transcript Paragraph";
                    } else {
                        // Fallback for unexpected data
                        displayText = `Unknown @ ${formatTimestamp(item.timestamp)}`;
                    }
                    // --- END FIX ---

                    return (
                        <Box
                            key={`${item.type}-${item.sessionId ?? 'null'}-${item.chatId ?? 'null'}-${item.id}`} // Improved key uniqueness
                            p="3"
                            style={{ backgroundColor: 'var(--gray-a2)', borderRadius: 'var(--radius-3)', cursor: 'pointer' }}
                            onClick={() => handleResultClick(item)}
                            tabIndex={0} // Make it focusable
                            onKeyDown={(e) => { if (e.key === 'Enter') handleResultClick(item); }}
                            aria-label={`Search result from ${isChat ? item.sender ?? 'chat' : 'transcript'}, click to view`} // Adjusted label
                        >
                            <Flex justify="between" align="start" mb="2" gap="2">
                                <Flex align="center" gap="2" style={{ minWidth: 0 }}>
                                    {/* --- FIX: Use displayIcon and displayTooltip --- */}
                                    <Tooltip content={displayTooltip}>
                                        {displayIcon}
                                    </Tooltip>
                                    {/* --- END FIX --- */}
                                    {/* --- FIX: Use displayText --- */}
                                    <Text size="1" weight="medium" color="gray" truncate>
                                        {displayText}
                                    </Text>
                                    {/* --- END FIX --- */}
                                </Flex>
                                <Tooltip content="Search Relevance Rank (Index-based)">
                                    {/* Rank formatting unchanged */}
                                    <Badge variant="soft" color="gray" size="1">Rank {item.rank.toFixed(0)}</Badge>
                                </Tooltip>
                            </Flex>
                            {/* Snippet rendering unchanged */}
                            <Text
                                as="p"
                                size="2"
                                style={{ lineHeight: 1.5 }}
                                dangerouslySetInnerHTML={renderSnippet(item.snippet)}
                            />
                             {/* Context display unchanged */}
                             <Flex justify="end" mt="1">
                                {item.sessionId && (
                                    <Text size="1" color="gray">Session {item.sessionId}</Text>
                                )}
                                {item.chatId && (
                                    <Text size="1" color="gray" ml={item.sessionId ? "2" : "0"}>Chat {item.chatId}</Text>
                                )}
                             </Flex>
                        </Box>
                    );
                })}
            </Flex>
        </Card>
    );
}
