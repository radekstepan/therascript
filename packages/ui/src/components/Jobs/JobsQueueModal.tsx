// packages/ui/src/components/Jobs/JobsQueueModal.tsx

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
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
} from '@radix-ui/react-icons';
import { fetchAnalysisJobs } from '../../api/analysis';
import { fetchSessions } from '../../api/session';
import type { AnalysisJob, Session } from '../../types';
import { formatTimestamp } from '../../helpers';

interface JobsQueueModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

const getStatusBadgeColor = (
  status: AnalysisJob['status'] | Session['status']
): React.ComponentProps<typeof Badge>['color'] => {
  switch (status) {
    case 'completed':
      return 'green';
    case 'failed':
      return 'red';
    case 'mapping':
    case 'reducing':
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

  const activeAnalysisJobs =
    analysisJobs?.filter(
      (job) => !['completed', 'failed', 'canceled'].includes(job.status)
    ) || [];

  const activeTranscriptionJobs =
    sessions?.filter((session) =>
      ['queued', 'transcribing'].includes(session.status)
    ) || [];

  const handleNavigate = (path: string) => {
    navigate(path);
    onOpenChange(false);
  };

  const isLoading = isLoadingAnalysis || isLoadingSessions;
  const error = analysisError || sessionsError;
  const hasActiveJobs =
    activeAnalysisJobs.length > 0 || activeTranscriptionJobs.length > 0;

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
          Overview of ongoing analysis and transcription tasks.
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
                              <Text
                                size="2"
                                weight="medium"
                                truncate
                                title={job.original_prompt}
                              >
                                #{job.id}: {job.short_prompt}
                              </Text>
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
                              <Text
                                size="2"
                                weight="medium"
                                truncate
                                title={session.fileName}
                              >
                                {session.sessionName || session.fileName}
                              </Text>
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
