// packages/ui/src/components/SessionView/Chat/ChatInput.tsx
import React, { useState, useRef, useEffect } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { UseMutationResult, useQuery } from '@tanstack/react-query';
import {
  StarIcon,
  PaperPlaneIcon,
  Cross2Icon,
  ExclamationTriangleIcon,
  InfoCircledIcon,
  MixerVerticalIcon,
} from '@radix-ui/react-icons';
import {
  TextField,
  Flex,
  Box,
  Text,
  IconButton,
  Spinner,
  Button,
} from '@radix-ui/themes';
import { StarredTemplatesList } from './StarredTemplatesList';
import { AppTooltip } from '../../Shared/AppTooltip';
import {
  currentQueryAtom,
  activeChatIdAtom,
  activeSessionIdAtom,
} from '../../../store';
import type { LlmStatus, UIContextUsageResponse } from '../../../types';
import { fetchLlmStatus } from '../../../api/api';
import { SelectActiveModelModal } from '../Modals/SelectActiveModelModal';
import {
  fetchSessionContextUsage,
  fetchStandaloneContextUsage,
} from '../../../api/chat';
import { useLlmModelState } from '../../../hooks/useLlmModelState';

interface AddMessageStreamMutationResult {
  userMessageId: number;
  stream: ReadableStream<Uint8Array>;
}

interface ChatInputProps {
  isStandalone: boolean;
  disabled?: boolean;
  isAiResponding: boolean;
  onCancelStream: () => void;
  addMessageMutation: UseMutationResult<
    AddMessageStreamMutationResult,
    Error,
    { text: string; tempAiMessageId: number },
    any
  >;
  transcriptTokenCount?: number | null; // <-- ADDED PROP
}

export function ChatInput({
  isStandalone,
  disabled = false,
  isAiResponding,
  onCancelStream,
  addMessageMutation,
  transcriptTokenCount, // <-- DESTRUCTURED PROP
}: ChatInputProps) {
  const [currentQuery, setCurrentQuery] = useAtom(currentQueryAtom);
  const activeChatId = useAtomValue(activeChatIdAtom);
  const activeSessionId = useAtomValue(activeSessionIdAtom);
  const [inputError, setInputError] = useState('');

  const inputRef = useRef<HTMLInputElement>(null);
  const [showTemplates, setShowTemplates] = useState(false);

  const [isSelectModelModalOpen, setIsSelectModelModalOpen] = useState(false);

  const { data: llmStatus, isLoading: isLoadingLlmStatusForInput } = useQuery<
    LlmStatus,
    Error
  >({
    queryKey: ['llmStatus'],
    queryFn: () => fetchLlmStatus(),
    staleTime: 5000,
    refetchOnWindowFocus: true,
    enabled: !disabled,
  });

  const {
    hasActiveModel,
    isModelReady,
    isModelLoading,
    loadFailed,
    loadError,
    isServerUnreachable,
    modelMismatch,
    isSettledNotLoaded,
  } = useLlmModelState(llmStatus);

  const isEffectivelyDisabled =
    disabled || isAiResponding || !activeChatId || isSelectModelModalOpen;

  // Until the model is ready, the input row is replaced by a state panel
  // (status + action). The input fades back in once loading completes.
  const showStatePanel =
    !disabled &&
    !isAiResponding &&
    activeChatId !== null &&
    (!llmStatus || !isModelReady);

  useEffect(() => {
    if (activeChatId !== null && !isEffectivelyDisabled && isModelReady) {
      inputRef.current?.focus();
    }
  }, [activeChatId, isEffectivelyDisabled, isModelReady]);

  useEffect(() => {
    if ((inputError || addMessageMutation.isError) && currentQuery !== '') {
      setInputError('');
      if (addMessageMutation.isError) addMessageMutation.reset();
    }
  }, [currentQuery, inputError, addMessageMutation]);

  const handleSelectTemplate = (text: string) => {
    setCurrentQuery((prev) => (prev ? `${prev} ${text}` : text));
    setShowTemplates(false);
    if (!isEffectivelyDisabled && inputRef.current) {
      inputRef.current.focus();
    }
  };

  const trySubmit = async () => {
    if (isEffectivelyDisabled) return false;
    if (!currentQuery.trim()) {
      setInputError('Cannot send an empty message.');
      return false;
    }
    if (activeChatId === null) {
      setInputError('Please select a chat first.');
      return false;
    }
    // Defensive: the input only renders when the model is ready (the
    // state panel replaces it otherwise), but guard the race anyway.
    if (!isModelReady) return false;

    setInputError('');
    addMessageMutation.mutate({
      text: currentQuery,
      tempAiMessageId: -Math.floor(Math.random() * 1000000),
    });
    return true;
  };

  const handleModelSuccessfullySet = () => {
    setIsSelectModelModalOpen(false);
    // The status poll picks up the load from here: loading panel first,
    // then the input fades back in once the model is ready.
    console.log(
      '[ChatInput] Model selection/setting process initiated from modal. Waiting for load confirmation.'
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      trySubmit();
    }
  };

  const handleSubmitClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    trySubmit();
  };

  const handleCancelStreamClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    onCancelStream();
  };

  const showCancelButton = isAiResponding && !disabled;
  const sendButtonDisabled = isEffectivelyDisabled || !currentQuery.trim();
  const starredButtonDisabled = isEffectivelyDisabled;
  const inputFieldDisabled = isEffectivelyDisabled;

  const placeholderText = isStandalone
    ? 'Ask anything...'
    : 'Ask about the session...';

  // --- Live Context Usage Preview (debounced) ---
  const [debouncedInput, setDebouncedInput] = useState<string>('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedInput(currentQuery), 350);
    return () => clearTimeout(t);
  }, [currentQuery]);

  const hasInput = !!debouncedInput.trim();
  const canPreview =
    !!activeChatId &&
    !isEffectivelyDisabled &&
    hasInput &&
    (isStandalone || !!activeSessionId);

  const { data: previewUsage } = useQuery<
    UIContextUsageResponse | undefined,
    Error
  >({
    queryKey: [
      'contextUsagePreview',
      isStandalone ? 'standalone' : 'session',
      activeSessionId ?? 'no-session',
      activeChatId ?? 'no-chat',
      debouncedInput,
    ],
    queryFn: () =>
      isStandalone
        ? fetchStandaloneContextUsage(activeChatId!, {
            inputDraft: debouncedInput,
          })
        : fetchSessionContextUsage(activeSessionId!, activeChatId!, {
            inputDraft: debouncedInput,
          }),
    enabled: canPreview,
    staleTime: 5 * 1000,
  });

  const previewPercent =
    previewUsage?.totals.percentUsed != null
      ? Math.round(previewUsage.totals.percentUsed * 100)
      : null;
  const willOverflow = (() => {
    if (!previewUsage) return false;
    const eff = previewUsage.model.effectiveContextSize ?? null;
    const prompt = previewUsage.totals.promptTokens ?? null;
    if (eff == null || prompt == null) return false;
    const predicted = prompt + previewUsage.reserved.outputTokens;
    return predicted > eff;
  })();
  const warnAtPct = previewUsage?.thresholds
    ? previewUsage.thresholds.warnAt * 100
    : null;
  const dangerAtPct = previewUsage?.thresholds
    ? previewUsage.thresholds.dangerAt * 100
    : null;
  const isWarn =
    previewPercent != null && warnAtPct != null
      ? previewPercent >= warnAtPct && previewPercent < (dangerAtPct ?? 101)
      : false;
  const isDanger =
    previewPercent != null && dangerAtPct != null
      ? previewPercent >= dangerAtPct
      : false;
  const shouldShowPreviewHint = willOverflow || isWarn || isDanger;

  const openModelPicker = () => setIsSelectModelModalOpen(true);

  const renderStatePanel = () => {
    let title: string | null;
    let detail: string | null = null;
    // Every action opens the same model picker, so every button shares
    // the header's "Configure AI Model" verbiage and mixer icon.
    let showAction = false;
    let icon: React.ReactNode = null;

    if (!llmStatus || isLoadingLlmStatusForInput) {
      title = 'Checking model status…';
      icon = <Spinner size="2" />;
    } else if (isModelLoading) {
      title = 'Loading model…';
      detail =
        'First load can take a minute — the input appears when it’s ready.';
      icon = <Spinner size="2" />;
    } else if (!hasActiveModel) {
      title = 'No model selected';
      detail = 'Pick a model to start chatting.';
      icon = <InfoCircledIcon width="18" height="18" color="gray" />;
      showAction = true;
    } else if (loadFailed) {
      title = 'Model failed to load';
      detail = loadError ?? 'Unknown error.';
      icon = (
        <ExclamationTriangleIcon
          width="18"
          height="18"
          className="text-red-600"
        />
      );
      showAction = true;
    } else if (isServerUnreachable) {
      title = 'LLM server unreachable';
      detail = llmStatus.isRemoteBaseUrl
        ? 'Check that the remote server is running and the URL is correct.'
        : 'Check that LM Studio is running.';
      icon = (
        <ExclamationTriangleIcon
          width="18"
          height="18"
          className="text-red-600"
        />
      );
      showAction = true;
    } else if (modelMismatch) {
      title = 'Wrong model loaded';
      detail = 'The server is running a different model.';
      icon = <InfoCircledIcon width="18" height="18" color="gray" />;
      showAction = true;
    } else if (isSettledNotLoaded) {
      // The state is obvious — just offer the action.
      title = null;
      showAction = true;
    } else {
      return null;
    }

    return (
      <Box
        data-testid="model-state-panel"
        px="4"
        py="4"
        style={{
          border: '1px dashed var(--gray-a6)',
          borderRadius: 'var(--radius-3)',
          backgroundColor: 'var(--gray-a2)',
        }}
      >
        <Flex direction="column" align="center" gap="2">
          {title && (
            <Flex align="center" gap="2">
              {icon}
              <Text size="3" weight="medium" align="center">
                {title}
              </Text>
            </Flex>
          )}
          {detail && (
            <Text size="2" color="gray" align="center">
              {detail}
            </Text>
          )}
          {showAction && (
            <Button size="2" variant="solid" onClick={openModelPicker}>
              <MixerVerticalIcon width="14" height="14" />
              Configure AI Model
            </Button>
          )}
        </Flex>
      </Box>
    );
  };

  const statePanel = showStatePanel ? renderStatePanel() : null;

  return (
    <>
      <Flex direction="column" gap="1">
        {statePanel ?? (
          <Flex
            align="start"
            gap="2"
            width="100%"
            className="chat-input-fade-in"
            data-testid="chat-input-row"
          >
            <Box position="relative" flexShrink="0">
              <AppTooltip content="Show Templates">
                <IconButton
                  type="button"
                  variant="soft"
                  size="2"
                  onClick={() => setShowTemplates((prev) => !prev)}
                  aria-label="Show templates"
                  disabled={starredButtonDisabled}
                >
                  <StarIcon width={16} height={16} />
                </IconButton>
              </AppTooltip>
              {showTemplates && (
                <StarredTemplatesList
                  onSelectTemplate={handleSelectTemplate}
                  onClose={() => setShowTemplates(false)}
                />
              )}
            </Box>
            <TextField.Root
              ref={inputRef}
              size="2"
              data-testid="chat-input"
              style={{ flexGrow: 1 }}
              placeholder={
                isAiResponding
                  ? 'AI is responding...'
                  : !activeChatId
                    ? 'Start or select a chat first…'
                    : disabled
                      ? 'Loading…'
                      : placeholderText
              }
              value={currentQuery}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setCurrentQuery(e.target.value)
              }
              disabled={inputFieldDisabled}
              aria-label="Chat input message"
              onKeyDown={handleKeyDown}
            />
            {showCancelButton ? (
              <AppTooltip content="Cancel response">
                <IconButton
                  type="button"
                  color="red"
                  variant="solid"
                  size="2"
                  onClick={handleCancelStreamClick}
                  aria-label="Cancel AI response"
                  disabled={!isAiResponding}
                >
                  <Cross2Icon />
                </IconButton>
              </AppTooltip>
            ) : (
              <AppTooltip
                content={
                  isAiResponding ? 'AI is responding...' : 'Send message'
                }
              >
                <IconButton
                  type="button"
                  variant="solid"
                  size="2"
                  onClick={handleSubmitClick}
                  disabled={sendButtonDisabled}
                  aria-label={
                    isAiResponding ? 'AI is responding' : 'Send message'
                  }
                >
                  {isAiResponding ? <Spinner size="1" /> : <PaperPlaneIcon />}
                </IconButton>
              </AppTooltip>
            )}
          </Flex>
        )}
        {inputError && (
          <Text size="1" color="red" align="center" mt="1">
            {inputError}
          </Text>
        )}
        {addMessageMutation.isError && (
          <Text size="1" color="red" align="center" mt="1">
            Error: {addMessageMutation.error.message}
          </Text>
        )}

        {/* Live usage preview hint: show only when useful (warn/danger/overflow) */}
        {previewUsage && shouldShowPreviewHint && !willOverflow && (
          <Text size="1" color={isDanger ? 'red' : 'amber'}>
            {`Approaching limit — context used ~${previewPercent}%`}
          </Text>
        )}
      </Flex>

      <SelectActiveModelModal
        isOpen={isSelectModelModalOpen}
        onOpenChange={setIsSelectModelModalOpen}
        onModelSuccessfullySet={handleModelSuccessfullySet}
        currentActiveModelName={llmStatus?.activeModel}
        currentConfiguredContextSize={llmStatus?.configuredContextSize}
        activeTranscriptTokens={transcriptTokenCount}
        llmStatus={llmStatus}
      />
    </>
  );
}
