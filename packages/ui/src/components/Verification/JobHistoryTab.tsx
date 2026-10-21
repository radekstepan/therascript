// packages/ui/src/components/Verification/JobHistoryTab.tsx
//
// History of verification runs: Judge model, scope, progress, duration,
// and per-job cancellation.
import React from 'react';
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
  type VerificationJob,
} from '../../api/verification';
import { toastMessageAtom } from '../../store';
import { formatTimestamp } from '../../helpers';

function statusBadgeColor(
  status: VerificationJob['status']
): 'blue' | 'green' | 'red' | 'gray' {
  switch (status) {
    case 'pending':
    case 'processing':
      return 'blue';
    case 'completed':
      return 'green';
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
      <Table.Root size="2" style={{ minWidth: '820px' }}>
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
                    color={statusBadgeColor(job.status)}
                    variant="soft"
                    size="1"
                  >
                    {job.status}
                  </Badge>
                  {job.error_message && (
                    <Text size="1" color="red" as="p" mt="1">
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
                  <Text size="2">{job.model_name ?? '—'}</Text>
                </Table.Cell>
                <Table.Cell>
                  <Flex align="center" gap="2" style={{ minWidth: '140px' }}>
                    <Progress value={pct} size="1" style={{ flex: 1 }} />
                    <Text size="1" color="gray">
                      {job.processed_messages}/{job.total_messages}
                    </Text>
                  </Flex>
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
    </div>
  );
}
