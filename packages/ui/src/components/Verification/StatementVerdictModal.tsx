// packages/ui/src/components/Verification/StatementVerdictModal.tsx
//
// Interactive Judge Verdict Modal: opened from inline statement highlights
// or omission badges in session chat notes (and from the /verification
// issues feed). Steps through every extracted statement for one AI message.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Badge,
  Box,
  Button,
  Callout,
  Flex,
  Heading,
  IconButton,
  ScrollArea,
  Separator,
  Text,
  Theme,
} from '@radix-ui/themes';
import * as DialogPrimitive from '@radix-ui/react-dialog';
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
  MessageVerification,
  StatementSeverity,
  VerifiedStatement,
} from '../../api/verification';
import { dismissStatementVerification } from '../../api/verification';
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
  /** Fires with the currently shown statement on open and every step. */
  onSelectionChange?: (statement: VerifiedStatement | null) => void;
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

/** localStorage slot for the Fact Check panel's last drag offset. */
const PANEL_POSITION_STORAGE_KEY = 'therascript.fact-check-panel-pos';

interface PanelDrag {
  x: number;
  y: number;
}

/** Clamp a drag offset so the dialog can never be dragged fully out of view. */
function clampPanelDrag(x: number, y: number): PanelDrag {
  if (typeof window === 'undefined') return { x, y };
  const maxX = Math.max(0, window.innerWidth - 160);
  const maxY = Math.max(0, window.innerHeight / 2 - 80);
  return {
    x: Math.min(Math.max(x, -24), maxX),
    y: Math.min(Math.max(y, -maxY), maxY),
  };
}

/** Last persisted panel offset, or the left-docked default. Never throws. */
function loadPersistedPanelDrag(): PanelDrag {
  try {
    const raw = window.localStorage?.getItem(PANEL_POSITION_STORAGE_KEY);
    if (raw == null) return { x: 0, y: 0 };
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      Number.isFinite((parsed as { x?: unknown }).x) &&
      Number.isFinite((parsed as { y?: unknown }).y)
    ) {
      const { x, y } = parsed as { x: number; y: number };
      return clampPanelDrag(x, y);
    }
  } catch {
    // Corrupt storage or no DOM (tests/SSR): fall back to the dock.
  }
  return { x: 0, y: 0 };
}

/** Persist the panel offset. Never throws. */
function persistPanelDrag(drag: PanelDrag): void {
  try {
    window.localStorage?.setItem(
      PANEL_POSITION_STORAGE_KEY,
      JSON.stringify(drag)
    );
  } catch {
    // Storage unavailable (private mode, SSR): the panel still works.
  }
}

/** Findings the user may confirm as not-an-issue (supported needs no action). */
function isDismissible(statement: VerifiedStatement): boolean {
  if (statement.review_status === 'confirmed') return false;
  if (statement.kind === 'omission') return true;
  return (
    statement.verdict === 'partially_supported' ||
    statement.verdict === 'contradicted' ||
    statement.verdict === 'fabricated'
  );
}

function mutationErrorMessage(error: unknown): string {
  // Thrown ApiErrors surface as a plain-text body (Elysia native mapping);
  // accept an enveloped { message } shape too when one is ever returned.
  const data = (error as { response?: { data?: unknown } })?.response?.data;
  if (typeof data === 'string' && data.trim() !== '') {
    return data;
  }
  const axiosMessage = (data as { message?: unknown } | null)?.message;
  if (typeof axiosMessage === 'string' && axiosMessage.trim() !== '') {
    return axiosMessage;
  }
  return error instanceof Error && error.message
    ? error.message
    : 'Something went wrong — try again.';
}

/** 404/409 dismiss responses carry the current assessment for refresh. */
function errorRefreshVerification(error: unknown): MessageVerification | null {
  const verification = (
    error as {
      response?: { data?: { details?: { verification?: unknown } } };
    }
  )?.response?.data?.details?.verification;
  return verification != null &&
    typeof verification === 'object' &&
    typeof (verification as MessageVerification).message_id === 'number'
    ? (verification as MessageVerification)
    : null;
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
  onSelectionChange,
}: StatementVerdictModalProps) {
  const queryClient = useQueryClient();

  // Immediate cache update from an authoritative assessment (success
  // payload or 404/409 refresh), then refetch every dependent prefix.
  const applyVerificationRefresh = useCallback(
    (verification: MessageVerification) => {
      queryClient.setQueriesData<MessageVerification[] | undefined>(
        { queryKey: ['chatVerifications'] },
        (old) => {
          if (!Array.isArray(old)) return old;
          return old.map((v) =>
            v.message_id === verification.message_id ? verification : v
          );
        }
      );
      queryClient.invalidateQueries({ queryKey: ['chatVerifications'] });
      queryClient.invalidateQueries({ queryKey: ['verificationStats'] });
      queryClient.invalidateQueries({ queryKey: ['verificationStatements'] });
    },
    [queryClient]
  );

  const dismissMutation = useMutation({
    mutationFn: ({
      statementId,
      token,
    }: {
      statementId: number;
      token: string;
    }) => dismissStatementVerification(statementId, token),
    onMutate: async () => {
      // Dismissal needs no active job/SSE: cancel in-flight reads so a
      // stale response cannot restore highlights after the update lands.
      await queryClient.cancelQueries({ queryKey: ['chatVerifications'] });
      await queryClient.cancelQueries({ queryKey: ['verificationStats'] });
      await queryClient.cancelQueries({
        queryKey: ['verificationStatements'],
      });
    },
    onSuccess: (data) => {
      applyVerificationRefresh(data.verification);
    },
    onError: (error: Error) => {
      console.error(
        `[StatementVerdictModal] Failed to dismiss statement:`,
        error
      );
      // Stale/failed dismissals refresh to the current assessment carried
      // on the error (or a plain refetch when nothing is resolvable) so
      // the modal never shows a finding that no longer exists.
      const refresh = errorRefreshVerification(error);
      if (refresh) {
        applyVerificationRefresh(refresh);
      } else {
        queryClient.invalidateQueries({ queryKey: ['chatVerifications'] });
        queryClient.invalidateQueries({ queryKey: ['verificationStats'] });
        queryClient.invalidateQueries({ queryKey: ['verificationStatements'] });
      }
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

  // Selection tracks the statement ID (not the index) so refetches that
  // reorder rows can never retarget another finding. Explicit targeting
  // syncs on open/initial change only — never on bare refetches.
  const [selectedId, setSelectedId] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelectedId(initialStatementId ?? null);
  }, [open, initialStatementId]);

  const selectedIndex = useMemo(() => {
    if (sorted.length === 0) return 0;
    if (selectedId == null) return 0;
    const idx = sorted.findIndex((s) => s.id === selectedId);
    return idx >= 0 ? idx : 0;
  }, [sorted, selectedId]);

  const goPrev = useCallback(() => {
    if (sorted.length === 0) return;
    const idx = (selectedIndex - 1 + sorted.length) % sorted.length;
    setSelectedId(sorted[idx]!.id);
  }, [sorted, selectedIndex]);

  const goNext = useCallback(() => {
    if (sorted.length === 0) return;
    const idx = (selectedIndex + 1) % sorted.length;
    setSelectedId(sorted[idx]!.id);
  }, [sorted, selectedIndex]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (dismissMutation.isPending) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        goPrev();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        goNext();
      }
    },
    [goPrev, goNext, dismissMutation.isPending]
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

  // --- Left-docked, draggable positioning ----------------------------------
  // The modal opens over the session chat (left half) instead of centered,
  // so the transcript (right half) stays visible and interactive beside
  // it. The header doubles as a drag handle; the offset persists in
  // localStorage across opens so the panel reappears exactly where the
  // user left it instead of sliding in from the dock edge.
  const [drag, setDrag] = useState(() => loadPersistedPanelDrag());
  // Mirrors the latest drag offset synchronously: pointermove + pointerup
  // can dispatch back-to-back (synthetic events, tests) before React
  // flushes the setDrag re-render, so the drop-point persist must not
  // wait for a render to observe the new offset.
  const dragRef = useRef(drag);
  const dragStart = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  useEffect(() => {
    if (open) {
      const restored = loadPersistedPanelDrag();
      dragRef.current = restored;
      setDrag(restored);
    }
  }, [open]);

  // Tell the chat thread which statement is shown so the note can flash
  // the matching inline highlight (open + every Prev/Next/arrow step).
  useEffect(() => {
    if (open) onSelectionChange?.(current);
  }, [open, current, onSelectionChange]);

  const handleDragMove = useCallback((event: React.PointerEvent) => {
    const s = dragStart.current;
    if (!s) return;
    const nextX = s.origX + (event.clientX - s.startX);
    const nextY = s.origY + (event.clientY - s.startY);
    const next = clampPanelDrag(nextX, nextY);
    dragRef.current = next;
    setDrag(next);
  }, []);

  const handleDragEnd = useCallback(() => {
    dragStart.current = null;
    // Remember the drop point so the next open starts here immediately.
    persistPanelDrag(dragRef.current);
  }, []);

  const handleDragStart = useCallback(
    (event: React.PointerEvent) => {
      if (event.button !== 0) return;
      // Interactive elements inside the header (the Close button) keep
      // their own behavior instead of starting a drag.
      if ((event.target as HTMLElement | null)?.closest?.('button')) return;
      dragStart.current = {
        startX: event.clientX,
        startY: event.clientY,
        origX: drag.x,
        origY: drag.y,
      };
      try {
        (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
      } catch {
        // Pointer capture keeps move events flowing to the handle when
        // the pointer leaves it mid-drag; without it the drag simply
        // stops at the header edge.
      }
    },
    [drag]
  );

  // Modeless + portal: `modal={false}` leaves the session transcript
  // fully visible and interactive beside the docked panel (the Themes
  // Dialog root hardcodes modal, so the raw primitives are used here
  // with the same `rt-DialogContent` surface classes). No overlay is
  // rendered, so nothing dims the transcript. The inner `<Theme>`
  // re-establishes the design-token scope the portal escapes (the app
  // `<Theme>` does not cover `document.body`): without it the panel
  // and its controls lose background, padding, and shadows.
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <DialogPrimitive.Portal>
        <Theme>
          <DialogPrimitive.Content
            data-testid="fact-check-modal"
            className="rt-BaseDialogContent rt-DialogContent rt-r-size-3 fact-check-panel"
            style={{
              maxWidth: 640,
              width: 'min(560px, calc(100vw - 48px))',
              position: 'fixed',
              left: 24,
              top: '50%',
              margin: 0,
              transform: `translateY(-50%) translate(${drag.x}px, ${drag.y}px)`,
              maxHeight: 'calc(100vh - 48px)',
              zIndex: 50,
            }}
            onKeyDown={handleKeyDown}
          >
            <Flex
              justify="between"
              align="start"
              gap="3"
              data-testid="fact-check-drag-handle"
              title="Drag to move"
              onPointerDown={handleDragStart}
              onPointerMove={handleDragMove}
              onPointerUp={handleDragEnd}
              onPointerCancel={handleDragEnd}
              style={{
                cursor: 'move',
                touchAction: 'none',
                userSelect: 'none',
              }}
            >
              <Box>
                <DialogPrimitive.Title asChild>
                  <Heading size="4">Fact Check</Heading>
                </DialogPrimitive.Title>
                <DialogPrimitive.Description asChild>
                  <Text as="p" size="2" color="gray">
                    {sorted.length > 1
                      ? `Statement ${selectedIndex + 1} of ${sorted.length} in this response`
                      : 'Fact-check verdict for this statement'}
                  </Text>
                </DialogPrimitive.Description>
              </Box>
              <Flex align="center" gap="1" style={{ flexShrink: 0 }}>
                <DialogPrimitive.Close asChild>
                  <IconButton
                    size="2"
                    variant="ghost"
                    color="gray"
                    aria-label="Close"
                  >
                    <Cross2Icon />
                  </IconButton>
                </DialogPrimitive.Close>
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
                    {current.review_status === 'confirmed' && (
                      <Badge color="green" variant="solid" size="1">
                        Confirmed by you
                        {current.confirmed_at != null
                          ? ` · ${new Date(current.confirmed_at).toLocaleString(
                              undefined,
                              { dateStyle: 'medium', timeStyle: 'short' }
                            )}`
                          : ''}
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
                          The Fact Check did not attach transcript quotes for
                          this statement.
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
                              item.speaker.trim().toUpperCase() !==
                                'UNKNOWN' && (
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
                      <Text
                        size="1"
                        color="gray"
                        style={{ fontStyle: 'italic' }}
                      >
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
                        <Text weight="medium">
                          {judgeModel || 'Unknown judge'}
                        </Text>
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

            {(sorted.length > 1 ||
              (current !== null &&
                isDismissible(current) &&
                current.review_token != null)) && (
              <Flex justify="between" align="center" mt="4" gap="2" wrap="wrap">
                {/* Per-statement action, pinned left. Hidden for
                    supported/confirmed findings. */}
                {current !== null &&
                isDismissible(current) &&
                current.review_token != null ? (
                  <AppTooltip content="Confirm that this finding is not an issue. Removes its highlight, updates accuracy and issue counts, and keeps this confirmation for future Fact Checks of unchanged content. Other statements are unchanged.">
                    <span style={{ display: 'inline-block' }}>
                      <Button
                        size="2"
                        variant="solid"
                        color="gray"
                        style={{ fontWeight: 'bold' }}
                        disabled={dismissMutation.isPending}
                        onClick={() =>
                          dismissMutation.mutate({
                            statementId: current.id,
                            token: current.review_token as string,
                          })
                        }
                      >
                        {dismissMutation.isPending ? (
                          'Dismissing…'
                        ) : (
                          <>
                            <TrashIcon /> Dismiss
                          </>
                        )}
                      </Button>
                    </span>
                  </AppTooltip>
                ) : (
                  <Box />
                )}
                <Flex direction="column" gap="1" align="end">
                  <Flex gap="2" wrap="wrap" justify="end">
                    {sorted.length > 1 && (
                      <>
                        <Button
                          size="2"
                          variant="soft"
                          color="gray"
                          onClick={goPrev}
                          disabled={dismissMutation.isPending}
                        >
                          <ChevronLeftIcon /> Prev
                        </Button>
                        <Button
                          size="2"
                          variant="soft"
                          color="gray"
                          onClick={goNext}
                          disabled={dismissMutation.isPending}
                        >
                          Next <ChevronRightIcon />
                        </Button>
                      </>
                    )}
                  </Flex>
                  {dismissMutation.isError && (
                    <Text size="1" color="red" role="alert">
                      {mutationErrorMessage(dismissMutation.error)}
                    </Text>
                  )}
                </Flex>
              </Flex>
            )}
          </DialogPrimitive.Content>
        </Theme>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
