// packages/ui/src/components/Verification/StatementVerdictModal.tsx
//
// Interactive Judge Verdict Modal: opened from inline statement highlights
// or omission badges in session chat notes (and from the /verification
// issues feed). Steps through every extracted statement for one AI message.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Callout,
  Dialog,
  Flex,
  IconButton,
  ScrollArea,
  Separator,
  Text,
} from '@radix-ui/themes';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  Cross2Icon,
  ExclamationTriangleIcon,
  InfoCircledIcon,
  PersonIcon,
  QuoteIcon,
  TrashIcon,
} from '@radix-ui/react-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AppTooltip } from '../Shared/AppTooltip';
import type {
  StatementSeverity,
  VerifiedStatement,
} from '../../api/verification';
import { deleteMessageVerification } from '../../api/verification';
import {
  formatEvidenceTimestamp,
  getVerdictBadgeColor,
  getVerdictLabel,
  parseStatementEvidence,
} from '../../utils/highlightVerifiedStatements';

export interface StatementVerdictModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Claims + omissions for one AI message (sorted by statement_index). */
  statements: VerifiedStatement[];
  initialStatementId?: number | null;
  authoredModel?: string | null;
  judgeModel?: string | null;
  verifiedAt?: number | null;
  summaryAssessment?: string | null;
  /** Therapist's prompt — shown as context for omissions. */
  userQuestion?: string | null;
  /**
   * Owning chat message id. Enables the "Clear Response Fact Check"
   * footer action (delete the whole response's verification + invalidate
   * + close) so the message returns to the unverified pool for re-audit.
   */
  messageId?: number | null;
}

function getSeverityBadgeColor(
  severity: StatementSeverity
): 'gray' | 'green' | 'yellow' | 'orange' | 'red' {
  switch (severity) {
    case 'critical':
      return 'red';
    case 'high':
      return 'orange';
    case 'medium':
      return 'yellow';
    case 'low':
      return 'green';
    case 'none':
    default:
      return 'gray';
  }
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}

export function StatementVerdictModal({
  open,
  onOpenChange,
  statements,
  initialStatementId,
  authoredModel,
  judgeModel,
  verifiedAt,
  summaryAssessment,
  userQuestion,
  messageId,
}: StatementVerdictModalProps) {
  const queryClient = useQueryClient();

  const clearMutation = useMutation({
    mutationFn: () => {
      if (messageId === undefined || messageId === null) {
        throw new Error('Message id missing for clear verification.');
      }
      return deleteMessageVerification(messageId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chatVerifications'] });
      queryClient.invalidateQueries({ queryKey: ['verificationStats'] });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      console.error(
        `[StatementVerdictModal] Failed to clear verification for message ${messageId}:`,
        error
      );
    },
  });
  const sorted = useMemo(
    () =>
      [...statements].sort((a, b) => {
        if (a.statement_index !== b.statement_index) {
          return a.statement_index - b.statement_index;
        }
        return a.id - b.id;
      }),
    [statements]
  );

  const [selectedIndex, setSelectedIndex] = useState(0);

  // Sync selection whenever the modal opens or a new statement is targeted.
  useEffect(() => {
    if (!open) return;
    const idx =
      initialStatementId == null
        ? 0
        : sorted.findIndex((s) => s.id === initialStatementId);
    setSelectedIndex(idx >= 0 ? idx : 0);
  }, [open, initialStatementId, sorted]);

  const goPrev = useCallback(() => {
    setSelectedIndex((prev) =>
      sorted.length === 0 ? 0 : (prev - 1 + sorted.length) % sorted.length
    );
  }, [sorted.length]);

  const goNext = useCallback(() => {
    setSelectedIndex((prev) =>
      sorted.length === 0 ? 0 : (prev + 1) % sorted.length
    );
  }, [sorted.length]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        goPrev();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        goNext();
      }
    },
    [goPrev, goNext]
  );

  const current =
    sorted.length > 0 ? (sorted[selectedIndex] ?? sorted[0]!) : null;
  const evidence = useMemo(
    () => (current ? parseStatementEvidence(current) : []),
    [current]
  );

  const verifiedDate =
    verifiedAt != null
      ? new Date(verifiedAt).toLocaleString(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short',
        })
      : null;

  const showNoEvidenceCallout =
    current !== null &&
    current.verdict === 'fabricated' &&
    evidence.length === 0;
  const showEmptyEvidenceNote =
    current !== null &&
    current.verdict !== 'fabricated' &&
    evidence.length === 0;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content
        style={{ maxWidth: 640, width: 'calc(100vw - 32px)' }}
        onKeyDown={handleKeyDown}
      >
        <Flex justify="between" align="start" gap="3">
          <Box>
            <Dialog.Title size="4">Fact Check</Dialog.Title>
            <Dialog.Description size="2" color="gray">
              {sorted.length > 1
                ? `Statement ${selectedIndex + 1} of ${sorted.length} in this response`
                : 'Fact-check verdict for this statement'}
            </Dialog.Description>
          </Box>
          <Flex align="center" gap="1" style={{ flexShrink: 0 }}>
            <Dialog.Close>
              <IconButton
                size="2"
                variant="ghost"
                color="gray"
                aria-label="Close"
              >
                <Cross2Icon />
              </IconButton>
            </Dialog.Close>
          </Flex>
        </Flex>

        {current === null ? (
          <Box py="5">
            <Callout.Root color="gray" size="2">
              <Callout.Icon>
                <InfoCircledIcon />
              </Callout.Icon>
              <Callout.Text>
                No verified statements available for this message yet.
              </Callout.Text>
            </Callout.Root>
          </Box>
        ) : (
          <ScrollArea
            type="auto"
            scrollbars="vertical"
            style={{ maxHeight: '62vh', marginTop: 12 }}
          >
            <Flex direction="column" gap="4" pr="4" pb="2">
              {/* Header badges */}
              <Flex align="center" gap="2" wrap="wrap">
                <Badge
                  color={getVerdictBadgeColor(current.verdict)}
                  variant="solid"
                  size="2"
                >
                  {getVerdictLabel(current.verdict).toUpperCase()}
                </Badge>
                {current.severity !== 'none' && (
                  <Badge
                    color={getSeverityBadgeColor(current.severity)}
                    variant="soft"
                    size="1"
                  >
                    {capitalize(current.severity)} severity
                  </Badge>
                )}
                <Badge color="gray" variant="soft" size="1">
                  {Math.round(current.confidence * 100)}% confidence
                </Badge>
                {current.kind === 'omission' && (
                  <Badge color="amber" variant="outline" size="1">
                    Omitted from response
                  </Badge>
                )}
              </Flex>

              {/* Section 1 — extracted statement */}
              <Box>
                <Text as="div" size="2" weight="medium" mb="2">
                  {current.kind === 'omission'
                    ? 'What the response missed'
                    : 'Extracted statement'}
                </Text>
                {current.kind === 'claim' &&
                  current.exact_quote.trim() !== '' && (
                    <Box
                      p="3"
                      mb="2"
                      style={{
                        background: 'var(--gray-a2)',
                        border: '1px solid var(--gray-a5)',
                        borderLeft: '3px solid var(--gray-8)',
                        borderRadius: 'var(--radius-3)',
                      }}
                    >
                      <Flex gap="2" align="start">
                        <Box pt="1" style={{ color: 'var(--gray-9)' }}>
                          <QuoteIcon />
                        </Box>
                        <Text size="2" style={{ fontStyle: 'italic' }}>
                          &ldquo;{current.exact_quote}&rdquo;
                        </Text>
                      </Flex>
                    </Box>
                  )}
                {current.kind === 'omission' &&
                  userQuestion != null &&
                  userQuestion.trim() !== '' && (
                    <Box
                      p="3"
                      mb="2"
                      style={{
                        background: 'var(--accent-a2)',
                        border: '1px solid var(--accent-a5)',
                        borderRadius: 'var(--radius-3)',
                      }}
                    >
                      <Text as="div" size="1" color="gray" mb="1">
                        Therapist asked
                      </Text>
                      <Text size="2">{userQuestion}</Text>
                    </Box>
                  )}
                <Flex gap="2" align="start">
                  <Text size="2" color="gray" style={{ flexShrink: 0 }}>
                    Claim:
                  </Text>
                  <Text size="2">{current.normalized_claim}</Text>
                </Flex>
              </Box>

              <Separator size="4" />

              {/* Section 2 — judge reasoning */}
              <Box>
                <Text as="div" size="2" weight="medium" mb="2">
                  Judge&rsquo;s reasoning
                </Text>
                <Text size="2" color="gray" style={{ lineHeight: 1.6 }}>
                  {current.reasoning}
                </Text>
              </Box>

              <Separator size="4" />

              {/* Section 3 — transcript evidence */}
              <Box>
                <Text as="div" size="2" weight="medium" mb="2">
                  Transcript evidence
                </Text>
                {showNoEvidenceCallout && (
                  <Callout.Root color="red" size="2">
                    <Callout.Icon>
                      <ExclamationTriangleIcon />
                    </Callout.Icon>
                    <Callout.Text>
                      No matching evidence found anywhere in the session
                      transcript — this statement appears to be fabricated.
                    </Callout.Text>
                  </Callout.Root>
                )}
                {showEmptyEvidenceNote && (
                  <Callout.Root color="gray" size="1">
                    <Callout.Icon>
                      <InfoCircledIcon />
                    </Callout.Icon>
                    <Callout.Text>
                      The Fact Check did not attach transcript quotes for this
                      statement.
                    </Callout.Text>
                  </Callout.Root>
                )}
                <Flex direction="column" gap="2">
                  {evidence.map((item, idx) => (
                    <Box
                      key={`${item.paragraphIndex ?? 'na'}-${idx}`}
                      p="3"
                      style={{
                        background: 'var(--gray-a2)',
                        border: '1px solid var(--gray-a5)',
                        borderRadius: 'var(--radius-3)',
                      }}
                    >
                      <Flex align="center" gap="2" wrap="wrap" mb="2">
                        {item.speaker != null &&
                          item.speaker.trim() !== '' &&
                          item.speaker.trim().toUpperCase() !== 'UNKNOWN' && (
                            <Badge color="blue" variant="soft" size="1">
                              <PersonIcon />
                              {item.speaker}
                            </Badge>
                          )}
                        <Badge
                          color="gray"
                          variant="soft"
                          size="1"
                          title={
                            item.timestampMs != null
                              ? `Transcript position ${formatEvidenceTimestamp(item.timestampMs)}`
                              : 'Unknown transcript position'
                          }
                        >
                          <ClockIcon />
                          {formatEvidenceTimestamp(item.timestampMs)}
                        </Badge>
                        {item.paragraphIndex != null && (
                          <Text size="1" as="span">
                            <Link
                              to={`#paragraph-${item.paragraphIndex}`}
                              title="Jump to this paragraph in the session transcript"
                              aria-label={`Jump to transcript paragraph ${item.paragraphIndex}`}
                              className="hover:underline"
                              style={{ color: 'var(--accent-11)' }}
                            >
                              ¶{item.paragraphIndex}
                            </Link>
                          </Text>
                        )}
                      </Flex>
                      <Text size="2" style={{ lineHeight: 1.6 }}>
                        &ldquo;{item.quote}&rdquo;
                      </Text>
                    </Box>
                  ))}
                </Flex>
              </Box>

              <Separator size="4" />

              {/* Footer metadata */}
              <Flex direction="column" gap="1">
                {summaryAssessment != null && summaryAssessment !== '' && (
                  <Text size="1" color="gray" style={{ fontStyle: 'italic' }}>
                    {summaryAssessment}
                  </Text>
                )}
                <Flex align="center" gap="2" wrap="wrap">
                  <Text size="1" color="gray">
                    Authored by:{' '}
                    <Text weight="medium">
                      {authoredModel || 'Unknown model'}
                    </Text>
                  </Text>
                  <Text size="1" color="gray">
                    ·
                  </Text>
                  <Text size="1" color="gray">
                    Audited by Judge:{' '}
                    <Text weight="medium">{judgeModel || 'Unknown judge'}</Text>
                  </Text>
                  {verifiedDate !== null && (
                    <>
                      <Text size="1" color="gray">
                        ·
                      </Text>
                      <Text size="1" color="gray">
                        {verifiedDate}
                      </Text>
                    </>
                  )}
                </Flex>
              </Flex>
            </Flex>
          </ScrollArea>
        )}

        {(sorted.length > 1 || messageId != null) && (
          <Flex justify="between" align="center" mt="4" gap="2" wrap="wrap">
            {messageId != null ? (
              <Flex direction="column" gap="1" align="start">
                {/* Scope + recheck behavior, since "Clear Verification"
                    reads as if it might clear only the statement shown. */}
                <AppTooltip
                  content={
                    sorted.length > 1
                      ? `Deletes all ${sorted.length} fact-check statements for this response — not just the one shown above. The response returns to the unverified pool and will be re-checked on the next audit.`
                      : `Deletes this response's fact-check statement. The response returns to the unverified pool and will be re-checked on the next audit.`
                  }
                >
                  <span style={{ display: 'inline-block' }}>
                    <Button
                      size="2"
                      variant="soft"
                      color="red"
                      disabled={clearMutation.isPending}
                      onClick={() => clearMutation.mutate()}
                    >
                      <TrashIcon />{' '}
                      {clearMutation.isPending
                        ? 'Clearing…'
                        : 'Clear Response Fact Check'}
                    </Button>
                  </span>
                </AppTooltip>
                {clearMutation.isError && (
                  <Text size="1" color="red">
                    Couldn&apos;t clear — try again.
                  </Text>
                )}
              </Flex>
            ) : (
              <Box />
            )}
            {sorted.length > 1 ? (
              <Flex gap="2">
                <Button size="2" variant="soft" color="gray" onClick={goPrev}>
                  <ChevronLeftIcon /> Prev
                </Button>
                <Button size="2" variant="soft" color="gray" onClick={goNext}>
                  Next <ChevronRightIcon />
                </Button>
              </Flex>
            ) : (
              <Box />
            )}
          </Flex>
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}
