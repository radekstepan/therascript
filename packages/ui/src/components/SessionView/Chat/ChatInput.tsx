// packages/ui/src/components/SessionView/Chat/ChatInput.tsx
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import {
  UseMutationResult,
  useQuery,
  useQueryClient,
  useMutation,
} from '@tanstack/react-query';
import {
  StarIcon,
  PaperPlaneIcon,
  StopIcon,
  // ReloadIcon, // No longer needed for inline prompt
  // ExclamationTriangleIcon, // No longer needed for inline prompt
  InfoCircledIcon,
} from '@radix-ui/react-icons';
import {
  TextField,
  Flex,
  Box,
  Text,
  IconButton,
  Spinner,
  // Button, // No longer needed for inline prompt
  // Callout, // No longer needed for inline prompt
} from '@radix-ui/themes';
import { StarredTemplatesList } from './StarredTemplatesList';
import {
  currentQueryAtom,
  activeChatIdAtom,
  activeSessionIdAtom,
  toastMessageAtom,
} from '../../../store';
import type {
  ChatMessage,
  LlmStatus,
  UIContextUsageResponse,
} from '../../../types';
import { fetchLlmStatus, setLlmModel } from '../../../api/api';
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
  const setToastMessageAtom = useSetAtom(toastMessageAtom);
  const queryClient = useQueryClient();

  const inputRef = useRef<HTMLInputElement>(null);
  const [showTemplates, setShowTemplates] = useState(false);

  const [isSelectModelModalOpen, setIsSelectModelModalOpen] = useState(false);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  // Remove state related to inline prompt and inline loading
  // const [showInlineLoadPrompt, setShowInlineLoadPrompt] = useState(false);
  // const [isInlineLoadingModel, setIsInlineLoadingModel] = useState(false);

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

  const { isModelReady, isModelLoading } = useLlmModelState(llmStatus);

  // No longer need setModelAndLoadMutation as SelectActiveModelModal handles setting/loading
  // const setModelAndLoadMutation = useMutation(...);

  const isEffectivelyDisabled =
    disabled ||
    isAiResponding ||
    !activeChatId ||
    isSelectModelModalOpen ||
    isLoadingLlmStatusForInput ||
    !isModelReady;

  useEffect(() => {
    if (activeChatId !== null && !isEffectivelyDisabled) {
      inputRef.current?.focus();
    }
  }, [activeChatId, isEffectivelyDisabled]);

  useEffect(() => {
    if ((inputError || addMessageMutation.isError) && currentQuery !== '') {
      setInputError('');
      if (addMessageMutation.isError) addMessageMutation.reset();
    }
  }, [currentQuery, inputError, addMessageMutation]);

  // Effect to send pending message after model is confirmed loaded via llmStatus
  // This is now primarily triggered after SelectActiveModelModal succeeds
  useEffect(() => {
    if (
      pendingMessage &&
      llmStatus?.activeModel &&
      llmStatus.modelChecked === llmStatus.activeModel &&
      llmStatus.loaded
    ) {
      console.log(
        '[ChatInput] Model confirmed loaded. Sending pending message:',
        pendingMessage
      );
      addMessageMutation.mutate({
        text: pendingMessage,
        tempAiMessageId: -Math.floor(Math.random() * 1000000),
      });
      setPendingMessage(null);
    }
  }, [llmStatus, pendingMessage, addMessageMutation]);

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

    setInputError('');
    const queryToSend = currentQuery;

    if (!llmStatus) {
      setToastMessageAtom('Waiting for AI model status...');
      queryClient.refetchQueries({ queryKey: ['llmStatus'] });
      return false;
    }

    // Defensive: if the model is still loading (button should already be
    // disabled, but guard against race conditions), surface a toast and
    // do NOT open the modal — the user already initiated the load.
    if (isModelLoading) {
      setToastMessageAtom('Model is still loading, please wait…');
      return false;
    }

    const { activeModel: currentActiveModel } = llmStatus;

    if (!currentActiveModel || currentActiveModel === 'default') {
      // No active model configured. Open the SelectActiveModelModal so the
      // user can pick + load one; queue the current message.
      console.log(
        `[ChatInput] No active model. Opening SelectActiveModelModal.`
      );
      setPendingMessage(queryToSend);
      setIsSelectModelModalOpen(true);
      return false;
    }

    // Model is active and loaded — send.
    addMessageMutation.mutate({
      text: queryToSend,
      tempAiMessageId: -Math.floor(Math.random() * 1000000),
    });
    return true;
  };

  const handleModelSuccessfullySet = () => {
    setIsSelectModelModalOpen(false);
    // The useEffect watching llmStatus and pendingMessage will now handle sending
    // once the status updates to reflect the model is loaded.
    // We don't immediately send here, we wait for confirmation of load.
    console.log(
      '[ChatInput] Model selection/setting process initiated from modal. Waiting for load confirmation.'
    );
    // If `pendingMessage` is still set, the useEffect will pick it up.
  };

  // handleInlineLoadAndSend and handleCancelInlineLoad are removed

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

  const showCancelButton = isAiResponding && !disabled; // Removed isInlineLoadingModel check
  const sendButtonDisabled = isEffectivelyDisabled || !currentQuery.trim();
  const starredButtonDisabled = isEffectivelyDisabled;
  const inputFieldDisabled = isEffectivelyDisabled;

  const placeholderText = isModelLoading
    ? 'Model is loading, please wait…'
    : isStandalone
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

  return (
    <>
      <Flex direction="column" gap="1">
        {/* Inline prompt and loading state elements removed */}

        <Flex align="start" gap="2" width="100%">
          <Box position="relative" flexShrink="0">
            <IconButton
              type="button"
              variant="soft"
              size="2"
              title="Show Templates"
              onClick={() => setShowTemplates((prev) => !prev)}
              aria-label="Show templates"
              disabled={starredButtonDisabled}
            >
              <StarIcon width={16} height={16} />
            </IconButton>
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
            style={{ flexGrow: 1 }}
            placeholder={
              isAiResponding ? 'AI is responding...' : placeholderText
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
            <IconButton
              type="button"
              color="red"
              variant="solid"
              size="2"
              onClick={handleCancelStreamClick}
              title="Cancel response"
              aria-label="Cancel AI response"
              // disabled={!isAiResponding || isInlineLoadingModel} // Removed isInlineLoadingModel
              disabled={!isAiResponding}
            >
              <StopIcon />
            </IconButton>
          ) : (
            <IconButton
              type="button"
              variant="solid"
              size="2"
              onClick={handleSubmitClick}
              disabled={sendButtonDisabled}
              title={
                isModelLoading
                  ? 'Model is loading…'
                  : isAiResponding
                    ? 'AI is responding...'
                    : 'Send message'
              }
              aria-label={
                isModelLoading
                  ? 'Model is loading'
                  : isAiResponding
                    ? 'AI is responding'
                    : 'Send message'
              }
            >
              {isAiResponding || isModelLoading ? (
                <Spinner size="1" />
              ) : (
                <PaperPlaneIcon />
              )}
            </IconButton>
          )}
        </Flex>
        {isModelLoading && (
          <Flex align="center" justify="center" gap="1" mt="1">
            <Spinner size="1" />
            <Text size="1" color="gray">
              {`Loading model${llmStatus?.activeModel && llmStatus.activeModel !== 'default' ? `: ${llmStatus.activeModel}` : ''}…`}
            </Text>
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
