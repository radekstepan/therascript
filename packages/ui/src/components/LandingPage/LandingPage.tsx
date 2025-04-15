import React, { useMemo } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { CounterClockwiseClockIcon, PlusCircledIcon } from '@radix-ui/react-icons';
import { useQuery } from '@tanstack/react-query';
import { SessionListTable } from './SessionListTable';
import { Button, Card, Flex, Heading, Text, Box, Container, Spinner } from '@radix-ui/themes';
import { UserThemeDropdown } from '../User/UserThemeDropdown';
import { fetchSessions } from '../../api/api';
import {
    openUploadModalAtom,
    sessionSortCriteriaAtom,
    sessionSortDirectionAtom,
    setSessionSortAtom,
    SessionSortCriteria, // Keep type
    // Remove pastSessionsAtom, sortedSessionsAtom - handled by useQuery and local sort
} from '../../store';
import type { Session } from '../../types'; // Keep type

export function LandingPage() {
    const openUploadModal = useSetAtom(openUploadModalAtom);
    const currentSortCriteria = useAtomValue(sessionSortCriteriaAtom);
    const currentSortDirection = useAtomValue(sessionSortDirectionAtom);
    const setSort = useSetAtom(setSessionSortAtom);

    // Fetch sessions using Tanstack Query
    const { data: sessions, isLoading, error, refetch } = useQuery<Session[], Error>({
        queryKey: ['sessions'],
        queryFn: fetchSessions,
        // staleTime: 5 * 60 * 1000, // Example: Cache data for 5 minutes
    });

    // Memoized sorting logic, operates on the data from useQuery
    const sortedSessions = useMemo(() => {
        if (!sessions) return [];

        const criteria = currentSortCriteria;
        const direction = currentSortDirection;
        console.log(`[LandingPage] Sorting ${sessions.length} sessions by ${criteria} (${direction})`);

        const sorted = [...sessions].sort((a, b) => {
            let valA: any;
            let valB: any;

            // Determine values based on criteria
            switch (criteria) {
                case 'sessionName':
                    valA = a.sessionName || a.fileName || ''; // Fallback to fileName
                    valB = b.sessionName || b.fileName || '';
                    break;
                case 'clientName':
                    valA = a.clientName || ''; // Default empty string for null/undefined
                    valB = b.clientName || '';
                    break;
                case 'sessionType':
                    valA = a.sessionType || '';
                    valB = b.sessionType || '';
                    break;
                case 'therapy':
                    valA = a.therapy || '';
                    valB = b.therapy || '';
                    break;
                case 'date':
                    // Date comparison needs special handling
                    const dateA = a.date ? new Date(a.date) : null;
                    const dateB = b.date ? new Date(b.date) : null;
                    const timeA = dateA ? dateA.getTime() : NaN;
                    const timeB = dateB ? dateB.getTime() : NaN;

                    // Handle invalid or missing dates consistently (e.g., push to end)
                    if (isNaN(timeA)) return isNaN(timeB) ? 0 : 1; // Place NaN dates after valid dates
                    if (isNaN(timeB)) return -1;
                    return timeA - timeB; // Sort valid dates chronologically
                case 'id': // Sorting by ID might be useful for debugging or default
                    valA = a.id;
                    valB = b.id;
                    break;
                default:
                    // Should not happen if criteria is typed correctly
                    // Use assertion to help TypeScript, though it won't prevent runtime issues if type isn't exhaustive
                    const _exhaustiveCheck: never = criteria;
                    console.warn(`[sortedSessionsAtom] Unknown sort criteria: ${criteria}`);
                    return 0;
            }

            // Generic comparison for non-date fields
            // Handle nulls consistently (e.g., place at the end)
            if (valA === null || valA === undefined) return (valB === null || valB === undefined) ? 0 : 1;
            if (valB === null || valB === undefined) return -1;

            // Compare based on type
            if (typeof valA === 'string' && typeof valB === 'string') {
                return valA.localeCompare(valB, undefined, { sensitivity: 'base' });
            } else if (typeof valA === 'number' && typeof valB === 'number') {
                return valA - valB;
            } else {
                // Fallback: convert to string and compare
                return String(valA).localeCompare(String(valB), undefined, { sensitivity: 'base' });
            }
        });

        if (direction === 'desc') sorted.reverse();
        return sorted;

    }, [sessions, currentSortCriteria, currentSortDirection]);

    // Handler for sorting (passed to table)
    const handleSort = (criteria: SessionSortCriteria) => {
        console.log("[LandingPage] handleSort called with criteria:", criteria);
        setSort(criteria); // Calls the action atom to update sort state
    };

    if (isLoading) {
        return (
            <Flex justify="center" align="center" style={{ height: '100vh' }}>
                <Spinner size="3" />
                <Text ml="2">Loading sessions...</Text>
            </Flex>
        );
    }

    // Display error state
    if (error || (!sessions && !isLoading)) { // Also handle case where sessions is undefined after loading attempt
         return (
            <Flex direction="column" justify="center" align="center" style={{ height: '100vh', padding: '2rem' }}>
                <Text color="red" mb="4">{error?.message || 'Failed to load sessions.'}</Text>
                 <Button onClick={() => refetch()} variant="soft">
                    Try Again
                </Button>
            </Flex>
         );
    }

    // Main content render
    return (
        <Box className="w-full flex-grow flex flex-col">
            {/* Header Bar */}
            <Box
                py="2"
                px={{ initial: '4', md: '6', lg: '8' }}
                flexShrink="0"
                style={{ backgroundColor: 'var(--color-panel-solid)', borderBottom: '1px solid var(--gray-a6)' }}
            >
                <Flex justify="end">
                    <UserThemeDropdown />
                </Flex>
            </Box>
            {/* Main Content Area */}
            <Box className="flex-grow flex flex-col py-4 md:py-6 lg:py-8">
                <Container size="4" className="flex-grow flex flex-col">
                    {/* Session List Card */}
                    <Card size="3" className="flex-grow flex flex-col overflow-hidden h-full">
                        {/* Card Header */}
                        <Flex justify="between" align="center" px="4" pt="4" pb="3" style={{ borderBottom: '1px solid var(--gray-a6)' }}>
                            <Heading as="h2" size="5" weight="medium">
                                <Flex align="center" gap="2">
                                    <CounterClockwiseClockIcon />
                                    Session History
                                </Flex>
                            </Heading>
                            <Button variant="soft" size="2" onClick={openUploadModal} title="Upload New Session" aria-label="Upload New Session">
                                <PlusCircledIcon width="16" height="16" />
                                <Text ml="2">New Session</Text>
                            </Button>
                        </Flex>
                        {/* Card Body - Table or Empty State */}
                        <Box className="flex-grow flex flex-col overflow-hidden">
                            {sortedSessions.length === 0 && !isLoading ? ( // Check isLoading too
                                <Flex flexGrow="1" align="center" justify="center" p="6">
                                    <Text color="gray">No sessions found. Upload one to get started!</Text>
                                </Flex>
                            ) : (
                                <SessionListTable
                                    sessions={sortedSessions}
                                    sortCriteria={currentSortCriteria}
                                    sortDirection={currentSortDirection}
                                    onSort={handleSort}
                                />
                            )}
                        </Box>
                    </Card>
                </Container>
            </Box>
        </Box>
    );
}
