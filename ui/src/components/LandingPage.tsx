// src/components/LandingPage.tsx
import React from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useNavigate } from 'react-router-dom';
import {
    CounterClockwiseClockIcon,
    PlusCircledIcon,
} from '@radix-ui/react-icons';
import { SessionListTable } from './LandingPage/SessionListTable';
import { Button, Card, Flex, Heading, Text, Box, Container } from '@radix-ui/themes';
// Import the dropdown
import { UserThemeDropdown } from './UserThemeDropdown';
import {
    openUploadModalAtom,
    sortedSessionsAtom,
    sessionSortCriteriaAtom,
    sessionSortDirectionAtom,
    setSessionSortAtom,
    SessionSortCriteria
} from '../store';

export function LandingPage() {
  const sortedSessions = useAtomValue(sortedSessionsAtom);
  const openUploadModal = useSetAtom(openUploadModalAtom);

  const currentSortCriteria = useAtomValue(sessionSortCriteriaAtom);
  const currentSortDirection = useAtomValue(sessionSortDirectionAtom);
  const setSort = useSetAtom(setSessionSortAtom);
  const navigate = useNavigate();

  const handleSort = (criteria: SessionSortCriteria) => {
      setSort(criteria);
  };

  return (
      // Outer Box takes full height
      <Box className="w-full flex-grow flex flex-col">

          {/* --- MODIFICATION: Landing Page Header Border Style --- */}
          <Box
             py="2"
             px={{ initial: '4', md: '6', lg: '8' }}
             flexShrink="0"
             // Removed className="border-b"
             style={{
                 backgroundColor: 'var(--color-panel-solid)',
                 borderBottom: '1px solid var(--gray-a6)' // Use Radix variable for border color
             }}
          >
          {/* --- END MODIFICATION --- */}
              <Flex justify="end">
                   <UserThemeDropdown />
              </Flex>
          </Box>

          {/* Content Area with Padding */}
          <Box className="flex-grow flex flex-col py-4 md:py-6 lg:py-8">
              <Container size="4" className="flex-grow flex flex-col">
                  <Card size="3" className="flex-grow flex flex-col overflow-hidden h-full">
                      {/* Card Header */}
                      <Flex
                         justify="between"
                         align="center"
                         px="4" pt="4" pb="3"
                         // Use explicit border style here too for consistency within the card
                         style={{ borderBottom: '1px solid var(--gray-a6)' }}
                       >
                          <Heading as="h2" size="5" weight="medium">
                            <Flex align="center" gap="2">
                                 <CounterClockwiseClockIcon />
                                 Session History
                            </Flex>
                          </Heading>
                          <Button
                               variant="soft"
                               size="2"
                               onClick={openUploadModal}
                               title="Upload New Session"
                               aria-label="Upload New Session"
                          >
                              <PlusCircledIcon width="16" height="16" />
                              <Text ml="2">New Session</Text>
                          </Button>
                      </Flex>
                      {/* Content Table Area */}
                      <Box className="flex-grow flex flex-col overflow-hidden">
                          {sortedSessions.length === 0 ? (
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
