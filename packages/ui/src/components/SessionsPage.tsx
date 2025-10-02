// packages/ui/src/components/SessionsPage.tsx
import React, { useMemo, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Box,
  Heading,
  Flex,
  Text,
  Spinner,
  Card,
  AlertDialog,
  Button,
} from '@radix-ui/themes';
import { TrashIcon, BarChartIcon } from '@radix-ui/react-icons'; // <-- ADD BarChartIcon
import { SessionListTable } from './LandingPage/SessionListTable';
import { EditDetailsModal } from './SessionView/Modals/EditDetailsModal';
import { CreateAnalysisJobModal } from './Analysis/CreateAnalysisJobModal'; // <-- IMPORT a new modal
import { fetchSessions, deleteSession as deleteSessionApi } from '../api/api';
import {
  sessionSortCriteriaAtom,
  sessionSortDirectionAtom,
  setSessionSortAtom,
  SessionSortCriteria,
  toastMessageAtom,
} from '../store';
import type { Session, SessionMetadata } from '../types';
import { cn } from '../utils';

export function SessionsPage() {
  const setToast = useSetAtom(toastMessageAtom);
  const queryClient = useQueryClient();

  const currentSortCriteria = useAtomValue(sessionSortCriteriaAtom);
  const currentSortDirection = useAtomValue(sessionSortDirectionAtom);
  const setSort = useSetAtom(setSessionSortAtom);

  const [isEditingModalOpen, setIsEditingModalOpen] = useState(false);
  const [sessionToEdit, setSessionToEdit] = useState<Session | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<Session | null>(null);

  // --- NEW STATE for session selection and analysis modal ---
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<number>>(
    new Set()
  );
  const [isAnalysisModalOpen, setIsAnalysisModalOpen] = useState(false);
  // --- END NEW STATE ---

  const {
    data: sessions,
    isLoading,
    error,
    refetch,
  } = useQuery<Session[], Error>({
    queryKey: ['sessions'],
    queryFn: fetchSessions,
  });

  const deleteSessionMutation = useMutation<{ message: string }, Error, number>(
    {
      mutationFn: deleteSessionApi,
      onSuccess: (data, deletedId) => {
        setToast(data.message || `Session ${deletedId} deleted`);
        queryClient.invalidateQueries({ queryKey: ['sessions'] });
        // Deselect if it was selected
        setSelectedSessionIds((prev) => {
          const newSet = new Set(prev);
          newSet.delete(deletedId);
          return newSet;
        });
      },
      onError: (e, deletedId) => {
        setToast(`Error deleting session ${deletedId}: ${e.message}`);
      },
      onSettled: () => {
        setIsDeleteConfirmOpen(false);
        setSessionToDelete(null);
      },
    }
  );

  const sortedSessions = useMemo(() => {
    if (!sessions) return [];
    const criteria = currentSortCriteria;
    const direction = currentSortDirection;
    const getString = (value: string | null | undefined): string => value ?? '';
    return [...sessions].sort((a, b) => {
      let compareResult = 0;
      try {
        switch (criteria) {
          case 'sessionName':
            const nameA = getString(a.sessionName) || getString(a.fileName);
            const nameB = getString(b.sessionName) || getString(b.fileName);
            compareResult = nameA.localeCompare(nameB, undefined, {
              sensitivity: 'base',
              usage: 'sort',
            });
            break;
          case 'clientName':
            compareResult = getString(a.clientName).localeCompare(
              getString(b.clientName),
              undefined,
              { sensitivity: 'base', usage: 'sort' }
            );
            break;
          case 'sessionType':
            compareResult = getString(a.sessionType).localeCompare(
              getString(b.sessionType),
              undefined,
              { sensitivity: 'base', usage: 'sort' }
            );
            break;
          case 'therapy':
            compareResult = getString(a.therapy).localeCompare(
              getString(b.therapy),
              undefined,
              { sensitivity: 'base', usage: 'sort' }
            );
            break;
          case 'date':
            compareResult = getString(b.date).localeCompare(getString(a.date));
            break;
          case 'id':
            compareResult = (a.id ?? 0) - (b.id ?? 0);
            break;
          default:
            return 0;
        }
      } catch (e) {
        return 0;
      }
      if (direction === 'desc' && criteria !== 'date') compareResult *= -1;
      else if (direction === 'asc' && criteria === 'date') compareResult *= -1;
      return compareResult;
    });
  }, [sessions, currentSortCriteria, currentSortDirection]);

  const handleEditSession = (session: Session) => {
    setSessionToEdit(session);
    setIsEditingModalOpen(true);
  };

  const handleEditSaveSuccess = (updatedMetadata: Partial<SessionMetadata>) => {
    setIsEditingModalOpen(false);
    setSessionToEdit(null);
    setToast('Session details updated successfully.');
  };

  const handleDeleteSessionRequest = (session: Session) => {
    setSessionToDelete(session);
    setIsDeleteConfirmOpen(true);
  };

  const handleConfirmDeleteSession = () => {
    if (!sessionToDelete || deleteSessionMutation.isPending) return;
    deleteSessionMutation.mutate(sessionToDelete.id);
  };

  if (isLoading) {
    return (
      <Box
        className={cn(
          'flex-grow flex flex-col',
          'px-4 md:px-6 lg:px-8',
          'py-6'
        )}
      >
        <Flex justify="center" align="center" style={{ minHeight: '200px' }}>
          <Spinner size="3" /> <Text ml="2">Loading sessions...</Text>
        </Flex>
      </Box>
    );
  }

  if (error) {
    return (
      <Box
        className={cn(
          'flex-grow flex flex-col',
          'px-4 md:px-6 lg:px-8',
          'py-6'
        )}
      >
        <Card style={{ width: '100%' }}>
          <Text color="red">Error loading sessions: {error.message}</Text>
          <Button onClick={() => refetch()} mt="2">
            Retry
          </Button>
        </Card>
      </Box>
    );
  }

  return (
    <>
      <Box
        className={cn(
          'flex-grow flex flex-col',
          'px-4 md:px-6 lg:px-8',
          'py-6'
        )}
      >
        <Flex justify="between" align="center" mb="6">
          <Heading
            as="h1"
            size="7"
            className="text-gray-900 dark:text-gray-100"
          >
            All Sessions
          </Heading>
          {/* --- NEW "Analyze" BUTTON --- */}
          <Button
            variant="solid"
            size="2"
            onClick={() => setIsAnalysisModalOpen(true)}
            disabled={selectedSessionIds.size === 0}
          >
            <BarChartIcon />
            Analyze Selected ({selectedSessionIds.size})
          </Button>
        </Flex>

        {sortedSessions && sortedSessions.length > 0 ? (
          <Card
            className="flex flex-col overflow-hidden flex-grow"
            style={{ width: '100%' }}
          >
            <Box
              className="flex-grow flex flex-col overflow-hidden"
              style={{ minHeight: '300px' }}
            >
              <SessionListTable
                sessions={sortedSessions}
                sortCriteria={currentSortCriteria}
                sortDirection={currentSortDirection}
                onSort={(criteria) => setSort(criteria)}
                onEditSession={handleEditSession}
                onDeleteSessionRequest={handleDeleteSessionRequest}
                selectedIds={selectedSessionIds}
                onSelectionChange={setSelectedSessionIds}
              />
            </Box>
          </Card>
        ) : (
          <Card style={{ width: '100%' }}>
            <Flex justify="center" align="center" p="6">
              <Text color="gray">
                No sessions found. Click "New Session" in the toolbar to upload
                one.
              </Text>
            </Flex>
          </Card>
        )}
      </Box>

      <EditDetailsModal
        isOpen={isEditingModalOpen}
        onOpenChange={(open) => {
          setIsEditingModalOpen(open);
          if (!open) setSessionToEdit(null);
        }}
        session={sessionToEdit}
        onSaveSuccess={handleEditSaveSuccess}
      />

      {/* --- RENDER THE NEW MODAL --- */}
      <CreateAnalysisJobModal
        isOpen={isAnalysisModalOpen}
        onOpenChange={setIsAnalysisModalOpen}
        sessionIds={Array.from(selectedSessionIds)}
      />

      <AlertDialog.Root
        open={isDeleteConfirmOpen}
        onOpenChange={setIsDeleteConfirmOpen}
      >
        <AlertDialog.Content style={{ maxWidth: 450 }}>
          <AlertDialog.Title>Delete Session</AlertDialog.Title>
          <AlertDialog.Description size="2">
            Are you sure you want to permanently delete the session "
            <Text weight="bold">
              {sessionToDelete?.sessionName ||
                sessionToDelete?.fileName ||
                'this session'}
            </Text>
            "? This action and all associated chats and transcript data will be
            removed and cannot be undone.
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button
                variant="soft"
                color="gray"
                disabled={deleteSessionMutation.isPending}
              >
                Cancel
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button
                color="red"
                onClick={handleConfirmDeleteSession}
                disabled={deleteSessionMutation.isPending}
              >
                {deleteSessionMutation.isPending ? (
                  <Spinner size="1" />
                ) : (
                  <TrashIcon />
                )}
                <Text ml="1">Delete Session</Text>
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </>
  );
}
