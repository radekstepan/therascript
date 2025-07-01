// packages/ui/src/components/SessionView/Chat/ChatInput.tsx
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import {
  UseMutationResult,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { StarIcon, PaperPlaneIcon, StopIcon } from '@radix-ui/react-icons';
import {
  TextField,
  Flex,
  Box,
  Text,
  IconButton,
  Spinner,
} from '@radix-ui/themes';
import { StarredTemplatesList } from './StarredTemplatesList';
import {
  currentQueryAtom,
  activeChatIdAtom,
  toastMessageAtom,
} from '../../../store';
import type { ChatMessage, OllamaStatus } from '../../../types';
import { fetchVllmStatus } from '../../../api/vllm';
import { SelectActiveModelModal } from '../Modals/SelectActiveModelModal';

interface AddMessageStreamMutationResult {
  userMessageId: number;
  stream: ReadableStream<Uint8Array>;
}

interface ChatInputProps {
  isStandalone: boolean;
  disabled?: boolean;
  addMessageMutation: UseMutationResult<
    AddMessageStreamMutationResult,
    Error,
    string,
    unknown
  >;
  transcriptTokenCount?: number | null;
}

export function ChatInput({
  isStandalone,
  disabled = false,
  addMessageMutation,
  transcriptTokenCount,
}: ChatInputProps) {
  const [currentQuery, setCurrentQuery] = useAtom(currentQueryAtom);
  const activeChatId = useAtomValue(activeChatIdAtom);
  const [inputError, setInputError] = useState('');
  const setToastMessageAtom = useSetAtom(toastMessageAtom);
  const queryClient = useQueryClient();

  const inputRef = useRef<HTMLInputElement>(null);
  const [showTemplates, setShowTemplates] = useState(false);

  const [isSelectModelModalOpen, setIsSelectModelModalOpen] = useState(false);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);

  const { data: ollamaStatus, isLoading: isLoadingOllamaStatusForInput } =
    useQuery<OllamaStatus, Error>({
      queryKey: ['vllmStatus'],
      queryFn: () => fetchVllmStatus(),
      staleTime: 5000,
      refetchOnWindowFocus: true,
      enabled: !disabled,
    });

  const isAiResponding = addMessageMutation.isPending;
  const isEffectivelyDisabled =
    disabled ||
    isAiResponding ||
    !activeChatId ||
    isSelectModelModalOpen ||
    isLoadingOllamaStatusForInput;

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

  useEffect(() => {
    if (
      pendingMessage &&
      ollamaStatus?.activeModel &&
      ollamaStatus.modelChecked === ollamaStatus.activeModel &&
      ollamaStatus.loaded
    ) {
      addMessageMutation.mutate(pendingMessage);
      setPendingMessage(null);
    }
  }, [ollamaStatus, pendingMessage, addMessageMutation]);

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

    if (!ollamaStatus) {
      setToastMessageAtom('Waiting for AI model status...');
      queryClient.refetchQueries({ queryKey: ['vllmStatus'] });
      return false;
    }

    const {
      activeModel: currentActiveModel,
      modelChecked,
      loaded,
    } = ollamaStatus;

    if (
      !currentActiveModel ||
      (currentActiveModel && modelChecked === currentActiveModel && !loaded)
    ) {
      setPendingMessage(queryToSend);
      setIsSelectModelModalOpen(true);
      return false;
    }

    addMessageMutation.mutate(queryToSend);
    return true;
  };

  const handleModelSuccessfullySet = () => {
    setIsSelectModelModalOpen(false);
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
    setToastMessageAtom('? Stream cancellation requested (if supported).');
    if (!isEffectivelyDisabled && inputRef.current) {
      inputRef.current.focus();
    }
  };

  const showCancelButton = isAiResponding && !disabled;
  const sendButtonDisabled = isEffectivelyDisabled || !currentQuery.trim();
  const starredButtonDisabled = isEffectivelyDisabled;
  const inputFieldDisabled = isEffectivelyDisabled;

  const placeholderText = isStandalone
    ? 'Ask anything...'
    : 'Ask about the session...';

  return (
    <>
      <Flex direction="column" gap="1">
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
              title="Cancel response (Not Implemented Yet)"
              aria-label="Cancel AI response"
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
              title={isAiResponding ? 'AI is responding...' : 'Send message'}
              aria-label={isAiResponding ? 'AI is responding' : 'Send message'}
            >
              {isAiResponding ? <Spinner size="1" /> : <PaperPlaneIcon />}
            </IconButton>
          )}
        </Flex>
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
      </Flex>

      <SelectActiveModelModal
        isOpen={isSelectModelModalOpen}
        onOpenChange={setIsSelectModelModalOpen}
        onModelSuccessfullySet={handleModelSuccessfullySet}
        currentActiveModelName={ollamaStatus?.activeModel}
        currentConfiguredContextSize={ollamaStatus?.configuredContextSize}
        activeTranscriptTokens={transcriptTokenCount}
        ollamaStatus={ollamaStatus}
      />
    </>
  );
}
