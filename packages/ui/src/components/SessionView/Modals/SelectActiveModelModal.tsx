// packages/ui/src/components/SessionView/Modals/SelectActiveModelModal.tsx
import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  Button,
  Flex,
  Text,
  Box,
  Spinner,
  Callout,
  Select,
  TextField,
  Separator,
  Tooltip,
} from '@radix-ui/themes';
import {
  InfoCircledIcon,
  Cross2Icon,
  CheckCircledIcon,
  LightningBoltIcon,
  ExclamationTriangleIcon,
  MagicWandIcon,
} from '@radix-ui/react-icons';
import { fetchAvailableModels, setVllmModel } from '../../../api/vllm';
import { toastMessageAtom } from '../../../store';
import { useSetAtom } from 'jotai';
import type {
  OllamaModelInfo,
  AvailableModelsResponse,
  OllamaStatus,
} from '../../../types';

const PADDING_ESTIMATE = 1500;

interface SelectActiveModelModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onModelSuccessfullySet: () => void;
  currentActiveModelName?: string | null;
  currentConfiguredContextSize?: number | null;
  activeTranscriptTokens?: number | null;
  ollamaStatus: OllamaStatus | undefined;
}

export function SelectActiveModelModal({
  isOpen,
  onOpenChange,
  onModelSuccessfullySet,
  currentActiveModelName,
  currentConfiguredContextSize,
  activeTranscriptTokens,
}: SelectActiveModelModalProps) {
  const queryClient = useQueryClient();
  const setToast = useSetAtom(toastMessageAtom);

  const [selectedModelName, setSelectedModelName] = useState<string>(
    currentActiveModelName || ''
  );
  const [contextSizeInput, setContextSizeInput] = useState<string>(
    currentConfiguredContextSize?.toString() || ''
  );
  const [localError, setLocalError] = useState<string | null>(null);

  const modelSelectRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) {
      setSelectedModelName(currentActiveModelName || '');
      setContextSizeInput(currentConfiguredContextSize?.toString() || '');
      setLocalError(null);
      const timer = setTimeout(() => {
        modelSelectRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen, currentActiveModelName, currentConfiguredContextSize]);

  const {
    data: availableModelsData,
    isLoading: isLoadingAvailable,
    error: availableError,
  } = useQuery<AvailableModelsResponse, Error>({
    queryKey: ['availableVllmModels'],
    queryFn: fetchAvailableModels,
    enabled: isOpen,
    staleTime: 10 * 1000,
  });

  const setModelMutation = useMutation({
    mutationFn: (variables: {
      modelName: string;
      contextSize?: number | null;
    }) => {
      const { modelName, contextSize } = variables;
      return setVllmModel(modelName, contextSize);
    },
    onSuccess: (data: { message: string }) => {
      setToast(`✅ ${data.message}`);
      queryClient.invalidateQueries({ queryKey: ['vllmStatus'] });
      onModelSuccessfullySet();
      onOpenChange(false);
    },
    onError: (error: Error) => {
      setLocalError(
        `Failed to set model: ${error.message || 'Request failed.'}`
      );
      setToast(`❌ Error setting model: ${error.message || 'Request failed.'}`);
    },
  });

  const isAnyActionInProgress = setModelMutation.isPending;

  const handleSetModel = () => {
    setLocalError(null);
    if (!selectedModelName) {
      setLocalError('Please select a model.');
      return;
    }

    let parsedContextSize: number | null = null;
    if (contextSizeInput.trim()) {
      const num = parseInt(contextSizeInput.trim(), 10);
      if (isNaN(num) || num <= 0) {
        setLocalError(
          'Context size must be a positive number or empty for default.'
        );
        return;
      }
      parsedContextSize = num;
    }
    setModelMutation.mutate({
      modelName: selectedModelName,
      contextSize: parsedContextSize,
    });
  };

  const handleManualClose = (open: boolean) => {
    if (!open && isAnyActionInProgress) return;
    onOpenChange(open);
  };

  const availableModels = availableModelsData?.models || [];

  const suggestedContextSize =
    typeof activeTranscriptTokens === 'number' && activeTranscriptTokens > 0
      ? activeTranscriptTokens + PADDING_ESTIMATE
      : null;

  const handleUseSuggested = () => {
    if (suggestedContextSize) {
      setContextSizeInput(suggestedContextSize.toString());
    }
  };

  const handleUseModelDefault = () => {
    setContextSizeInput('');
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={handleManualClose}>
      <Dialog.Content style={{ maxWidth: 500 }}>
        <Dialog.Title>Configure AI Model</Dialog.Title>
        <Dialog.Description size="2" mb="4" color="gray">
          Select an active vLLM model and optionally set a custom context window
          size for API requests.
        </Dialog.Description>

        <Flex direction="column" gap="3">
          <label>
            <Text as="div" size="2" mb="1" weight="medium">
              Select Model
            </Text>
            {isLoadingAvailable ? (
              <Flex align="center" gap="2">
                <Spinner size="1" />
                <Text color="gray" size="2">
                  Loading available models...
                </Text>
              </Flex>
            ) : availableError ? (
              <Callout.Root color="red" size="1">
                <Callout.Icon>
                  <ExclamationTriangleIcon />
                </Callout.Icon>
                <Callout.Text>
                  Error loading models: {availableError.message}
                </Callout.Text>
              </Callout.Root>
            ) : (
              <Select.Root
                value={selectedModelName}
                onValueChange={(value) => setSelectedModelName(value)}
                disabled={isAnyActionInProgress || availableModels.length === 0}
              >
                <Select.Trigger
                  ref={modelSelectRef}
                  placeholder={
                    availableModels.length === 0
                      ? 'No model being served'
                      : 'Choose a model...'
                  }
                  style={{ width: '100%' }}
                  disabled={
                    isAnyActionInProgress || availableModels.length === 0
                  }
                />
                <Select.Content position="popper">
                  {availableModels.map((model) => (
                    <Select.Item key={model.name} value={model.name}>
                      {model.name}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            )}
          </label>

          <label>
            <Flex justify="between" align="center" mb="1">
              <Text as="div" size="2" weight="medium">
                Context Window Size
              </Text>
              <Flex gap="2">
                {suggestedContextSize && (
                  <Button
                    variant="soft"
                    size="1"
                    onClick={handleUseSuggested}
                    disabled={isAnyActionInProgress}
                    title={`Based on transcript + padding (${suggestedContextSize.toLocaleString()})`}
                  >
                    <MagicWandIcon width="12" height="12" /> Use Suggested
                  </Button>
                )}
                <Button
                  variant="soft"
                  size="1"
                  onClick={handleUseModelDefault}
                  disabled={isAnyActionInProgress}
                  title="Let API use model's default"
                >
                  <LightningBoltIcon width="12" height="12" /> Use Default
                </Button>
              </Flex>
            </Flex>
            <TextField.Root
              size="2"
              placeholder={
                suggestedContextSize
                  ? `Suggested: ${suggestedContextSize.toLocaleString()}`
                  : 'e.g., 4096 (Empty for default)'
              }
              value={contextSizeInput}
              onChange={(e) => setContextSizeInput(e.target.value)}
              disabled={isAnyActionInProgress}
              type="number"
              min="1"
            />
            <Text size="1" color="gray" mt="1">
              This sets the context size for API requests, it does not change
              the vLLM server's `max-model-len`.
              {activeTranscriptTokens && (
                <Box mt="1">
                  <Text size="1" color="gray">
                    Current transcript: ~
                    {activeTranscriptTokens.toLocaleString()} tokens.
                  </Text>
                </Box>
              )}
            </Text>
          </label>

          {localError && (
            <Callout.Root color="red" size="1">
              <Callout.Icon>
                <InfoCircledIcon />
              </Callout.Icon>
              <Callout.Text>{localError}</Callout.Text>
            </Callout.Root>
          )}
        </Flex>

        <Separator my="4" size="4" />

        <Flex gap="3" mt="4" justify="end" align="center">
          <Button
            variant="soft"
            color="gray"
            onClick={() => handleManualClose(false)}
            disabled={isAnyActionInProgress}
          >
            <Cross2Icon /> Cancel
          </Button>
          <Button
            onClick={handleSetModel}
            disabled={
              isAnyActionInProgress || isLoadingAvailable || !selectedModelName
            }
          >
            {setModelMutation.isPending ? (
              <>
                <Spinner size="2" /> <Text ml="1">Applying...</Text>
              </>
            ) : (
              <>
                <CheckCircledIcon /> Set Active Model
              </>
            )}
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
