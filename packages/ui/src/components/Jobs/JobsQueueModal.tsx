// packages/ui/src/components/Jobs/JobsQueueModal.tsx

import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAtomValue, useSetAtom } from 'jotai';
import {
  Dialog,
  Button,
  Flex,
  Text,
  Box,
  Spinner,
  Callout,
  Badge,
  ScrollArea,
  Heading,
  Card,
} from '@radix-ui/themes';
import {
  Cross2Icon,
  InfoCircledIcon,
  LapTimerIcon,
  BarChartIcon,
  FileTextIcon,
  ChevronRightIcon,
  ChatBubbleIcon,
  MagnifyingGlassIcon,
} from '@radix-ui/react-icons';
import { fetchAnalysisJobs } from '../../api/analysis';
import { fetchSessions } from '../../api/session';
import {
  cancelVerificationJob,
  fetchVerificationJobs,
  type VerificationJob,
} from '../../api/verification';
import { activeLlmJobsAtom, toastMessageAtom } from '../../store';
import type {
  AllJobsStatus,
  AnalysisJob,
  Session,
  VerificationJobSummary,
} from '../../types';
import { formatTimestamp } from '../../helpers';
import { AppTooltip } from '../Shared/AppTooltip';

interface JobsQueueModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

const getStatusBadgeColor = (
  status: AnalysisJob['status'] | Session['status'] | VerificationJob['status']
): React.ComponentProps<typeof Badge>['color'] => {
  switch (status) {
    case 'completed':
      return 'green';
    case 'failed':
      return 'red';
    case 'mapping':
    case 'reducing':
    case 'processing':
    case 'transcribing':
    case 'queued':
      return 'blue';
    case 'canceling':
      return 'orange';
    case 'canceled':
      return 'gray';
    case 'pending':
    default:
      return 'gray';
  }
};

export function JobsQueueModal({ isOpen, onOpenChange }: JobsQueueModalProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setToast = useSetAtom(toastMessageAtom);
  const activeLlmJobs = useAtomValue(activeLlmJobsAtom);

  const cancelVerificationMutation = useMutation({
    mutationFn: cancelVerificationJob,
    onSuccess: () => {
      setToast('Cancellation requested — the audit will stop shortly.');
      queryClient.invalidateQueries({ queryKey: ['verificationJobs'] });
      queryClient.invalidateQueries({ queryKey: ['verificationStats'] });
      queryClient.invalidateQueries({ queryKey: ['activeJobCount'] });
    },
    onError: (error: Error) => {
      setToast(`Failed to cancel job: ${error.message}`);
    },
  });

  const {
    data: analysisJobs,
    isLoading: isLoadingAnalysis,
    error: analysisError,
  } = useQuery<AnalysisJob[], Error>({
    queryKey: ['analysisJobs'],
    queryFn: fetchAnalysisJobs,
    enabled: isOpen,
    refetchInterval: isOpen ? 5000 : false,
  });

  const {
    data: sessions,
    isLoading: isLoadingSessions,
    error: sessionsError,
  } = useQuery<Session[], Error>({
    queryKey: ['sessions'],
    queryFn: fetchSessions,
    enabled: isOpen,
    refetchInterval: isOpen ? 5000 : false,
  });

  const {
    data: verificationJobs,
    isLoading: isLoadingVerification,
    error: verificationError,
  } = useQuery<VerificationJob[], Error>({
    queryKey: ['verificationJobs'],
    queryFn: fetchVerificationJobs,
    enabled: isOpen,
    refetchInterval: isOpen ? 5000 : false,
  });

  const activeAnalysisJobs =
    analysisJobs?.filter(
      (job) => !['completed', 'failed', 'canceled'].includes(job.status)
    ) || [];

  const activeTranscriptionJobs =
    sessions?.filter((session) =>
      ['queued', 'transcribing'].includes(session.status)
    ) || [];

  // Aggregate view shared with the sidebar badge contract: the modal's
  // verification section renders from AllJobsStatus.verification.
  const jobsStatus: AllJobsStatus = { verification: verificationJobs };
  // Same active filter as the badge count (GET /api/jobs/active-count
  // includes verification) and VerificationAuditPage.isActiveJob.
  const activeVerificationJobs: VerificationJobSummary[] = (
    jobsStatus.verification ?? []
  ).filter((job) => job.status === 'pending' || job.status === 'processing');

  const handleNavigate = (path: string) => {
    navigate(path);
    onOpenChange(false);
  };

  const isLoading =
    isLoadingAnalysis || isLoadingSessions || isLoadingVerification;
  const error = analysisError || sessionsError || verificationError;
  const hasActiveJobs =
    activeLlmJobs.length > 0 ||
    activeAnalysisJobs.length > 0 ||
    activeTranscriptionJobs.length > 0 ||
    activeVerificationJobs.length > 0;

  return (
    <Dialog.Root open={isOpen} onOpenChange={onOpenChange}>
      <Dialog.Content style={{ maxWidth: 650 }}>
        <Dialog.Title>
          <Flex align="center" gap="2">
            <LapTimerIcon />
            Active Jobs Queue
          </Flex>
        </Dialog.Title>
        <Dialog.Description size="2" mb="4" color="gray">
          Overview of ongoing analysis, transcription, and fact-check tasks.
        </Dialog.Description>

        <ScrollArea
          type="auto"
          scrollbars="vertical"
          style={{ maxHeight: '60vh', minHeight: '200px' }}
        >
          <Box pr="4">
            {isLoading && (
              <Flex align="center" justify="center" py="6">
                <Spinner size="3" />
                <Text ml="2" color="gray">
                  Loading jobs...
                </Text>
              </Flex>
            )}
            {error && !isLoading && (
              <Callout.Root color="red" role="alert" size="1" mt="2">
                <Callout.Icon>
                  <InfoCircledIcon />
                </Callout.Icon>
                <Callout.Text>
                  Error fetching jobs: {error.message}
                </Callout.Text>
              </Callout.Root>
            )}
            {!isLoading && !error && !hasActiveJobs && (
              <Flex align="center" justify="center" py="6">
                <Text color="gray">No active jobs in the queue.</Text>
              </Flex>
            )}

            {!isLoading && !error && hasActiveJobs && (
              <Flex direction="column" gap="4">
                {/* LLM Responses */}
                {activeLlmJobs.length > 0 && (
                  <Box>
                    <Heading as="h3" size="3" mb="2">
                      <Flex align="center" gap="2">
                        <ChatBubbleIcon />
                        LLM Responses ({activeLlmJobs.length})
                      </Flex>
                    </Heading>
                    <Flex direction="column" gap="2">
                      {activeLlmJobs.map((job) => (
                        <Card
                          key={`llm-${job.id}`}
                          size="1"
                          className="cursor-pointer hover:bg-[--gray-a3]"
                          onClick={() =>
                            handleNavigate(
                              job.isStandalone
                                ? `/chats/${job.chatId}`
                                : `/sessions/${job.sessionId}`
                            )
                          }
                        >
                          <Flex justify="between" align="center">
                            <Flex
                              direction="column"
                              gap="1"
                              style={{ minWidth: 0 }}
                            >
                              <AppTooltip content={job.promptPreview}>
                                <Text size="2" weight="medium" truncate>
                                  {job.promptPreview}
                                </Text>
                              </AppTooltip>
                              <Text size="1" color="gray">
                                Started: {formatTimestamp(job.startedAt)}
                              </Text>
                            </Flex>
                            <Flex align="center" gap="2" flexShrink="0">
                              <Badge
                                color={
                                  job.status === 'canceling' ? 'orange' : 'blue'
                                }
                                variant="soft"
                              >
                                {job.status}
                              </Badge>
                              <ChevronRightIcon className="text-[--gray-a9]" />
                            </Flex>
                          </Flex>
                        </Card>
                      ))}
                    </Flex>
                  </Box>
                )}

                {/* Analysis Jobs */}
                {activeAnalysisJobs.length > 0 && (
                  <Box>
                    <Heading as="h3" size="3" mb="2">
                      <Flex align="center" gap="2">
                        <BarChartIcon />
                        Analysis Jobs ({activeAnalysisJobs.length})
                      </Flex>
                    </Heading>
                    <Flex direction="column" gap="2">
                      {activeAnalysisJobs.map((job) => (
                        <Card
                          key={`analysis-${job.id}`}
                          size="1"
                          className="cursor-pointer hover:bg-[--gray-a3]"
                          onClick={() =>
                            handleNavigate(`/analysis-jobs/${job.id}`)
                          }
                        >
                          <Flex justify="between" align="center">
                            <Flex
                              direction="column"
                              gap="1"
                              style={{ minWidth: 0 }}
                            >
                              <AppTooltip content={job.original_prompt}>
                                <Text size="2" weight="medium" truncate>
                                  #{job.id}: {job.short_prompt}
                                </Text>
                              </AppTooltip>
                              <Text size="1" color="gray">
                                Created: {formatTimestamp(job.created_at)}
                              </Text>
                            </Flex>
                            <Flex align="center" gap="2" flexShrink="0">
                              <Badge
                                color={getStatusBadgeColor(job.status)}
                                variant="soft"
                              >
                                {job.status}
                              </Badge>
                              <ChevronRightIcon className="text-[--gray-a9]" />
                            </Flex>
                          </Flex>
                        </Card>
                      ))}
                    </Flex>
                  </Box>
                )}

                {/* Verification Jobs */}
                {activeVerificationJobs.length > 0 && (
                  <Box>
                    <Heading as="h3" size="3" mb="2">
                      <Flex align="center" gap="2">
                        <MagnifyingGlassIcon />
                        Verification Jobs ({activeVerificationJobs.length})
                      </Flex>
                    </Heading>
                    <Flex direction="column" gap="2">
                      {activeVerificationJobs.map((job) => (
                        <Card
                          key={`verification-${job.id}`}
                          size="1"
                          className="cursor-pointer hover:bg-[--gray-a3]"
                          onClick={() => handleNavigate('/verification')}
                        >
                          <Flex justify="between" align="center">
                            <Flex
                              direction="column"
                              gap="1"
                              style={{ minWidth: 0 }}
                            >
                              <AppTooltip
                                content={`Fact-check audit #${job.id}`}
                              >
                                <Text size="2" weight="medium" truncate>
                                  Audit #{job.id}:{' '}
                                  {job.scope.replace(/_/g, ' ')}
                                </Text>
                              </AppTooltip>
                              <Text size="1" color="gray">
                                Processed: {job.processed_messages} /{' '}
                                {job.total_messages} messages ·{' '}
                                {job.flagged_statements} flagged
                              </Text>
                            </Flex>
                            <Flex align="center" gap="2" flexShrink="0">
                              <Badge
                                color={getStatusBadgeColor(job.status)}
                                variant="soft"
                              >
                                {job.status}
                              </Badge>
                              <Button
                                size="1"
                                variant="soft"
                                color="red"
                                disabled={cancelVerificationMutation.isPending}
                                onClick={(e) => {
                                  // Don't follow the card link to /verification
                                  // when the user only meant to cancel.
                                  e.stopPropagation();
                                  cancelVerificationMutation.mutate(job.id);
                                }}
                              >
                                <Cross2Icon /> Cancel
                              </Button>
                              <ChevronRightIcon className="text-[--gray-a9]" />
                            </Flex>
                          </Flex>
                        </Card>
                      ))}
                    </Flex>
                  </Box>
                )}

                {/* Transcription Jobs */}
                {activeTranscriptionJobs.length > 0 && (
                  <Box>
                    <Heading as="h3" size="3" mb="2">
                      <Flex align="center" gap="2">
                        <FileTextIcon />
                        Transcription Jobs ({activeTranscriptionJobs.length})
                      </Flex>
                    </Heading>
                    <Flex direction="column" gap="2">
                      {activeTranscriptionJobs.map((session) => (
                        <Card
                          key={`transcription-${session.id}`}
                          size="1"
                          className="cursor-pointer hover:bg-[--gray-a3]"
                          onClick={() =>
                            handleNavigate(`/sessions/${session.id}`)
                          }
                        >
                          <Flex justify="between" align="center">
                            <Flex
                              direction="column"
                              gap="1"
                              style={{ minWidth: 0 }}
                            >
                              <AppTooltip content={session.fileName}>
                                <Text size="2" weight="medium" truncate>
                                  {session.sessionName || session.fileName}
                                </Text>
                              </AppTooltip>
                              <Text size="1" color="gray">
                                Client: {session.clientName}
                              </Text>
                            </Flex>
                            <Flex align="center" gap="2" flexShrink="0">
                              <Badge
                                color={getStatusBadgeColor(session.status)}
                                variant="soft"
                              >
                                {session.status}
                              </Badge>
                              <ChevronRightIcon className="text-[--gray-a9]" />
                            </Flex>
                          </Flex>
                        </Card>
                      ))}
                    </Flex>
                  </Box>
                )}
              </Flex>
            )}
          </Box>
        </ScrollArea>
        <Flex gap="3" mt="4" justify="end">
          <Button
            type="button"
            variant="surface"
            onClick={() => onOpenChange(false)}
          >
            <Cross2Icon /> Close
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
