import React from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useNavigate } from 'react-router-dom';
import {
    CounterClockwiseClockIcon,
    PlusCircledIcon,
} from '@radix-ui/react-icons';
import { SessionListTable } from './LandingPage/SessionListTable';
import { Button, Card, Flex, Heading, Text, Box, Container } from '@radix-ui/themes'; // Use Themes components
import {
    openUploadModalAtom,
    sortedSessionsAtom,
    sessionSortCriteriaAtom,
    sessionSortDirectionAtom,
    setSessionSortAtom,
    SessionSortCriteria
} from '../store';
// REMOVED: Unused getBadgeClasses import
// REMOVED: Unused cn import

export function LandingPage() {
  const sortedSessions = useAtomValue(sortedSessionsAtom);
  const openUploadModal = useSetAtom(openUploadModalAtom);

  const currentSortCriteria = useAtomValue(sessionSortCriteriaAtom);
  const currentSortDirection = useAtomValue(sessionSortDirectionAtom);
  const setSort = useSetAtom(setSessionSortAtom);
  const navigate = useNavigate(); // Keep navigate if used by table

  // Handler for sorting to pass down
  const handleSort = (criteria: SessionSortCriteria) => {
      setSort(criteria);
  };


  return (
      // Use Box or Flex with Tailwind for overall page layout if needed outside Card
      <Box className="w-full flex-grow flex flex-col py-4 md:py-6 lg:py-8">
          {/* Add Container here to constrain the LandingPage content width */}
          <Container size="4" className="flex-grow flex flex-col">
              {/* Card takes full height available within the Container */}
              <Card size="3" className="flex-grow flex flex-col overflow-hidden h-full">
                  {/* Header using Flex */}
                  <Flex justify="between" align="center" px="4" pt="4" pb="3" className="border-b">
                      <Heading as="h2" size="5" weight="medium">
                        <Flex align="center" gap="2">
                             <CounterClockwiseClockIcon /> {/* Icon directly in Flex */}
                             Session History
                        </Flex>
                      </Heading>
                      <Button
                           variant="soft" // Use Themes variant
                           size="2" // Use Themes size
                           onClick={openUploadModal}
                           title="Upload New Session"
                           aria-label="Upload New Session"
                      >
                          <PlusCircledIcon width="16" height="16" />
                          <Text ml="2">New Session</Text>
                      </Button>
                 </Flex>
                {/* Content Area */}
                <Box className="flex-grow flex flex-col overflow-hidden"> {/* Remove CardContent padding */}
                    {sortedSessions.length === 0 ? (
                        <Flex flexGrow="1" align="center" justify="center" p="6">
                             <Text color="gray">
                                No sessions found. Upload one to get started!
                             </Text>
                        </Flex>
                    ) : (
                        // Render the extracted table component
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
  );
}
