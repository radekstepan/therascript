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
  Link,
  Tooltip,
} from '@radix-ui/themes';
import {
  InfoCircledIcon,
  Cross2Icon,
  CheckCircledIcon,
  LightningBoltIcon,
  ExclamationTriangleIcon,
  MagicWandIcon,
  ReloadIcon, // <-- ADDED
} from '@radix-ui/react-icons';
import {
  fetchAvailableModels,
  setOllamaModel,
  unloadOllamaModel, // <-- ADDED
} from '../../../api/api';
import { toastMessageAtom } from '../../../store';
import { useSetAtom } from 'jotai';
import type {
  OllamaModelInfo,
  AvailableModelsResponse,
  OllamaStatus, // <-- ADDED
} from '../../../types';
import { LlmManagementModal } from './LlmManagementModal';

const PADDING_ESTIMATE = 1500;

interface SelectActiveModelModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onModelSuccessfullySet: () => void;
  currentActiveModelName?: string | null;
  currentConfiguredContextSize?: number | null;
  activeTranscriptTokens?: number | null;
  ollamaStatus: OllamaStatus | undefined; // <-- ADDED PROP
}

export function SelectActiveModelModal({
  isOpen,
  onOpenChange,
  onModelSuccessfullySet,
  currentActiveModelName,
  currentConfiguredContextSize,
  activeTranscriptTokens,
  ollamaStatus, // <-- DESTRUCTURED PROP
}: SelectActiveModelModalProps) {
  const queryClient = useQueryClient();
  const setToast = useSetAtom(toastMessageAtom);

  const [selectedModelName, setSelectedModelName] = useState<string>(
    currentActiveModelName || ''
  );
  const [contextSizeInput, setContextSizeInput] = useState<string>(
    currentConfiguredContextSize?.toString() || ''
  );
  const [isAdvancedModalOpen, setIsAdvancedModalOpen] = useState(false);
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
    queryKey: ['availableOllamaModels'],
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
      return setOllamaModel(modelName, contextSize);
    },
    onSuccess: (data: { message: string }, variables) => {
      setToast(`? ${data.message}`);
      queryClient.invalidateQueries({ queryKey: ['ollamaStatus'] });
      onModelSuccessfullySet();
      onOpenChange(false);
    },
    onError: (error: Error) => {
      setLocalError(
        `Failed to set model: ${error.message || 'Request failed.'}`
      );
      setToast(`? Error setting model: ${error.message || 'Request failed.'}`);
    },
  });

  const unloadMutation = useMutation({
    mutationFn: unloadOllamaModel,
    onSuccess: (data) => {
      setToast(`? ${data.message}`);
      queryClient.invalidateQueries({ queryKey: ['ollamaStatus'] });
    },
    onError: (error: Error) => {
      setToast(
        `? Error unloading model: ${error.message || 'Request failed.'}`
      );
    },
  });

  const isAnyActionInProgress =
    setModelMutation.isPending || unloadMutation.isPending;
  const isUnloadDisabled = !ollamaStatus?.loaded || isAnyActionInProgress;

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

  const handleUnloadClick = () => {
    if (isUnloadDisabled) return;
    unloadMutation.mutate();
  };

  const handleManualClose = (open: boolean) => {
    if (!open && isAnyActionInProgress) return;
    onOpenChange(open);
  };

  const availableModels = availableModelsData?.models || [];
  const selectedModelDetails = availableModels.find(
    (m) => m.name === selectedModelName
  );

  const handleAdvancedModalLinkClick = (
    event: React.MouseEvent<HTMLAnchorElement>
  ) => {
    if (isAnyActionInProgress) {
      event.preventDefault();
      return;
    }
    setIsAdvancedModalOpen(true);
  };

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
    if (selectedModelDetails?.defaultContextSize) {
      setContextSizeInput(selectedModelDetails.defaultContextSize.toString());
    } else {
      setContextSizeInput('');
    }
  };

  return (
    <>
      <Dialog.Root open={isOpen} onOpenChange={handleManualClose}>
        <Dialog.Content style={{ maxWidth: 500 }}>
          <Dialog.Title>Configure AI Model</Dialog.Title>
          <Dialog.Description size="2" mb="4" color="gray">
            Select an active Ollama model and optionally set a custom context
            window size.
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
                  onValueChange={(value) => {
                    setSelectedModelName(value);
                  }}
                  disabled={
                    isAnyActionInProgress || availableModels.length === 0
                  }
                >
                  <Select.Trigger
                    ref={modelSelectRef}
                    placeholder={
                      availableModels.length === 0
                        ? 'No models found locally'
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
                        {model.defaultContextSize && (
                          <Text size="1" color="gray" ml="2">
                            ({model.defaultContextSize.toLocaleString()} tokens)
                          </Text>
                        )}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
              )}
            </label>

            <label>
              <Flex justify="between" align="center" mb="1">
                <Text as="div" size="2" weight="medium">
                  Context Window Size (num_ctx)
                </Text>
                <Flex gap="2">
                  {suggestedContextSize && selectedModelDetails && (
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
                  {selectedModelDetails?.defaultContextSize && (
                    <Button
                      variant="soft"
                      size="1"
                      onClick={handleUseModelDefault}
                      disabled={isAnyActionInProgress}
                      title={`Model's default maximum (${selectedModelDetails.defaultContextSize.toLocaleString()})`}
                    >
                      <LightningBoltIcon width="12" height="12" /> Use Default
                      Max
                    </Button>
                  )}
                </Flex>
              </Flex>
              <TextField.Root
                size="2"
                placeholder={
                  suggestedContextSize
                    ? `Suggested: ${suggestedContextSize.toLocaleString()} (Transcript + Padding)`
                    : selectedModelDetails?.defaultContextSize
                      ? `Model Default: ${selectedModelDetails.defaultContextSize.toLocaleString()}`
                      : 'e.g., 4096 (Empty for default)'
                }
                value={contextSizeInput}
                onChange={(e) => setContextSizeInput(e.target.value)}
                disabled={isAnyActionInProgress}
                type="number"
                min="1"
              />
              <Text size="1" color="gray" mt="1">
                Enter desired context size. Leave empty for model's default.
                {activeTranscriptTokens && (
                  <Box mt="1">
                    <Text size="1" color="gray">
                      Current transcript: ~
                      {activeTranscriptTokens.toLocaleString()} tokens. Chat
                      padding: ~{PADDING_ESTIMATE.toLocaleString()} tokens.
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
          <Flex justify="start" mb="4">
            <Link
              onClick={
                !isAnyActionInProgress
                  ? handleAdvancedModalLinkClick
                  : (e) => e.preventDefault()
              }
              size="2"
              aria-disabled={isAnyActionInProgress}
              style={
                isAnyActionInProgress
                  ? { pointerEvents: 'none', opacity: 0.6 }
                  : {}
              }
            >
              Advanced: Pull, Delete, or View All Models...
            </Link>
          </Flex>

          <Flex gap="3" mt="4" justify="between" align="center">
            <Button
              variant="outline"
              color="orange"
              onClick={handleUnloadClick}
              disabled={isUnloadDisabled}
              title={
                !ollamaStatus?.loaded
                  ? 'No model is currently loaded'
                  : 'Unload the active model'
              }
            >
              {unloadMutation.isPending ? <Spinner size="2" /> : <ReloadIcon />}
              <Text ml="1">
                {unloadMutation.isPending ? 'Unloading...' : 'Unload Model'}
              </Text>
            </Button>
            <Flex gap="3">
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
                  isAnyActionInProgress ||
                  isLoadingAvailable ||
                  !selectedModelName
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
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

      <LlmManagementModal
        isOpen={isAdvancedModalOpen}
        onOpenChange={setIsAdvancedModalOpen}
      />
    </>
  );
}
