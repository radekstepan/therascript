// src/components/LandingPage/LandingPageContent.tsx
import React from 'react';
import { Box, Card, Flex, Heading, Text, Button, Container, Spinner } from '@radix-ui/themes';
import { CounterClockwiseClockIcon, PlusCircledIcon } from '@radix-ui/react-icons';
import { SessionListTable } from './SessionListTable';
import type { Session } from '../../types';
// Import types directly from where they are defined/exported
import type { SessionSortCriteria, SortDirection } from '../../store/sessionAtoms'; // Correct path

interface LandingPageContentProps {
    isLoading: boolean;
    error: string | null;
    sortedSessions: Session[];
    currentSortCriteria: SessionSortCriteria; // Use imported type
    currentSortDirection: SortDirection; // Use imported type
    handleSort: (criteria: SessionSortCriteria) => void; // Use imported type
    openUploadModal: () => void;
}

export function LandingPageContent({
    isLoading, error, sortedSessions, currentSortCriteria,
    currentSortDirection, handleSort, openUploadModal,
}: LandingPageContentProps) {
    if (isLoading) {
        return ( <Flex justify="center" align="center" className="flex-grow"> <Spinner size="3" /> <Text ml="2">Loading sessions...</Text> </Flex> );
    }
    if (error) {
        return ( <Flex direction="column" justify="center" align="center" className="flex-grow p-4"> <Text color="red" mb="4">{error}</Text> <Button onClick={() => window.location.reload()} variant="soft"> Try Again </Button> </Flex> );
    }
    return (
        <Box className="flex-grow flex flex-col py-4 md:py-6 lg:py-8">
            <Container size="4" className="flex-grow flex flex-col">
                <Card size="3" className="flex-grow flex flex-col overflow-hidden h-full">
                     <Flex justify="between" align="center" px="4" pt="4" pb="3" style={{ borderBottom: '1px solid var(--gray-a6)' }}>
                         <Heading as="h2" size="5" weight="medium"> <Flex align="center" gap="2"> <CounterClockwiseClockIcon /> Session History </Flex> </Heading>
                         <Button variant="soft" size="2" onClick={openUploadModal} title="Upload New Session" aria-label="Upload New Session"> <PlusCircledIcon width="16" height="16" /> <Text ml="2">New Session</Text> </Button>
                     </Flex>
                    <Box className="flex-grow flex flex-col overflow-hidden">
                        {sortedSessions.length === 0 ? (
                            <Flex flexGrow="1" align="center" justify="center" p="6"> <Text color="gray">No sessions found. Upload one to get started!</Text> </Flex>
                        ) : (
                            <SessionListTable sessions={sortedSessions} sortCriteria={currentSortCriteria} sortDirection={currentSortDirection} onSort={handleSort} />
                        )}
                    </Box>
                </Card>
            </Container>
        </Box>
    );
}
