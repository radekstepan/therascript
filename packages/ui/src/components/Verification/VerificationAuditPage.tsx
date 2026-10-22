// packages/ui/src/components/Verification/VerificationAuditPage.tsx
//
// Global "Quality & Audit" hub (`/verification`): job launcher + live
// progress banner, accuracy analytics, and the Issues / Coverage /
// Job History explorer.
import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSetAtom } from 'jotai';
import {
  Box,
  Flex,
  Heading,
  Text,
  Button,
  Badge,
  Card,
  Tabs,
  Progress,
  Skeleton,
  Callout,
  AlertDialog,
  Spinner,
} from '@radix-ui/themes';
import { ExclamationTriangleIcon, Cross2Icon } from '@radix-ui/react-icons';
import { ShieldCheck, Play, Trash2, RotateCcw } from 'lucide-react';
import {
  cancelVerificationJob,
  createVerificationJob,
  fetchVerificationJobs,
  fetchVerificationStats,
  resetVerifications,
  type VerificationJob,
  type VerificationJobScope,
} from '../../api/verification';
import { useVerificationStream } from '../../hooks/useVerificationStream';
import { toastMessageAtom } from '../../store';
import { VerificationAnalyticsSection } from './VerificationAnalyticsSection';
import { StartVerificationModal } from './StartVerificationModal';
import { IssuesFeedTab } from './IssuesFeedTab';
import { CoverageTab } from './CoverageTab';
import { JobHistoryTab } from './JobHistoryTab';

function isActiveJob(job: VerificationJob): boolean {
  return job.status === 'pending' || job.status === 'processing';
}

function LiveJobBanner({ job }: { job: VerificationJob }) {
  const queryClient = useQueryClient();
  const setToast = useSetAtom(toastMessageAtom);
  const { job: liveJob, streamError } = useVerificationStream(job.id, {
    enabled: isActiveJob(job),
  });
  const display = liveJob ?? job;
  const pct =
    display.total_messages > 0
      ? Math.round((display.processed_messages / display.total_messages) * 100)
      : 0;

  const cancelMutation = useMutation({
    mutationFn: cancelVerificationJob,
    onSuccess: () => {
      setToast('Cancellation requested — the audit will stop shortly.');
      queryClient.invalidateQueries({ queryKey: ['verificationJobs'] });
      queryClient.invalidateQueries({ queryKey: ['verificationStats'] });
    },
    onError: (error: Error) => {
      setToast(`Failed to cancel job: ${error.message}`);
    },
  });

  return (
    <Card size="3" style={{ borderColor: 'var(--accent-a7)' }}>
      <Flex direction="column" gap="3">
        <Flex align="center" justify="between" gap="3" wrap="wrap">
          <Flex align="center" gap="2">
            <Spinner size="2" />
            <Heading size="3">Audit #{display.id} in progress</Heading>
          </Flex>
          <Button
            size="2"
            variant="soft"
            color="red"
            disabled={cancelMutation.isPending}
            onClick={() => cancelMutation.mutate(display.id)}
          >
            <Cross2Icon />{' '}
            {cancelMutation.isPending ? 'Canceling…' : 'Cancel Job'}
          </Button>
        </Flex>

        <Box>
          <Flex align="center" justify="between" mb="1">
            <Text size="2" color="gray">
              Processed {display.processed_messages} / {display.total_messages}{' '}
              messages — auditing newest first
            </Text>
            <Text size="2" weight="medium">
              {pct}%
            </Text>
          </Flex>
          <Progress value={pct} size="2" />
        </Box>

        <Flex gap="2" wrap="wrap" align="center">
          <Badge color="blue" variant="soft" size="1">
            {display.total_statements} claims verified
          </Badge>
          <Badge
            color={display.flagged_statements > 0 ? 'red' : 'gray'}
            variant="soft"
            size="1"
          >
            {display.flagged_statements} issues flagged
          </Badge>
          <Badge
            color={display.omissions_count > 0 ? 'amber' : 'gray'}
            variant="soft"
            size="1"
          >
            {display.omissions_count} omissions
          </Badge>
          {display.model_name && (
            <Badge color="purple" variant="soft" size="1">
              Judge: {display.model_name}
            </Badge>
          )}
        </Flex>

        {streamError && (
          <Text size="1" color="red">
            Stream notice: {streamError}
          </Text>
        )}
      </Flex>
    </Card>
  );
}

export function VerificationAuditPage() {
  const queryClient = useQueryClient();
  const setToast = useSetAtom(toastMessageAtom);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalScope, setModalScope] = useState<
    VerificationJobScope | undefined
  >(undefined);
  const [modalSessionIds, setModalSessionIds] = useState<number[] | undefined>(
    undefined
  );

  const jobsQuery = useQuery({
    queryKey: ['verificationJobs'],
    queryFn: fetchVerificationJobs,
    refetchInterval: (q) => {
      const hasActive = q.state.data?.some(isActiveJob) ?? false;
      return hasActive ? 3000 : false;
    },
  });

  const activeJob = useMemo(
    () => jobsQuery.data?.find(isActiveJob) ?? null,
    [jobsQuery.data]
  );

  const statsQuery = useQuery({
    queryKey: ['verificationStats'],
    queryFn: () => fetchVerificationStats(),
    // The SSE hook already invalidates on every verified message; this
    // poll is only a backstop for missed events while a job runs.
    refetchInterval: activeJob ? 10000 : false,
  });

  const resetMutation = useMutation({
    mutationFn: resetVerifications,
    onSuccess: (data) => {
      setToast(data.message);
      queryClient.invalidateQueries({ queryKey: ['verificationStats'] });
      queryClient.invalidateQueries({ queryKey: ['verificationJobs'] });
      queryClient.invalidateQueries({
        queryKey: ['verificationStatements'],
      });
      queryClient.invalidateQueries({ queryKey: ['chatVerifications'] });
    },
    onError: (error: Error) => {
      setToast(`Failed to reset verifications: ${error.message}`);
    },
  });

  const openModalForAll = () => {
    setModalScope(undefined);
    setModalSessionIds(undefined);
    setIsModalOpen(true);
  };

  const openModalForSession = (sessionId: number) => {
    setModalScope('selected_sessions');
    setModalSessionIds([sessionId]);
    setIsModalOpen(true);
  };

  // One-click retry for failed messages: skipVerified keeps completed
  // verdicts while failed (and any remaining unverified) messages are
  // re-audited with the active Judge model. The backend refuses (409)
  // while another job runs, so the buttons stay disabled then.
  const retryFailedMutation = useMutation({
    mutationFn: (sessionIds?: number[]) =>
      sessionIds
        ? createVerificationJob({
            scope: 'selected_sessions',
            sessionIds,
            skipVerified: true,
          })
        : createVerificationJob({
            scope: 'all_unverified',
            skipVerified: true,
          }),
    onSuccess: () => {
      setToast('Retrying failed verifications — auditing newest first.');
      queryClient.invalidateQueries({ queryKey: ['verificationJobs'] });
      queryClient.invalidateQueries({ queryKey: ['verificationStats'] });
    },
    onError: (error: Error) => {
      setToast(`Failed to retry verifications: ${error.message}`);
    },
  });

  const handleVerifySession = (sessionId: number) => {
    retryFailedMutation.mutate([sessionId]);
  };

  const stats = statsQuery.data;
  const unverifiedCount = stats?.unverifiedMessagesCount ?? 0;
  const unverifiedTranscripts =
    stats?.sessionsSummary.filter((s) => !s.isFullyVerified).length ?? 0;
  const failedCount = stats?.failedMessagesCount ?? 0;

  return (
    <Box
      p={{ initial: '4', md: '6' }}
      style={{ maxWidth: 1200, margin: '0 auto' }}
    >
      <Flex direction="column" gap="4">
        <Flex
          align="center"
          justify="between"
          gap="3"
          wrap="wrap"
          data-testid="fact-check-header-row"
        >
          <Flex align="center" gap="2">
            <ShieldCheck size={22} />
            <Heading size="6">Fact Check</Heading>
          </Flex>
          <Flex gap="2" wrap="wrap" align="center" justify="end">
            {stats && failedCount > 0 && (
              <>
                <Badge
                  color="red"
                  variant="soft"
                  size="2"
                  style={{ alignSelf: 'center' }}
                  title={`${failedCount} message${failedCount === 1 ? '' : 's'} failed verification with LLM errors`}
                >
                  {failedCount} verification{failedCount === 1 ? '' : 's'}{' '}
                  failed
                </Badge>
                <Button
                  size="2"
                  variant="soft"
                  color="red"
                  disabled={!!activeJob || retryFailedMutation.isPending}
                  title={
                    activeJob
                      ? 'An audit is already running'
                      : 'Re-audit failed messages (skips already-verified ones)'
                  }
                  onClick={() => retryFailedMutation.mutate(undefined)}
                >
                  <RotateCcw size={15} />{' '}
                  {retryFailedMutation.isPending ? 'Retrying…' : 'Retry Failed'}
                </Button>
              </>
            )}
            {stats && (
              <Badge
                color={unverifiedCount > 0 ? 'amber' : 'green'}
                variant="soft"
                size="2"
                style={{ alignSelf: 'center' }}
              >
                {unverifiedCount === 0
                  ? 'Everything verified'
                  : `${unverifiedCount} unverified message${unverifiedCount === 1 ? '' : 's'} across ${unverifiedTranscripts} transcript${unverifiedTranscripts === 1 ? '' : 's'}`}
              </Badge>
            )}
            <AlertDialog.Root>
              <AlertDialog.Trigger>
                <Button
                  variant="soft"
                  color="red"
                  disabled={
                    resetMutation.isPending ||
                    !!activeJob ||
                    (stats?.totalMessagesAudited ?? 0) === 0
                  }
                  title={
                    activeJob
                      ? 'Cancel the running audit before resetting'
                      : 'Clear all verifications'
                  }
                >
                  <Trash2 size={15} /> Reset
                </Button>
              </AlertDialog.Trigger>
              <AlertDialog.Content style={{ maxWidth: 450 }}>
                <AlertDialog.Title>Clear all verifications?</AlertDialog.Title>
                <AlertDialog.Description size="2">
                  This permanently deletes every audit verdict and flagged
                  statement. Chats can be re-audited afterwards from scratch.
                </AlertDialog.Description>
                <Flex gap="3" mt="4" justify="end">
                  <AlertDialog.Cancel>
                    <Button variant="soft" color="gray">
                      Cancel
                    </Button>
                  </AlertDialog.Cancel>
                  <AlertDialog.Action>
                    <Button
                      variant="solid"
                      color="red"
                      disabled={resetMutation.isPending}
                      onClick={() => resetMutation.mutate()}
                    >
                      {resetMutation.isPending ? 'Clearing…' : 'Clear all'}
                    </Button>
                  </AlertDialog.Action>
                </Flex>
              </AlertDialog.Content>
            </AlertDialog.Root>
            <Button size="2" onClick={openModalForAll} disabled={!!activeJob}>
              <Play size={15} /> Run Verification Audit
            </Button>
          </Flex>
        </Flex>
        <Text size="2" color="gray" as="p" mt="-2">
          Audit AI responses against session transcripts, track hallucinations,
          and compare model accuracy.
        </Text>

        {activeJob && <LiveJobBanner job={activeJob} />}

        {statsQuery.isLoading ? (
          <Flex direction="column" gap="4">
            <Flex gap="4" wrap="wrap">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton
                  key={i}
                  style={{ height: '110px', flex: '1 1 200px' }}
                />
              ))}
            </Flex>
            <Skeleton style={{ height: '260px' }} />
          </Flex>
        ) : statsQuery.isError ? (
          <Callout.Root color="red" size="2">
            <Callout.Icon>
              <ExclamationTriangleIcon />
            </Callout.Icon>
            <Callout.Text>
              Failed to load verification analytics:{' '}
              {(statsQuery.error as Error).message}{' '}
              <Button
                size="1"
                variant="soft"
                ml="2"
                onClick={() => statsQuery.refetch()}
              >
                Retry
              </Button>
            </Callout.Text>
          </Callout.Root>
        ) : stats ? (
          <VerificationAnalyticsSection stats={stats} />
        ) : null}

        <Tabs.Root defaultValue="issues">
          <Tabs.List size="2">
            <Tabs.Trigger value="issues">Issues feed</Tabs.Trigger>
            <Tabs.Trigger value="coverage">Transcripts coverage</Tabs.Trigger>
            <Tabs.Trigger value="history">Job history</Tabs.Trigger>
          </Tabs.List>
          <Box pt="4">
            <Tabs.Content value="issues">
              <IssuesFeedTab
                models={(stats?.byModel ?? []).map((m) => m.model)}
                clients={Array.from(
                  new Set(
                    (stats?.sessionsSummary ?? []).map((s) => s.clientName)
                  )
                ).sort((a, b) => a.localeCompare(b))}
              />
            </Tabs.Content>
            <Tabs.Content value="coverage">
              {statsQuery.isLoading ? (
                <Skeleton style={{ height: '200px' }} />
              ) : (
                <CoverageTab
                  sessions={stats?.sessionsSummary ?? []}
                  onAuditSession={openModalForSession}
                  auditDisabled={!!activeJob || retryFailedMutation.isPending}
                  onVerifySession={handleVerifySession}
                />
              )}
            </Tabs.Content>
            <Tabs.Content value="history">
              <JobHistoryTab />
            </Tabs.Content>
          </Box>
        </Tabs.Root>
      </Flex>

      <StartVerificationModal
        isOpen={isModalOpen}
        onOpenChange={setIsModalOpen}
        sessionsSummary={stats?.sessionsSummary ?? []}
        initialScope={modalScope}
        initialSessionIds={modalSessionIds}
        onJobCreated={() => {
          queryClient.invalidateQueries({ queryKey: ['verificationJobs'] });
          queryClient.invalidateQueries({ queryKey: ['verificationStats'] });
        }}
      />
    </Box>
  );
}
