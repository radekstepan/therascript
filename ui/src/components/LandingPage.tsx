// src/components/LandingPage.tsx
import React, { useEffect, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useNavigate } from 'react-router-dom';
import { CounterClockwiseClockIcon, PlusCircledIcon } from '@radix-ui/react-icons';
import { SessionListTable } from './LandingPage/SessionListTable';
import { Button, Card, Flex, Heading, Text, Box, Container, Spinner } from '@radix-ui/themes';
import { UserThemeDropdown } from './UserThemeDropdown';
import { fetchSessions } from '../api/api';
import { Session } from '../types'; // Added import
import {
  openUploadModalAtom,
  sessionSortCriteriaAtom,
  sessionSortDirectionAtom,
  setSessionSortAtom,
  SessionSortCriteria,
} from '../store';

export function LandingPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const openUploadModal = useSetAtom(openUploadModalAtom);
  const currentSortCriteria = useAtomValue(sessionSortCriteriaAtom);
  const currentSortDirection = useAtomValue(sessionSortDirectionAtom);
  const setSort = useSetAtom(setSessionSortAtom);
  const navigate = useNavigate();

  useEffect(() => {
    const loadSessions = async () => {
      try {
        setIsLoading(true);
        const data = await fetchSessions();
        setSessions(data);
      } catch (err) {
        setError('Failed to load sessions.');
      } finally {
        setIsLoading(false);
      }
    };
    loadSessions();
  }, []);

  const handleSort = (criteria: SessionSortCriteria) => {
    setSort(criteria);
  };

  if (isLoading) {
    return (
      <Flex justify="center" align="center" style={{ height: '100vh' }}>
        <Spinner size="3" />
        <Text ml="2">Loading sessions...</Text>
      </Flex>
    );
  }

  if (error) {
    return <Text color="red">{error}</Text>;
  }

  return (
    <Box className="w-full flex-grow flex flex-col">
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
      <Box className="flex-grow flex flex-col py-4 md:py-6 lg:py-8">
        <Container size="4" className="flex-grow flex flex-col">
          <Card size="3" className="flex-grow flex flex-col overflow-hidden h-full">
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
            <Box className="flex-grow flex flex-col overflow-hidden">
              {sessions.length === 0 ? (
                <Flex flexGrow="1" align="center" justify="center" p="6">
                  <Text color="gray">No sessions found. Upload one to get started!</Text>
                </Flex>
              ) : (
                <SessionListTable
                  sessions={sessions}
                  sortCriteria={currentSortCriteria}
                  sortDirection={currentSortDirection}
                  onSort={handleSort} // Fixed typo
                />
              )}
            </Box>
          </Card>
        </Container>
      </Box>
    </Box>
  );
}
