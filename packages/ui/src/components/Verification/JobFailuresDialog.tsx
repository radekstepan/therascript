// packages/ui/src/components/Verification/JobFailuresDialog.tsx
//
// "View details" dialog for failed or mixed-outcome verification runs:
// the job's error summary plus every attributable per-message failure
// with links to the affected session/chat/note (same navigation
// conventions as the Issues feed: `/sessions/:id/chats/:chatId`
// with `?highlightMsg=`).
import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Callout,
  Dialog,
  Flex,
  Skeleton,
  Text,
} from '@radix-ui/themes';
import { ExclamationTriangleIcon } from '@radix-ui/react-icons';
import {
  fetchVerificationJobFailures,
  verificationFailureCodeLabel,
  type FailedVerificationItem,
  type VerificationJob,
} from '../../api/verification';
import { formatTimestamp } from '../../helpers';
import {
  formatModelDisplayName,
  UNKNOWN_MODEL_DISPLAY_NAME,
} from '../../utils/modelDisplay';

function formatDurationMs(durationMs: number | null): string | null {
  if (durationMs === null || durationMs === undefined) return null;
  if (durationMs < 1000) return `${durationMs} ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function FailureRow({ failure }: { failure: FailedVerificationItem }) {
  const duration = formatDurationMs(failure.durationMs);
  const tokens =
    failure.promptTokens !== null || failure.completionTokens !== null
      ? `${failure.promptTokens ?? 0}+${failure.completionTokens ?? 0} tokens`
      : null;
  return (
    <Flex
      direction="column"
      gap="1"
      py="2"
      style={{ borderTop: '1px solid var(--gray-a5)' }}
    >
      <Flex gap="2" wrap="wrap" align="center">
        <Badge color="red" variant="soft" size="1">
          {verificationFailureCodeLabel(failure.errorCode)}
        </Badge>
        <Link
          to={`/sessions/${failure.sessionId}/chats/${failure.chatId}?highlightMsg=${failure.messageId}`}
          title="Open the affected note in its chat"
          aria-label={`Open note ${failure.messageId} in ${failure.sessionName}`}
          className="hover:underline"
          style={{ color: 'var(--accent-11)' }}
        >
          <Text size="2" weight="medium">
            Note #{failure.messageId}
          </Text>
        </Link>
        <Text size="1" color="gray">
          <Link
            to={`/sessions/${failure.sessionId}`}
            title="Open session transcript"
            aria-label={`Open transcript for ${failure.sessionName}`}
            className="hover:underline"
            style={{ color: 'var(--accent-11)' }}
          >
            {failure.sessionName}
          </Link>{' '}
          · {failure.clientName}
        </Text>
      </Flex>
      {failure.errorMessage && (
        <Text
          size="2"
          as="p"
          title={failure.errorMessage}
          style={{ overflowWrap: 'anywhere' }}
        >
          {failure.errorMessage}
        </Text>
      )}
      <Text size="1" color="gray">
        {[
          `Judge ${formatModelDisplayName(failure.judgeModel)}`,
          failure.authoredModel
            ? `note by ${formatModelDisplayName(failure.authoredModel)}`
            : `note by ${UNKNOWN_MODEL_DISPLAY_NAME}`,
          tokens,
          duration,
          formatTimestamp(failure.verifiedAt),
        ]
          .filter(Boolean)
          .join(' · ')}
      </Text>
    </Flex>
  );
}

export function JobFailuresDialog({
  job,
  onOpenChange,
}: {
  /** Null closes the dialog. */
  job: VerificationJob | null;
  onOpenChange: (open: boolean) => void;
}) {
  const failuresQuery = useQuery({
    queryKey: ['verificationJobFailures', job?.id ?? null],
    queryFn: () => fetchVerificationJobFailures(job!.id),
    enabled: job !== null,
    retry: false,
  });

  const succeeded = job?.succeeded_messages ?? 0;
  const failed = job?.failed_messages ?? 0;

  return (
    <Dialog.Root
      open={job !== null}
      onOpenChange={(open) => {
        // Radix fires onOpenChange for outside interactions too; parent
        // owns the selected job and clears it on close.
        onOpenChange(open);
      }}
    >
      <Dialog.Content style={{ maxWidth: 640 }}>
        <Dialog.Title>
          {job ? `Audit #${job.id} — failure details` : 'Audit failure details'}
        </Dialog.Title>
        <Dialog.Description size="2" mb="3">
          {job?.status === 'failed'
            ? `All ${failed} attempted assessment${failed === 1 ? '' : 's'} failed.`
            : `${succeeded} of ${job?.total_messages ?? 0} checked, ${failed} failed.`}{' '}
          {job?.model_name
            ? `Judge ${formatModelDisplayName(job.model_name)}. `
            : ''}
          Reasons persist on the job and its notes; this dialog reads them back
          from the API.
        </Dialog.Description>

        {job?.error_message && (
          <Callout.Root color="red" size="1" mb="3">
            <Callout.Icon>
              <ExclamationTriangleIcon />
            </Callout.Icon>
            <Callout.Text>{job.error_message}</Callout.Text>
          </Callout.Root>
        )}

        {failuresQuery.isLoading ? (
          <Flex direction="column" gap="2">
            <Skeleton style={{ height: '48px' }} />
            <Skeleton style={{ height: '48px' }} />
          </Flex>
        ) : failuresQuery.isError ? (
          <Callout.Root color="red" size="2">
            <Callout.Icon>
              <ExclamationTriangleIcon />
            </Callout.Icon>
            <Callout.Text>
              Failed to load failure details:{' '}
              {(failuresQuery.error as Error).message}{' '}
              <Button
                size="1"
                variant="soft"
                ml="2"
                onClick={() => failuresQuery.refetch()}
              >
                Retry
              </Button>
            </Callout.Text>
          </Callout.Root>
        ) : (failuresQuery.data?.failures ?? []).length === 0 ? (
          <Text size="2" color="gray" as="p">
            No per-message failures are attributable to this run anymore — the
            notes were likely re-audited by a later job. The counts above are
            the persisted historical record.
          </Text>
        ) : (
          <Flex direction="column">
            {(failuresQuery.data?.failures ?? []).map((failure) => (
              <FailureRow key={failure.messageId} failure={failure} />
            ))}
          </Flex>
        )}

        <Flex gap="3" mt="4" justify="end">
          <Dialog.Close>
            <Button variant="soft" color="gray">
              Close
            </Button>
          </Dialog.Close>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
