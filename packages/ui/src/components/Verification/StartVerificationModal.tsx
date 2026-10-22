// packages/ui/src/components/Verification/StartVerificationModal.tsx
//
// Launch dialog for a fact-verification audit: scope selector (all
// unverified / selected transcripts / full re-audit), hide-verified toggle,
// skip-checked switch, and Judge LLM configuration.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useSetAtom } from 'jotai';
import {
  Dialog,
  Button,
  Flex,
  Text,
  Box,
  Spinner,
  Callout,
  ScrollArea,
  Checkbox,
  Switch,
  Badge,
  RadioGroup,
} from '@radix-ui/themes';
import {
  InfoCircledIcon,
  Cross2Icon,
  QuestionMarkCircledIcon,
} from '@radix-ui/react-icons';
import { ShieldCheck } from 'lucide-react';
import {
  createVerificationJob,
  fetchLlmStatus,
  setLlmApiToken,
  type SessionVerificationSummary,
  type VerificationJobScope,
} from '../../api/api';
import type { LlmStatus } from '../../types';
import { toastMessageAtom, remoteBaseUrlAtom } from '../../store';
import { formatIsoDateToYMD } from '../../helpers';
import { AppTooltip } from '../Shared/AppTooltip';
import {
  LlmSettingsForm,
  type LlmSettingsState,
} from '../Shared/LlmSettingsForm';

interface StartVerificationModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  sessionsSummary: SessionVerificationSummary[];
  initialScope?: VerificationJobScope;
  initialSessionIds?: number[];
  onJobCreated: (jobId: number) => void;
}

type ModalScope = 'all_unverified' | 'all_force' | 'selected_sessions';

// Judge LLM defaults: deterministic sampling plus a bounded thinking budget
// so reasoning models cannot burn the whole completion allowance inside
// `<think>` (unrestricted `-1` caused 85s/msg latency and truncated JSON).
const JUDGE_DEFAULT_TEMPERATURE = 0.3;
const JUDGE_DEFAULT_THINKING_BUDGET = 1024;

/**
 * Parse a session `date` into epoch milliseconds.
 *
 * Returns `null` for missing, non-string, or unparseable values so the
 * comparator can sort those sessions last instead of comparing NaN.
 */
function verificationDateMs(date: unknown): number | null {
  if (typeof date !== 'string' || date.length === 0) return null;
  const ms = Date.parse(date);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Newest-first ordering for the transcript picker: valid dates descend,
 * missing/invalid dates sort last, and ties (including equal dates)
 * break deterministically on descending `sessionId`.
 */
export function compareVerificationSessionsNewestFirst(
  a: SessionVerificationSummary,
  b: SessionVerificationSummary
): number {
  const aMs = verificationDateMs(a.date);
  const bMs = verificationDateMs(b.date);
  if (aMs !== null && bMs !== null && aMs !== bMs) return bMs - aMs;
  if (aMs !== null && bMs === null) return -1;
  if (aMs === null && bMs !== null) return 1;
  return b.sessionId - a.sessionId;
}

/**
 * Return a new array sorted newest-first. Never mutates the input (the
 * caller passes the `sessionsSummary` prop straight in).
 */
export function sortVerificationSessionsNewestFirst(
  sessions: SessionVerificationSummary[]
): SessionVerificationSummary[] {
  return [...sessions].sort(compareVerificationSessionsNewestFirst);
}

const SCOPE_OPTIONS: {
  value: ModalScope;
  title: string;
  description: string;
}[] = [
  {
    value: 'all_unverified',
    title: 'All Unverified Chats (Newest First)',
    description:
      'Audit every AI response that has not been checked yet, newest first.',
  },
  {
    value: 'selected_sessions',
    title: 'Select Specific Transcripts',
    description: 'Pick which session transcripts to audit or re-audit.',
  },
  {
    value: 'all_force',
    title: 'Re-audit Everything',
    description:
      'Re-check all AI responses, including already-verified ones — useful after switching to a stronger Judge model.',
  },
];

export function StartVerificationModal({
  isOpen,
  onOpenChange,
  sessionsSummary,
  initialScope,
  initialSessionIds,
  onJobCreated,
}: StartVerificationModalProps) {
  const setToast = useSetAtom(toastMessageAtom);
  const setPersistedRemoteUrl = useSetAtom(remoteBaseUrlAtom);
  const [scope, setScope] = useState<ModalScope>('all_unverified');
  const [selectedSessionIds, setSelectedSessionIds] = useState<number[]>([]);
  const [hideVerified, setHideVerified] = useState(true);
  const [skipVerified, setSkipVerified] = useState(true);
  const [validationError, setValidationError] = useState<string | null>(null);

  const [formState, setFormState] = useState<LlmSettingsState>({
    selectedModel: '',
    contextSizeInput: '',
    isRemote: false,
    remoteUrl: '',
    apiToken: '',
    temperature: JUDGE_DEFAULT_TEMPERATURE,
    topP: 0.9,
    repeatPenalty: 1.1,
    numGpuLayers: undefined,
    thinkingBudget: JUDGE_DEFAULT_THINKING_BUDGET,
  });

  const { data: llmStatus } = useQuery<LlmStatus, Error>({
    queryKey: ['llmStatus'],
    queryFn: () => fetchLlmStatus(),
    enabled: isOpen,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  // Snapshot backend state once per open-cycle (mirrors
  // CreateAnalysisJobModal): reset ephemeral fields, pre-select sessions
  // when launched from the coverage tab, and seed the Judge LLM form.
  const prevIsOpenRef = useRef(false);
  useEffect(() => {
    if (!isOpen) {
      prevIsOpenRef.current = false;
      return;
    }
    if (prevIsOpenRef.current) return;
    if (!llmStatus) return;
    prevIsOpenRef.current = true;

    setScope(
      initialScope === 'selected_sessions' || initialScope === 'all_force'
        ? initialScope
        : 'all_unverified'
    );
    setSelectedSessionIds(initialSessionIds ?? []);
    setHideVerified(true);
    setSkipVerified(initialScope === 'all_force' ? false : true);
    setValidationError(null);

    setFormState({
      selectedModel:
        llmStatus.activeModel && llmStatus.activeModel !== 'default'
          ? llmStatus.activeModel
          : '',
      contextSizeInput: llmStatus.configuredContextSize
        ? String(llmStatus.configuredContextSize)
        : '',
      isRemote: llmStatus.isRemoteBaseUrl ?? false,
      remoteUrl:
        (llmStatus.isRemoteBaseUrl ? llmStatus.activeBaseUrl : '') ?? '',
      apiToken: '',
      temperature: JUDGE_DEFAULT_TEMPERATURE,
      topP: llmStatus.configuredTopP ?? 0.9,
      repeatPenalty: llmStatus.configuredRepeatPenalty ?? 1.1,
      numGpuLayers:
        llmStatus.configuredNumGpuLayers != null
          ? llmStatus.configuredNumGpuLayers
          : undefined,
      thinkingBudget:
        llmStatus.configuredThinkingBudget == null ||
        llmStatus.configuredThinkingBudget < 0
          ? JUDGE_DEFAULT_THINKING_BUDGET
          : llmStatus.configuredThinkingBudget,
    });
  }, [isOpen, llmStatus, initialScope, initialSessionIds]);

  const visibleSessions = useMemo(() => {
    // Newest-first in both filter states; the hide-verified toggle only
    // removes fully-verified rows without reordering the rest. Selection
    // is tracked separately by session id, so it survives filtering.
    const sorted = sortVerificationSessionsNewestFirst(sessionsSummary);
    return hideVerified ? sorted.filter((s) => !s.isFullyVerified) : sorted;
  }, [sessionsSummary, hideVerified]);

  const toggleSession = (sessionId: number, checked: boolean) => {
    setSelectedSessionIds((prev) =>
      checked ? [...prev, sessionId] : prev.filter((id) => id !== sessionId)
    );
  };

  const createJobMutation = useMutation({
    mutationFn: createVerificationJob,
    onSuccess: (data) => {
      setToast('Verification audit started — auditing newest first.');
      onOpenChange(false);
      onJobCreated(data.jobId);
    },
    onError: (error: Error) => {
      setValidationError(`Failed to start audit: ${error.message}`);
    },
  });

  const handleScopeChange = (value: string) => {
    const next = value as ModalScope;
    setScope(next);
    // A full re-audit implies skipVerified=false; the other scopes
    // default back to skipping already-checked messages.
    setSkipVerified(next !== 'all_force');
  };

  const isValidHttpUrl = (value: string): boolean => {
    try {
      const parsed = new URL(value.trim());
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  };

  const handleSubmit = () => {
    setValidationError(null);
    if (scope === 'selected_sessions' && selectedSessionIds.length === 0) {
      setValidationError('Please select at least one transcript to audit.');
      return;
    }
    if (!formState.selectedModel) {
      setValidationError('Please select a Judge model.');
      return;
    }

    let baseUrl: string | undefined;
    if (formState.isRemote) {
      const trimmed = formState.remoteUrl.trim();
      if (!isValidHttpUrl(trimmed)) {
        setValidationError(
          'Please enter a valid http(s) URL for the remote LM Studio server.'
        );
        return;
      }
      baseUrl = trimmed;
    } else if (llmStatus?.defaultBaseUrl) {
      baseUrl = llmStatus.defaultBaseUrl;
    }

    setPersistedRemoteUrl(formState.remoteUrl.trim());

    const contextSize = formState.contextSizeInput
      ? parseInt(formState.contextSizeInput, 10)
      : null;
    if (
      formState.contextSizeInput &&
      (isNaN(contextSize!) || contextSize! <= 0)
    ) {
      setValidationError('Context size must be a positive number if provided.');
      return;
    }

    // Token semantics mirror CreateAnalysisJobModal: a non-empty typed
    // value replaces the saved token (fire-and-forget); an empty field
    // preserves whatever is configured.
    const trimmedToken = formState.apiToken.trim();
    if (trimmedToken.length > 0) {
      setLlmApiToken(trimmedToken).catch((err) => {
        console.warn(
          'Failed to set remote LLM API token:',
          err?.message ?? err
        );
      });
    }

    createJobMutation.mutate({
      scope,
      ...(scope === 'selected_sessions'
        ? { sessionIds: selectedSessionIds }
        : {}),
      skipVerified: scope === 'all_force' ? false : skipVerified,
      modelName: formState.selectedModel,
      ...(contextSize ? { contextSize } : {}),
      ...(baseUrl ? { baseUrl } : {}),
      temperature: formState.temperature,
      topP: formState.topP,
      repeatPenalty: formState.repeatPenalty,
      numGpuLayers: formState.numGpuLayers ?? null,
      thinkingBudget: formState.thinkingBudget,
    });
  };

  const isMutationPending = createJobMutation.isPending;

  return (
    <Dialog.Root open={isOpen} onOpenChange={onOpenChange}>
      <Dialog.Content style={{ maxWidth: 640 }}>
        <Dialog.Title>
          <Flex align="center" gap="2">
            <ShieldCheck size={18} />
            Run Verification Audit
          </Flex>
        </Dialog.Title>
        <Dialog.Description size="2" mb="4">
          The Judge LLM extracts every factual claim from AI responses and
          checks it against the session transcript — newest first.
        </Dialog.Description>

        <Flex direction="column" gap="4">
          <Box>
            <Text as="div" size="2" mb="2" weight="medium">
              Audit Scope
            </Text>
            <RadioGroup.Root value={scope} onValueChange={handleScopeChange}>
              <Flex direction="column" gap="2">
                {SCOPE_OPTIONS.map((option) => (
                  <Text
                    as="label"
                    size="2"
                    key={option.value}
                    style={{
                      border: '1px solid var(--gray-a5)',
                      borderRadius: 'var(--radius-3)',
                      padding: '10px 12px',
                      cursor: 'pointer',
                      backgroundColor:
                        scope === option.value ? 'var(--accent-a2)' : undefined,
                    }}
                  >
                    <Flex gap="2" align="start">
                      <RadioGroup.Item
                        value={option.value}
                        style={{ marginTop: '2px' }}
                      />
                      <Box>
                        <Text size="2" weight="medium">
                          {option.title}
                        </Text>
                        <Text size="1" color="gray" as="p">
                          {option.description}
                        </Text>
                      </Box>
                    </Flex>
                  </Text>
                ))}
              </Flex>
            </RadioGroup.Root>
          </Box>

          {scope === 'selected_sessions' && (
            <Box>
              <Flex align="center" justify="between" mb="2">
                <Text size="2" weight="medium">
                  Transcripts ({selectedSessionIds.length} selected)
                </Text>
                <Text as="label" size="1" color="gray">
                  <Flex gap="2" align="center">
                    <Switch
                      size="1"
                      checked={hideVerified}
                      onCheckedChange={setHideVerified}
                    />
                    Hide already-verified transcripts
                  </Flex>
                </Text>
              </Flex>
              <ScrollArea
                type="auto"
                scrollbars="vertical"
                style={{
                  maxHeight: '180px',
                  border: '1px solid var(--gray-a5)',
                  borderRadius: 'var(--radius-3)',
                }}
              >
                {visibleSessions.length === 0 ? (
                  <Flex align="center" justify="center" p="4">
                    <Text size="2" color="gray">
                      {sessionsSummary.length === 0
                        ? 'No completed sessions with AI responses yet.'
                        : 'Every transcript is fully verified. Turn off the filter to re-audit.'}
                    </Text>
                  </Flex>
                ) : (
                  <Box p="1">
                    {visibleSessions.map((session) => (
                      <Text
                        as="label"
                        size="2"
                        key={session.sessionId}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '6px 8px',
                          borderRadius: 'var(--radius-2)',
                          cursor: 'pointer',
                        }}
                      >
                        <Checkbox
                          checked={selectedSessionIds.includes(
                            session.sessionId
                          )}
                          onCheckedChange={(checked) =>
                            toggleSession(session.sessionId, checked as boolean)
                          }
                          disabled={isMutationPending}
                          className="cursor-pointer"
                        />
                        <Box style={{ flex: 1, minWidth: 0 }}>
                          <Text size="2" truncate>
                            {session.sessionName}
                          </Text>
                          <Text size="1" color="gray" as="p">
                            {session.clientName} ·{' '}
                            {formatIsoDateToYMD(session.date)}
                          </Text>
                        </Box>
                        {session.isFullyVerified ? (
                          <Badge color="green" variant="soft" size="1">
                            Verified ({session.verifiedAiMessages}/
                            {session.totalAiMessages} msgs)
                          </Badge>
                        ) : session.verifiedAiMessages > 0 ? (
                          <Badge color="amber" variant="soft" size="1">
                            Partial ({session.verifiedAiMessages}/
                            {session.totalAiMessages} msgs)
                          </Badge>
                        ) : (
                          <Badge color="gray" variant="soft" size="1">
                            Unverified ({session.totalAiMessages} msgs)
                          </Badge>
                        )}
                      </Text>
                    ))}
                  </Box>
                )}
              </ScrollArea>
            </Box>
          )}

          <Text as="label" size="2">
            <Flex gap="2" align="center">
              <Switch
                checked={scope === 'all_force' ? false : skipVerified}
                onCheckedChange={(checked) =>
                  setSkipVerified(checked as boolean)
                }
                disabled={isMutationPending || scope === 'all_force'}
              />
              Skip transcripts & messages that have already been verified
              <AppTooltip content="When on, the audit skips AI responses that already have a completed verification. Turn off (or choose Re-audit Everything) to re-check everything with the selected Judge model.">
                <span style={{ display: 'inline-flex' }}>
                  <QuestionMarkCircledIcon className="text-[--gray-a10]" />
                </span>
              </AppTooltip>
            </Flex>
          </Text>

          <Flex direction="column" gap="3">
            <Text as="div" size="2" weight="medium">
              Judge LLM Configuration
            </Text>
            <LlmSettingsForm
              llmStatus={llmStatus}
              state={formState}
              onChange={setFormState}
              isOpen={isOpen}
              isSaving={isMutationPending}
            />
            <Flex gap="1" align="center">
              <QuestionMarkCircledIcon
                className="text-[--gray-a10]"
                width={14}
                height={14}
              />
              <Text size="1" color="gray">
                A larger reasoning model makes a stricter, more reliable Judge.
              </Text>
            </Flex>
          </Flex>

          {(validationError || createJobMutation.isError) && (
            <Callout.Root color="red" role="alert" size="1">
              <Callout.Icon>
                <InfoCircledIcon />
              </Callout.Icon>
              <Callout.Text>
                {validationError || createJobMutation.error?.message}
              </Callout.Text>
            </Callout.Root>
          )}
        </Flex>

        <Flex gap="3" mt="4" justify="end">
          <Dialog.Close>
            <Button
              variant="soft"
              color="gray"
              disabled={isMutationPending}
              className="hover:bg-[var(--gray-a5)] transition-colors"
            >
              <Cross2Icon /> Cancel
            </Button>
          </Dialog.Close>
          <Button
            onClick={handleSubmit}
            disabled={isMutationPending || !formState.selectedModel}
            className="hover:brightness-110 transition-all"
          >
            {isMutationPending ? (
              <>
                <Spinner size="2" />
                <Text ml="2">Starting…</Text>
              </>
            ) : (
              <>
                <ShieldCheck size={15} /> Start Audit
              </>
            )}
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
