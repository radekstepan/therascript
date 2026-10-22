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
import { ShieldCheck, Play, Trash2 } from 'lucide-react';
import {
  cancelVerificationJob,
  fetchVerificationJobs,
  fetchVerificationStats,
  resetVerifications,
  verificationJobOutcome,
  type VerificationJob,
  type VerificationJobScope,
  type VerificationLivePhase,
} from '../../api/verification';
import { useVerificationStream } from '../../hooks/useVerificationStream';
import { toastMessageAtom } from '../../store';
import { VerificationAnalyticsSection } from './VerificationAnalyticsSection';
import { StartVerificationModal } from './StartVerificationModal';
import { IssuesFeedTab } from './IssuesFeedTab';
import { CoverageTab } from './CoverageTab';
import { JobHistoryTab } from './JobHistoryTab';
import { JobFailuresDialog } from './JobFailuresDialog';

function isActiveJob(job: VerificationJob): boolean {
  return job.status === 'pending' || job.status === 'processing';
}

function phaseFallbackText(job: VerificationJob): string | null {
  if (job.status === 'pending') return 'Waiting to start…';
  if (job.current_phase === 'waiting_for_lock')
    return 'Waiting for the LLM worker lock…';
  if (job.current_phase === 'loading_judge') return 'Loading the Judge model…';
  if (job.current_phase === 'finishing') return 'Finishing audit…';
  if (job.current_phase && job.current_message_id != null)
    return `Working on message ${job.current_message_id}…`;
  if (job.current_phase) return 'Audit in progress…';
  return null;
}

function LiveJobBanner({ job }: { job: VerificationJob }) {
  const queryClient = useQueryClient();
  const setToast = useSetAtom(toastMessageAtom);
  const {
    job: liveJob,
    phase,
    streamError,
    connectionLost,
  } = useVerificationStream(job.id, {
    enabled: isActiveJob(job),
  });
  const display = liveJob ?? job;
  const pct =
    display.total_messages > 0
      ? Math.round((display.processed_messages / display.total_messages) * 100)
      : 0;
  const succeeded = display.succeeded_messages ?? 0;
  const failed = display.failed_messages ?? 0;
  // Live SSE phase first, durable snapshot columns after a reload, then a
  // static fallback. Never invent token percentages: this is indeterminate
  // activity while `processed` legitimately stays flat during generation.
  const livePhase: VerificationLivePhase | null = phase;
  const phaseText =
    livePhase?.message ?? phaseFallbackText(display) ?? 'Starting audit…';

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
            <Heading size="3">
              Audit #{display.id} in progress
              {display.model_name && (
                <Text size="2" color="gray" weight="regular">
                  {' '}
                  · Judge {display.model_name}
                </Text>
              )}
            </Heading>
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

        <Flex align="center" gap="2">
          <Text size="2" data-testid="audit-live-phase">
            {phaseText}
          </Text>
        </Flex>

        <Flex gap="2" wrap="wrap" align="center">
          <Badge color="green" variant="soft" size="1">
            {succeeded} checked
          </Badge>
          {failed > 0 && (
            <Badge color="red" variant="soft" size="1">
              {failed} failed
            </Badge>
          )}
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
        </Flex>

        {streamError && (
          <Text size="1" color="red">
            Stream notice: {streamError}
          </Text>
        )}
        {connectionLost && !streamError && (
          <Text size="1" color="amber">
            Live updates interrupted — reconnecting; progress reconciles
            automatically.
          </Text>
        )}
      </Flex>
    </Card>
  );
}

function LastRunResultCard({
  job,
  onViewDetails,
}: {
  job: VerificationJob;
  onViewDetails: (job: VerificationJob) => void;
}) {
  const outcome = verificationJobOutcome(job);
  const succeeded = job.succeeded_messages ?? 0;
  const failed = job.failed_messages ?? 0;
  const isFailed = outcome === 'failed';
  return (
    <Card
      size="3"
      style={{
        borderColor: isFailed ? 'var(--red-a7)' : 'var(--amber-a7)',
      }}
    >
      <Flex direction="column" gap="2">
        <Flex align="center" justify="between" gap="3" wrap="wrap">
          <Flex align="center" gap="2">
            <ExclamationTriangleIcon
              width={18}
              height={18}
              color={isFailed ? 'var(--red-11)' : 'var(--amber-11)'}
            />
            <Heading size="3">
              {isFailed
                ? `Audit #${job.id} failed`
                : `Audit #${job.id} completed with errors`}
            </Heading>
          </Flex>
          <Button size="2" variant="soft" onClick={() => onViewDetails(job)}>
            View details
          </Button>
        </Flex>
        <Text size="2" color="gray">
          {isFailed
            ? `All ${failed} attempted assessment${failed === 1 ? '' : 's'} failed — no new verdicts were recorded.`
            : `${succeeded} of ${job.total_messages} checked, ${failed} failed — successful assessments were kept.`}
        </Text>
        {job.error_message && (
          <Text size="2" as="p" title={job.error_message}>
            {job.error_message}
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
  const [detailsJob, setDetailsJob] = useState<VerificationJob | null>(null);

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

  // Persistent terminal result for the most recent run: jobs arrive newest
  // first, so jobs[0] is the last run. Shown only when it ended failed or
  // mixed — derived from the jobs query, so it survives page reloads.
  const lastRunResult = useMemo(() => {
    if (activeJob) return null;
    const latest = jobsQuery.data?.[0] ?? null;
    if (!latest) return null;
    const outcome = verificationJobOutcome(latest);
    return outcome === 'failed' || outcome === 'completed_with_errors'
      ? latest
      : null;
  }, [activeJob, jobsQuery.data]);

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

  // Coverage-tab retries route through the same audit dialog as the
  // per-session Audit action: the dialog opens pre-scoped to the session
  // with skip-verified on, so failed messages are re-audited while
  // completed verdicts are kept. There is no one-click retry mutation —
  // the header Retry Failed button was removed in favor of this flow.
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
          <Flex
            gap="2"
            wrap="wrap"
            align="center"
            justify="end"
            data-testid="fact-check-header-actions"
          >
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
        {stats && (
          <Flex
            gap="2"
            wrap="wrap"
            align="center"
            mt="-2"
            data-testid="fact-check-header-labels"
          >
            {failedCount > 0 && (
              <Badge
                color="red"
                variant="soft"
                size="2"
                style={{ alignSelf: 'center' }}
                title={`${failedCount} message${failedCount === 1 ? '' : 's'} failed verification with LLM errors`}
              >
                {failedCount} verification{failedCount === 1 ? '' : 's'} failed
              </Badge>
            )}
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
          </Flex>
        )}
        <Text size="2" color="gray" as="p" mt="-2">
          Audit AI responses against session transcripts, track hallucinations,
          and compare model accuracy.
        </Text>

        {activeJob && <LiveJobBanner job={activeJob} />}

        {!activeJob && lastRunResult && (
          <LastRunResultCard
            job={lastRunResult}
            onViewDetails={setDetailsJob}
          />
        )}

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
                  auditDisabled={!!activeJob}
                  onVerifySession={openModalForSession}
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

      <JobFailuresDialog
        job={detailsJob}
        onOpenChange={(open) => {
          if (!open) setDetailsJob(null);
        }}
      />
    </Box>
  );
}
