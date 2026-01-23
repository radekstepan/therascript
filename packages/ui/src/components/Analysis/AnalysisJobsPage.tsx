// packages/ui/src/components/Analysis/AnalysisJobsPage.tsx
import React, {
  useState,
  useMemo,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Box,
  Heading,
  Text,
  Spinner,
  Flex,
  Card,
  Table,
  Badge,
  Callout,
  Button,
  Progress,
  IconButton,
  DropdownMenu,
  AlertDialog,
  Grid,
  Tooltip,
} from '@radix-ui/themes';
import {
  ExclamationTriangleIcon,
  ArrowLeftIcon,
  CheckCircledIcon,
  LapTimerIcon,
  CrossCircledIcon,
  DotsHorizontalIcon,
  TrashIcon,
  StopIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  FileTextIcon,
  ChevronRightIcon,
  CalendarIcon,
  LightningBoltIcon,
} from '@radix-ui/react-icons';
import ReactMarkdown from 'react-markdown';
import {
  fetchAnalysisJobs,
  fetchAnalysisJob,
  cancelAnalysisJob,
  deleteAnalysisJob,
} from '../../api/api';
import type {
  AnalysisJob,
  AnalysisJobSortCriteria,
  IntermediateSummaryWithSessionName,
} from '../../types';
import { formatTimestamp, formatIsoDateToYMD } from '../../helpers';
import {
  toastMessageAtom,
  analysisJobSortCriteriaAtom,
  analysisJobSortDirectionAtom,
  setAnalysisJobSortAtom,
  SortDirection,
} from '../../store';
import { useSetAtom, useAtomValue } from 'jotai';
import { cn } from '../../utils';
import { useAnalysisStream } from '../../hooks/useAnalysisStream';

// Helper function to get badge color based on status
const getStatusBadgeColor = (
  status: AnalysisJob['status'] | IntermediateSummaryWithSessionName['status']
): React.ComponentProps<typeof Badge>['color'] => {
  switch (status) {
    case 'completed':
      return 'green';
    case 'failed':
      return 'red';
    case 'generating_strategy':
    case 'mapping':
    case 'reducing':
    case 'processing':
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

const StreamingBox: React.FC<{ text: string }> = ({ text }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [text]);

  return (
    <Box
      ref={scrollRef}
      p="2"
      mt="2"
      style={{
        backgroundColor: 'var(--gray-a3)',
        borderRadius: 'var(--radius-3)',
        maxHeight: '400px',
        overflowY: 'auto',
      }}
    >
      <div className="markdown-ai-message">
        <ReactMarkdown>{text}</ReactMarkdown>
      </div>
    </Box>
  );
};

const IntermediateSummaryItem: React.FC<{
  summary: IntermediateSummaryWithSessionName;
  liveLog?: string;
  metrics?: {
    promptTokens?: number;
    completionTokens?: number;
    duration?: number;
    tokensPerSecond?: number | undefined;
  };
}> = ({ summary, liveLog, metrics }) => {
  const [isOpen, setIsOpen] = useState(false);

  const isSuccess = summary.status === 'completed';
  const isFailed = summary.status === 'failed';
  const isProcessing = summary.status === 'processing';

  // Automatically open if processing and log is streaming
  useEffect(() => {
    if (isProcessing && liveLog) {
      setIsOpen(true);
    }
  }, [isProcessing, liveLog]);

  return (
    <Card size="2" style={{ width: '100%' }}>
      <Flex direction="column" gap="2" height="100%">
        <Flex justify="between" align="start">
          <Flex direction="column" gap="1" style={{ minWidth: 0 }}>
            <Flex align="center" gap="2">
              <FileTextIcon className="text-[--gray-a10] flex-shrink-0" />
              <Text weight="medium" truncate title={summary.sessionName}>
                {summary.sessionName}
              </Text>
            </Flex>
            <Flex align="center" gap="1" pl="1">
              <CalendarIcon className="text-[--gray-a9]" />
              <Text size="1" color="gray">
                {formatIsoDateToYMD(summary.sessionDate)}
              </Text>
            </Flex>
          </Flex>
          <Badge
            color={getStatusBadgeColor(summary.status)}
            variant="soft"
            style={{ flexShrink: 0 }}
          >
            {isProcessing && <Spinner size="1" />}
            <Text ml={isProcessing ? '1' : '0'}>{summary.status}</Text>
          </Badge>
        </Flex>

        <Box mt="auto">
          {(isSuccess || isFailed || (isProcessing && liveLog)) && (
            <Button
              variant="soft"
              size="1"
              color="gray"
              onClick={() => setIsOpen(!isOpen)}
              style={{ width: 'fit-content' }}
            >
              {isOpen ? 'Hide' : 'Show'}{' '}
              {isProcessing ? 'Live Log' : isSuccess ? 'Analysis' : 'Error'}
              <ChevronRightIcon
                className="transition-transform"
                style={{
                  transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                }}
              />
            </Button>
          )}
        </Box>

        {isOpen && isProcessing && liveLog && (
          <>
            <StreamingBox text={liveLog} />
            {metrics && (
              <Flex mt="1" width="100%" justify="start">
                <Text size="1" color="gray">
                  ~{(metrics.tokensPerSecond ?? 0).toFixed(1)} tokens/s
                </Text>
              </Flex>
            )}
          </>
        )}
        {isOpen && isSuccess && summary.summary_text && !isProcessing && (
          <>
            <Box
              p="2"
              mt="2"
              style={{
                backgroundColor: 'var(--gray-a3)',
                borderRadius: 'var(--radius-3)',
              }}
            >
              <div className="markdown-ai-message">
                <ReactMarkdown>{summary.summary_text}</ReactMarkdown>
              </div>
            </Box>
            {metrics && metrics.completionTokens && metrics.tokensPerSecond && (
              <Flex mt="1" width="100%" justify="start">
                <Text size="1" color="gray">
                  {Math.round(
                    (metrics.promptTokens || 0) + metrics.completionTokens
                  )}{' '}
                  tokens ({metrics.tokensPerSecond.toFixed(1)} tokens/s)
                </Text>
              </Flex>
            )}
          </>
        )}
        {isOpen && isFailed && summary.error_message && (
          <Callout.Root color="red" size="1" mt="2">
            <Callout.Icon>
              <ExclamationTriangleIcon />
            </Callout.Icon>
            <Callout.Text>{summary.error_message}</Callout.Text>
          </Callout.Root>
        )}
      </Flex>
    </Card>
  );
};

// Job Detail View Component
const JobDetailView: React.FC<{
  jobId: number;
  onCancelRequest: (job: AnalysisJob) => void;
  onDeleteRequest: (job: AnalysisJob) => void;
}> = ({ jobId, onCancelRequest, onDeleteRequest }) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Use the stream hook
  const { mapLogs, reduceLog, isConnected, mapMetrics, reduceMetrics } =
    useAnalysisStream(jobId);

  const {
    data: job,
    isLoading,
    error,
    isFetching,
  } = useQuery<AnalysisJob, Error>({
    queryKey: ['analysisJob', jobId],
    queryFn: () => fetchAnalysisJob(jobId),
    refetchInterval: (query) => {
      const data = query.state.data;
      const isTerminal =
        data?.status === 'completed' ||
        data?.status === 'failed' ||
        data?.status === 'canceled';

      if (isTerminal) {
        queryClient.invalidateQueries({ queryKey: ['analysisJobs'] });
        return false;
      }
      // If streaming is connected, we can poll less frequently
      return isConnected ? 8000 : 3000;
    },
  });

  if (isLoading) {
    return (
      <Flex justify="center" align="center" p="6">
        <Spinner size="3" />
        <Text ml="2">Loading Job Details...</Text>
      </Flex>
    );
  }

  if (error) {
    return (
      <Callout.Root color="red" role="alert">
        <Callout.Icon>
          <ExclamationTriangleIcon />
        </Callout.Icon>
        <Callout.Text>Error loading job: {error.message}</Callout.Text>
      </Callout.Root>
    );
  }

  if (!job) {
    return <Text>Job not found.</Text>;
  }

  const isProcessing =
    job.status === 'pending' ||
    job.status === 'generating_strategy' ||
    job.status === 'mapping' ||
    job.status === 'reducing';
  const isCancellable = isProcessing;

  const isTerminal = ['completed', 'failed', 'canceled'].includes(job.status);
  const isStuckCanceling =
    job.status === 'canceling' && Date.now() - job.created_at > 300000; // 5 minutes
  const isDeletable = isTerminal || isStuckCanceling;

  const mapProgress = job.summaries
    ? (job.summaries.filter(
        (s) => s.status === 'completed' || s.status === 'failed'
      ).length /
        job.summaries.length) *
      50
    : 0;
  const overallProgress =
    job.status === 'generating_strategy'
      ? 2
      : job.status === 'pending'
        ? 5
        : job.status === 'mapping'
          ? 10 + mapProgress
          : job.status === 'reducing'
            ? 60
            : job.status === 'completed'
              ? 100
              : job.status === 'failed' || job.status === 'canceled'
                ? 100
                : 0;

  return (
    <Card>
      <Flex direction="column" gap="5">
        {/* === HEADER === */}
        <Flex justify="between" align="center">
          <Heading as="h2" size="6">
            Analysis #{job.id}
          </Heading>
          <Flex gap="3" align="center">
            {isConnected && (
              <Badge color="green" variant="soft">
                <LightningBoltIcon /> Live
              </Badge>
            )}
            {isCancellable && (
              <Button
                variant="soft"
                color="orange"
                onClick={() => onCancelRequest(job)}
              >
                <StopIcon /> Cancel Job
              </Button>
            )}
            {isDeletable && (
              <Button
                variant="soft"
                color="red"
                onClick={() => onDeleteRequest(job)}
              >
                <TrashIcon /> {isStuckCanceling ? 'Force Delete' : 'Delete Job'}
              </Button>
            )}
            <Button variant="soft" onClick={() => navigate('/analysis-jobs')}>
              <ArrowLeftIcon /> Back to All Jobs
            </Button>
          </Flex>
        </Flex>

        {/* === METADATA & PROGRESS === */}
        <Flex direction="column" gap="4">
          <Flex gap="6" wrap="wrap">
            <Box>
              <Text as="div" size="2" color="gray" mb="1">
                Status
              </Text>
              <Badge
                color={getStatusBadgeColor(job.status)}
                size="2"
                variant="soft"
              >
                {isFetching && !isDeletable && !isConnected ? (
                  <Spinner size="1" />
                ) : null}
                <Text
                  ml={isFetching && !isDeletable && !isConnected ? '1' : '0'}
                >
                  {job.status}
                </Text>
              </Badge>
            </Box>
            <Box>
              <Text as="div" size="2" color="gray" mb="1">
                Model
              </Text>
              <Text>{job.model_name || 'Default'}</Text>
            </Box>
            <Box>
              <Text as="div" size="2" color="gray" mb="1">
                Created
              </Text>
              <Text>{formatTimestamp(job.created_at)}</Text>
            </Box>
          </Flex>

          {isProcessing && (
            <Box>
              <Text as="div" size="2" color="gray" mb="1">
                Progress
              </Text>
              <Progress value={overallProgress} size="2" />
            </Box>
          )}
        </Flex>

        {/* === ORIGINAL PROMPT === */}
        <Box>
          <Heading as="h3" size="4" mb="2">
            Original Prompt
          </Heading>
          <Box
            p="3"
            style={{
              backgroundColor: 'var(--accent-a3)',
              borderRadius: 'var(--radius-3)',
            }}
          >
            <Text
              as="p"
              size="2"
              style={{
                fontStyle: 'italic',
                whiteSpace: 'pre-wrap',
                color: 'var(--accent-a11)',
              }}
            >
              {job.original_prompt}
            </Text>
          </Box>
        </Box>

        {/* === INTERMEDIATE TASK === */}
        {job.strategy && (
          <Box>
            <Heading as="h3" size="4" mb="2">
              Intermediate Task
            </Heading>
            <Box
              p="3"
              style={{
                backgroundColor: 'var(--gray-a3)',
                borderRadius: 'var(--radius-3)',
              }}
            >
              <Text as="p" size="2" style={{ whiteSpace: 'pre-wrap' }}>
                {job.strategy.intermediate_question}
              </Text>
            </Box>
          </Box>
        )}

        {/* === INTERMEDIATE ANALYSIS === */}
        {job.summaries && job.summaries.length > 0 && (
          <Box>
            <Heading as="h3" size="4" mb="3">
              Intermediate Analysis
            </Heading>
            <Grid columns="1" gap="3">
              {job.summaries
                .sort((a, b) => a.sessionName.localeCompare(b.sessionName))
                .map((summary) => (
                  <IntermediateSummaryItem
                    key={summary.id}
                    summary={summary}
                    liveLog={mapLogs[summary.id]} // Pass live log
                    metrics={mapMetrics[summary.id]}
                  />
                ))}
            </Grid>
          </Box>
        )}

        {/* === FINAL ANSWER TERMINAL (When Reducing) === */}
        {job.status === 'reducing' && reduceLog && (
          <Box>
            <Heading as="h3" size="4" mb="2" color="blue">
              Synthesizing Final Answer...
            </Heading>
            <StreamingBox text={reduceLog} />
            {reduceMetrics && reduceMetrics.tokensPerSecond && (
              <Flex mt="1" width="100%" justify="start">
                <Text size="1" color="gray">
                  ~{reduceMetrics.tokensPerSecond.toFixed(1)} tokens/s
                </Text>
              </Flex>
            )}
          </Box>
        )}

        {/* === FINAL ANSWER COMPLETED === */}
        {job.status === 'completed' && (
          <Box>
            <Heading as="h3" size="4" mb="2" color="green">
              Final Synthesized Answer
            </Heading>
            <Box
              p="4"
              style={{
                backgroundColor: 'var(--gray-a3)',
                borderRadius: 'var(--radius-3)',
              }}
            >
              <div className="markdown-ai-message">
                <ReactMarkdown>
                  {job.final_result || 'No result was generated.'}
                </ReactMarkdown>
              </div>
            </Box>
            {reduceMetrics &&
              reduceMetrics.completionTokens &&
              reduceMetrics.tokensPerSecond && (
                <Flex mt="1" width="100%" justify="start">
                  <Text size="1" color="gray">
                    {Math.round(
                      (reduceMetrics.promptTokens || 0) +
                        reduceMetrics.completionTokens
                    )}{' '}
                    tokens ({reduceMetrics.tokensPerSecond.toFixed(1)} tokens/s)
                  </Text>
                </Flex>
              )}
          </Box>
        )}

        {/* === ERROR DETAILS === */}
        {job.status === 'failed' && (
          <Box>
            <Heading as="h3" size="4" mb="2" color="red">
              Error Details
            </Heading>
            <Callout.Root color="red" role="alert">
              <Callout.Icon>
                <ExclamationTriangleIcon />
              </Callout.Icon>
              <Callout.Text>
                {job.error_message || 'An unknown error occurred.'}
              </Callout.Text>
            </Callout.Root>
          </Box>
        )}
      </Flex>
    </Card>
  );
};

// Job List View Component
const JobList: React.FC<{
  jobs: AnalysisJob[];
  sortCriteria: AnalysisJobSortCriteria;
  sortDirection: SortDirection;
  onSort: (criteria: AnalysisJobSortCriteria) => void;
  onCancelRequest: (job: AnalysisJob) => void;
  onDeleteRequest: (job: AnalysisJob) => void;
}> = ({
  jobs,
  sortCriteria,
  sortDirection,
  onSort,
  onCancelRequest,
  onDeleteRequest,
}) => {
  const navigate = useNavigate();

  type AriaSort = 'none' | 'ascending' | 'descending';

  const renderSortIcon = useCallback(
    (criteria: AnalysisJobSortCriteria) => {
      if (sortCriteria !== criteria) {
        return (
          <ChevronDownIcon className="h-3 w-3 ml-1 text-[--gray-a9] opacity-0 group-hover:opacity-100 transition-opacity" />
        );
      }
      return sortDirection === 'asc' ? (
        <ChevronUpIcon className="h-4 w-4 ml-1 text-[--gray-a11]" />
      ) : (
        <ChevronDownIcon className="h-4 w-4 ml-1 text-[--gray-a11]" />
      );
    },
    [sortCriteria, sortDirection]
  );

  const getHeaderCellProps = useCallback(
    (
      criteria: AnalysisJobSortCriteria
    ): React.ThHTMLAttributes<HTMLTableHeaderCellElement> => {
      const isActive = sortCriteria === criteria;
      const ariaSortValue: AriaSort = isActive
        ? sortDirection === 'asc'
          ? 'ascending'
          : 'descending'
        : 'none';
      return {
        onClick: () => onSort(criteria),
        'aria-sort': ariaSortValue,
        style: { cursor: 'pointer', whiteSpace: 'nowrap' },
        className: 'group',
      };
    },
    [sortCriteria, sortDirection, onSort]
  );

  return (
    <Card>
      <Table.Root variant="surface">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeaderCell {...getHeaderCellProps('created_at')}>
              <Flex align="center">Created {renderSortIcon('created_at')}</Flex>
            </Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell {...getHeaderCellProps('status')}>
              <Flex align="center">Status {renderSortIcon('status')}</Flex>
            </Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell {...getHeaderCellProps('short_prompt')}>
              <Flex align="center">
                Prompt {renderSortIcon('short_prompt')}
              </Flex>
            </Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell {...getHeaderCellProps('model_name')}>
              <Flex align="center">Model {renderSortIcon('model_name')}</Flex>
            </Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell {...getHeaderCellProps('completed_at')}>
              <Flex align="center">
                Completed {renderSortIcon('completed_at')}
              </Flex>
            </Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell align="right">
              Actions
            </Table.ColumnHeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {jobs.map((job) => {
            const isCancellable =
              job.status === 'pending' ||
              job.status === 'generating_strategy' ||
              job.status === 'mapping' ||
              job.status === 'reducing';
            const isTerminal = ['completed', 'failed', 'canceled'].includes(
              job.status
            );
            const isStuckCanceling =
              job.status === 'canceling' &&
              Date.now() - job.created_at > 300000; // 5 minutes
            const isDeletable = isTerminal || isStuckCanceling;
            const isSummarizing = job.short_prompt.includes('(summarizing)');

            return (
              <Table.Row
                key={job.id}
                onClick={() => navigate(`/analysis-jobs/${job.id}`)}
                className={cn(
                  'cursor-pointer hover:bg-[--gray-a3] transition-colors',
                  job.status === 'canceling' &&
                    'bg-[--orange-a2] hover:bg-[--orange-a4]'
                )}
              >
                <Table.Cell>{formatTimestamp(job.created_at)}</Table.Cell>
                <Table.Cell>
                  <Tooltip
                    content={
                      job.status === 'canceling'
                        ? 'Waiting for current step to finish before stopping.'
                        : null
                    }
                  >
                    <Badge
                      color={getStatusBadgeColor(job.status)}
                      variant="soft"
                    >
                      {job.status === 'pending' ||
                      job.status === 'generating_strategy' ||
                      job.status === 'mapping' ||
                      job.status === 'reducing' ||
                      job.status === 'canceling' ? (
                        <LapTimerIcon width="12" height="12" />
                      ) : job.status === 'completed' ? (
                        <CheckCircledIcon width="12" height="12" />
                      ) : (
                        <CrossCircledIcon width="12" height="12" />
                      )}
                      <Text ml="1">{job.status}</Text>
                    </Badge>
                  </Tooltip>
                </Table.Cell>
                <Table.Cell>
                  <Flex align="center" gap="2">
                    {isSummarizing && <Spinner size="1" />}
                    <Text truncate title={job.original_prompt}>
                      {job.short_prompt}
                    </Text>
                  </Flex>
                </Table.Cell>
                <Table.Cell>
                  <Text color="gray" size="2">
                    {job.model_name || 'Default'}
                  </Text>
                </Table.Cell>
                <Table.Cell>
                  {job.completed_at ? formatTimestamp(job.completed_at) : 'N/A'}
                </Table.Cell>
                <Table.Cell align="right" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger>
                      <IconButton
                        variant="ghost"
                        color="gray"
                        size="1"
                        aria-label="Job Actions"
                      >
                        <DotsHorizontalIcon />
                      </IconButton>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Content align="end" size="1">
                      <DropdownMenu.Item
                        onSelect={() => onCancelRequest(job)}
                        disabled={!isCancellable}
                        color="orange"
                      >
                        <StopIcon width="14" height="14" className="mr-2" />{' '}
                        Cancel Job
                      </DropdownMenu.Item>
                      <DropdownMenu.Separator />
                      <DropdownMenu.Item
                        onSelect={() => onDeleteRequest(job)}
                        disabled={!isDeletable}
                        color="red"
                      >
                        <TrashIcon width="14" height="14" className="mr-2" />{' '}
                        {isStuckCanceling ? 'Force Delete' : 'Delete Job'}
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Root>
                </Table.Cell>
              </Table.Row>
            );
          })}
        </Table.Body>
      </Table.Root>
    </Card>
  );
};

// Main Page Component
export function AnalysisJobsPage() {
  const { jobId: jobIdParam } = useParams<{ jobId?: string }>();
  const jobId = jobIdParam ? parseInt(jobIdParam, 10) : null;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setToast = useSetAtom(toastMessageAtom);

  // --- Sorting State ---
  const sortCriteria = useAtomValue(analysisJobSortCriteriaAtom);
  const sortDirection = useAtomValue(analysisJobSortDirectionAtom);
  const setSort = useSetAtom(setAnalysisJobSortAtom);

  const [jobToCancel, setJobToCancel] = useState<AnalysisJob | null>(null);
  const [jobToDelete, setJobToDelete] = useState<AnalysisJob | null>(null);

  const {
    data: jobs,
    isLoading,
    error,
  } = useQuery<AnalysisJob[], Error>({
    queryKey: ['analysisJobs'],
    queryFn: fetchAnalysisJobs,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (
        !data ||
        data.every(
          (job) =>
            job.status === 'completed' ||
            job.status === 'failed' ||
            job.status === 'canceled' ||
            !job.short_prompt.includes('(summarizing)') // also stop if all are summarized
        )
      ) {
        return false; // Stop polling
      }
      return 5000; // Poll every 5 seconds
    },
  });

  const sortedJobs = useMemo(() => {
    if (!jobs) return [];
    const getString = (val: string | null | undefined) => val || '';
    const getNumber = (val: number | null | undefined) => val || 0;
    return [...jobs].sort((a, b) => {
      let res = 0;
      switch (sortCriteria) {
        case 'short_prompt':
          res = getString(a.short_prompt).localeCompare(
            getString(b.short_prompt)
          );
          break;
        case 'status':
          res = getString(a.status).localeCompare(getString(b.status));
          break;
        case 'created_at':
          res = getNumber(b.created_at) - getNumber(a.created_at); // Newest first
          break;
        case 'completed_at':
          res = getNumber(b.completed_at) - getNumber(a.completed_at);
          break;
        case 'model_name':
          res = getString(a.model_name).localeCompare(getString(b.model_name));
          break;
        default:
          break;
      }
      // Handle direction
      const order =
        sortCriteria === 'created_at' || sortCriteria === 'completed_at'
          ? 'desc'
          : 'asc';
      return sortDirection === order ? res : -res;
    });
  }, [jobs, sortCriteria, sortDirection]);

  const cancelMutation = useMutation({
    mutationFn: (id: number) => cancelAnalysisJob(id),
    onSuccess: (data, id) => {
      setToast(data.message || `Cancellation requested for job ${id}.`);
      queryClient.invalidateQueries({ queryKey: ['analysisJobs'] });
      queryClient.invalidateQueries({ queryKey: ['analysisJob', id] });
    },
    onError: (error: Error, id) =>
      setToast(`Error canceling job ${id}: ${error.message}`),
    onSettled: () => setJobToCancel(null),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteAnalysisJob(id),
    onSuccess: (data, id) => {
      setToast(data.message || `Job ${id} deleted.`);
      queryClient.invalidateQueries({ queryKey: ['analysisJobs'] });
      if (jobId === id) {
        navigate('/analysis-jobs', { replace: true });
      }
    },
    onError: (error: Error, id) =>
      setToast(`Error deleting job ${id}: ${error.message}`),
    onSettled: () => setJobToDelete(null),
  });

  const handleCancelRequest = (job: AnalysisJob) => setJobToCancel(job);
  const handleDeleteRequest = (job: AnalysisJob) => setJobToDelete(job);

  const handleConfirmCancel = () => {
    if (jobToCancel) cancelMutation.mutate(jobToCancel.id);
  };
  const handleConfirmDelete = () => {
    if (jobToDelete) deleteMutation.mutate(jobToDelete.id);
  };

  return (
    <>
      <Box px={{ initial: '4', md: '6' }} py="6">
        {!jobId && (
          <Heading as="h1" size="7" mb="6">
            Analysis
          </Heading>
        )}
        {jobId ? (
          <JobDetailView
            jobId={jobId}
            onCancelRequest={handleCancelRequest}
            onDeleteRequest={handleDeleteRequest}
          />
        ) : isLoading ? (
          <Flex justify="center" align="center" p="6">
            <Spinner size="3" />
            <Text ml="2">Loading Jobs...</Text>
          </Flex>
        ) : error ? (
          <Callout.Root color="red" role="alert">
            <Callout.Icon>
              <ExclamationTriangleIcon />
            </Callout.Icon>
            <Callout.Text>Error loading jobs: {error.message}</Callout.Text>
          </Callout.Root>
        ) : !sortedJobs || sortedJobs.length === 0 ? (
          <Card>
            <Flex justify="center" align="center" p="6">
              <Text color="gray">No analysis jobs have been created yet.</Text>
            </Flex>
          </Card>
        ) : (
          <JobList
            jobs={sortedJobs}
            sortCriteria={sortCriteria}
            sortDirection={sortDirection}
            onSort={setSort}
            onCancelRequest={handleCancelRequest}
            onDeleteRequest={handleDeleteRequest}
          />
        )}
      </Box>

      {/* Confirmation Modals */}
      <AlertDialog.Root
        open={!!jobToCancel}
        onOpenChange={(open) => !open && setJobToCancel(null)}
      >
        <AlertDialog.Content style={{ maxWidth: 450 }}>
          <AlertDialog.Title>Cancel Analysis</AlertDialog.Title>
          <AlertDialog.Description>
            Are you sure you want to cancel #{jobToCancel?.id}? This will stop
            any ongoing processing.
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button
                variant="soft"
                color="gray"
                disabled={cancelMutation.isPending}
              >
                Back
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button
                color="orange"
                onClick={handleConfirmCancel}
                disabled={cancelMutation.isPending}
              >
                {cancelMutation.isPending ? <Spinner /> : <StopIcon />}
                <Text ml="1">Confirm Cancel</Text>
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>

      <AlertDialog.Root
        open={!!jobToDelete}
        onOpenChange={(open) => !open && setJobToDelete(null)}
      >
        <AlertDialog.Content style={{ maxWidth: 450 }}>
          <AlertDialog.Title>Delete Analysis</AlertDialog.Title>
          <AlertDialog.Description>
            Are you sure you want to permanently delete job #{jobToDelete?.id}{' '}
            and its results? This action cannot be undone.
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button
                variant="soft"
                color="gray"
                disabled={deleteMutation.isPending}
              >
                Back
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button
                color="red"
                onClick={handleConfirmDelete}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? <Spinner /> : <TrashIcon />}
                <Text ml="1">Confirm Delete</Text>
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </>
  );
}
