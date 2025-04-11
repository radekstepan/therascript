// src/components/LandingPage.tsx
import React, { useEffect, useState } from 'react';
// ** Import Jotai hooks and atoms **
import { useAtomValue, useSetAtom } from 'jotai';
import { useNavigate } from 'react-router-dom';
import { CounterClockwiseClockIcon, PlusCircledIcon } from '@radix-ui/react-icons';
import { SessionListTable } from './SessionListTable';
import { Button, Card, Flex, Heading, Text, Box, Container, Spinner } from '@radix-ui/themes';
import { UserThemeDropdown } from '../User/UserThemeDropdown';
import { fetchSessions } from '../../api/api';
import type { Session } from '../../types'; // Keep Session type import
// ** Import relevant atoms **
import {
    openUploadModalAtom,
    sessionSortCriteriaAtom,
    sessionSortDirectionAtom,
    setSessionSortAtom,
    SessionSortCriteria,
    pastSessionsAtom,      // Atom holding the raw session list
    sortedSessionsAtom     // Atom deriving the sorted list
} from '../../store';

export function LandingPage() {
    // ** Remove local state for sessions list **
    // const [sessions, setSessions] = useState<Session[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // ** Jotai state management **
    const openUploadModal = useSetAtom(openUploadModalAtom);
    const currentSortCriteria = useAtomValue(sessionSortCriteriaAtom);
    const currentSortDirection = useAtomValue(sessionSortDirectionAtom);
    const setSort = useSetAtom(setSessionSortAtom);
    const setPastSessions = useSetAtom(pastSessionsAtom); // Setter for the global session list
    const sortedSessions = useAtomValue(sortedSessionsAtom); // ** Read the sorted list directly from the atom **

    const navigate = useNavigate();

    // ** useEffect to fetch sessions and update GLOBAL state **
    useEffect(() => {
        const loadSessions = async () => {
            try {
                setIsLoading(true);
                setError(null); // Clear previous errors
                const data = await fetchSessions();
                console.log('[LandingPage] Fetched sessions:', data);
                // ** Update the global pastSessionsAtom **
                setPastSessions(data);
            } catch (err) {
                console.error("Failed to load sessions:", err);
                setError('Failed to load sessions.');
                 setPastSessions([]); // Clear sessions on error
            } finally {
                setIsLoading(false);
            }
        };
        loadSessions();
    // Run only once on mount, or add dependencies if needed (e.g., user login)
    // Pass the atom setter function to the dependency array
    }, [setPastSessions]);

    // Handler for sorting (passed to table)
    const handleSort = (criteria: SessionSortCriteria) => {
        console.log("[LandingPage] handleSort called with criteria:", criteria);
        setSort(criteria); // Calls the action atom to update sort state
    };

    // --- Render Logic ---

    if (isLoading) {
        return (
            <Flex justify="center" align="center" style={{ height: '100vh' }}>
                <Spinner size="3" />
                <Text ml="2">Loading sessions...</Text>
            </Flex>
        );
    }

    // Display error state
    if (error) {
         return (
            <Flex direction="column" justify="center" align="center" style={{ height: '100vh', padding: '2rem' }}>
                <Text color="red" mb="4">{error}</Text>
                 <Button onClick={() => window.location.reload()} variant="soft"> {/* Simple refresh */}
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
                            {/* ** Use the sortedSessions from the atom ** */}
                            {sortedSessions.length === 0 ? (
                                <Flex flexGrow="1" align="center" justify="center" p="6">
                                    <Text color="gray">No sessions found. Upload one to get started!</Text>
                                </Flex>
                            ) : (
                                <SessionListTable
                                    // ** Pass the sorted sessions from the atom **
                                    sessions={sortedSessions}
                                    sortCriteria={currentSortCriteria}
                                    sortDirection={currentSortDirection}
                                    onSort={handleSort} // Pass the handler
                                />
                            )}
                        </Box>
                    </Card>
                </Container>
            </Box>
        </Box>
    );
}
