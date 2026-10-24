// packages/ui/src/components/Verification/JobHistoryTab.tsx
//
// History of verification runs: Judge model, scope, progress, duration,
// and per-job cancellation.
import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSetAtom } from 'jotai';
import {
  Flex,
  Text,
  Table,
  Badge,
  Button,
  Card,
  Skeleton,
  Callout,
  Progress,
} from '@radix-ui/themes';
import { ExclamationTriangleIcon, Cross2Icon } from '@radix-ui/react-icons';
import { History } from 'lucide-react';
import {
  cancelVerificationJob,
  fetchVerificationJobs,
  verificationJobOutcome,
  verificationJobOutcomeLabel,
  type VerificationJob,
} from '../../api/verification';
import { toastMessageAtom } from '../../store';
import { formatTimestamp } from '../../helpers';
import { formatModelDisplayName } from '../../utils/modelDisplay';
import { JobFailuresDialog } from './JobFailuresDialog';

function statusBadgeColor(
  job: VerificationJob
): 'blue' | 'green' | 'red' | 'gray' | 'amber' {
  const outcome = verificationJobOutcome(job);
  switch (outcome) {
    case 'active':
      return 'blue';
    case 'completed':
      return 'green';
    case 'completed_with_errors':
      return 'amber';
    case 'failed':
      return 'red';
    default:
      return 'gray';
  }
}

function scopeLabel(scope: VerificationJob['scope']): string {
  switch (scope) {
    case 'all_unverified':
      return 'All unverified';
    case 'all_force':
      return 'Full re-audit';
    case 'selected_sessions':
      return 'Selected sessions';
    case 'single_chat':
      return 'Single chat';
  }
}

function formatDuration(job: VerificationJob): string {
  if (!job.completed_at) return '—';
  const ms = job.completed_at - job.created_at;
  if (ms < 1000) return `${ms} ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

export function JobHistoryTab() {
  const queryClient = useQueryClient();
  const setToast = useSetAtom(toastMessageAtom);
  const [detailsJob, setDetailsJob] = useState<VerificationJob | null>(null);

  const query = useQuery({
    queryKey: ['verificationJobs'],
    queryFn: fetchVerificationJobs,
    refetchInterval: (q) => {
      const data = q.state.data;
      const hasActive = data?.some(
        (job) => job.status === 'pending' || job.status === 'processing'
      );
      return hasActive ? 3000 : false;
    },
  });

  const cancelMutation = useMutation({
    mutationFn: cancelVerificationJob,
    onSuccess: () => {
      setToast('Cancellation requested.');
      queryClient.invalidateQueries({ queryKey: ['verificationJobs'] });
      queryClient.invalidateQueries({ queryKey: ['verificationStats'] });
    },
    onError: (error: Error) => {
      setToast(`Failed to cancel job: ${error.message}`);
    },
  });

  if (query.isLoading) {
    return (
      <Flex direction="column" gap="2">
        <Skeleton style={{ height: '40px' }} />
        <Skeleton style={{ height: '40px' }} />
        <Skeleton style={{ height: '40px' }} />
      </Flex>
    );
  }

  if (query.isError) {
    return (
      <Callout.Root color="red" size="2">
        <Callout.Icon>
          <ExclamationTriangleIcon />
        </Callout.Icon>
        <Callout.Text>
          Failed to load job history: {(query.error as Error).message}{' '}
          <Button
            size="1"
            variant="soft"
            ml="2"
            onClick={() => query.refetch()}
          >
            Retry
          </Button>
        </Callout.Text>
      </Callout.Root>
    );
  }

  const jobs = query.data ?? [];
  if (jobs.length === 0) {
    return (
      <Card size="3">
        <Flex direction="column" align="center" gap="2" py="6">
          <History size={24} style={{ color: 'var(--gray-10)' }} />
          <Text size="2" weight="medium">
            No verification runs yet
          </Text>
          <Text size="2" color="gray">
            Launch your first audit to see its history here.
          </Text>
        </Flex>
      </Card>
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <Table.Root size="2" style={{ minWidth: '860px' }}>
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeaderCell>Job</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Status</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Scope</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Judge model</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Progress</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell justify="end">
              Flagged
            </Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell justify="end">
              Duration
            </Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell justify="end">
              Started
            </Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell justify="end">
              Action
            </Table.ColumnHeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {jobs.map((job) => {
            const isActive =
              job.status === 'pending' || job.status === 'processing';
            const outcome = verificationJobOutcome(job);
            const hasFailures =
              outcome === 'failed' || outcome === 'completed_with_errors';
            const succeeded = job.succeeded_messages ?? 0;
            const failedCount = job.failed_messages ?? 0;
            const pct =
              job.total_messages > 0
                ? Math.round(
                    (job.processed_messages / job.total_messages) * 100
                  )
                : job.status === 'completed'
                  ? 100
                  : 0;
            return (
              <Table.Row key={job.id}>
                <Table.RowHeaderCell>#{job.id}</Table.RowHeaderCell>
                <Table.Cell>
                  <Badge
                    color={statusBadgeColor(job)}
                    variant="soft"
                    size="1"
                    title={
                      job.error_message ??
                      (outcome === 'completed_with_errors'
                        ? `${succeeded} of ${job.total_messages} checked, ${failedCount} failed`
                        : job.status === 'failed'
                          ? 'The audit run failed'
                          : `Job ${job.status}`)
                    }
                  >
                    {verificationJobOutcomeLabel(job)}
                  </Badge>
                  {job.error_message && (
                    <Text
                      size="1"
                      color="red"
                      as="p"
                      mt="1"
                      title={job.error_message}
                      style={{
                        maxWidth: '260px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {job.error_message}
                    </Text>
                  )}
                </Table.Cell>
                <Table.Cell>
                  <Text size="2">{scopeLabel(job.scope)}</Text>
                  {!job.skip_verified && (
                    <Text size="1" color="gray" as="p">
                      incl. verified
                    </Text>
                  )}
                </Table.Cell>
                <Table.Cell>
                  <Text size="2" title={job.model_name ?? undefined}>
                    {job.model_name
                      ? formatModelDisplayName(job.model_name)
                      : '—'}
                  </Text>
                </Table.Cell>
                <Table.Cell>
                  <Flex align="center" gap="2" style={{ minWidth: '140px' }}>
                    <Progress value={pct} size="1" style={{ flex: 1 }} />
                    <Text size="1" color="gray">
                      {job.processed_messages}/{job.total_messages}
                    </Text>
                  </Flex>
                  {!isActive && (succeeded > 0 || failedCount > 0) && (
                    <Text
                      size="1"
                      color={failedCount > 0 ? 'red' : 'gray'}
                      as="p"
                      mt="1"
                    >
                      {succeeded} checked
                      {failedCount > 0 ? ` · ${failedCount} failed` : ''}
                    </Text>
                  )}
                </Table.Cell>
                <Table.Cell justify="end">
                  <Text
                    size="2"
                    style={
                      job.flagged_statements > 0
                        ? { color: 'var(--red-11)' }
                        : undefined
                    }
                    color={job.flagged_statements > 0 ? undefined : 'gray'}
                  >
                    {job.flagged_statements}
                  </Text>
                </Table.Cell>
                <Table.Cell justify="end">
                  <Text size="2" color="gray">
                    {formatDuration(job)}
                  </Text>
                </Table.Cell>
                <Table.Cell justify="end">
                  <Text size="1" color="gray">
                    {formatTimestamp(job.created_at)}
                  </Text>
                </Table.Cell>
                <Table.Cell justify="end">
                  {isActive ? (
                    <Button
                      size="1"
                      variant="soft"
                      color="red"
                      disabled={cancelMutation.isPending}
                      onClick={() => cancelMutation.mutate(job.id)}
                    >
                      <Cross2Icon /> Cancel
                    </Button>
                  ) : hasFailures ? (
                    <Button
                      size="1"
                      variant="soft"
                      title="View failure details"
                      onClick={() => setDetailsJob(job)}
                    >
                      View
                    </Button>
                  ) : (
                    <Text size="1" color="gray">
                      —
                    </Text>
                  )}
                </Table.Cell>
              </Table.Row>
            );
          })}
        </Table.Body>
      </Table.Root>

      <JobFailuresDialog
        job={detailsJob}
        onOpenChange={(open) => {
          if (!open) setDetailsJob(null);
        }}
      />
    </div>
  );
}
