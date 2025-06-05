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
} from '@radix-ui/themes';
import {
  InfoCircledIcon,
  Cross2Icon,
  CheckCircledIcon,
  LightningBoltIcon,
  ExclamationTriangleIcon,
} from '@radix-ui/react-icons';
import {
  fetchAvailableModels,
  setOllamaModel,
  fetchOllamaStatus,
} from '../../../api/api';
import { toastMessageAtom } from '../../../store';
import { useSetAtom } from 'jotai';
import type {
  OllamaModelInfo,
  OllamaStatus,
  AvailableModelsResponse,
} from '../../../types';
import { LlmManagementModal } from './LlmManagementModal';

interface SelectActiveModelModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onModelSuccessfullySet: () => void;
  currentActiveModelName?: string | null;
  currentConfiguredContextSize?: number | null;
}

export function SelectActiveModelModal({
  isOpen,
  onOpenChange,
  onModelSuccessfullySet,
  currentActiveModelName,
  currentConfiguredContextSize,
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
      // Add type for data
      setToast(`✅ ${data.message}`);
      queryClient.invalidateQueries({ queryKey: ['ollamaStatus'] });
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
    if (!open && setModelMutation.isPending) return;
    onOpenChange(open);
  };

  const availableModels = availableModelsData?.models || [];

  const handleAdvancedModalLinkClick = (
    event: React.MouseEvent<HTMLAnchorElement>
  ) => {
    if (setModelMutation.isPending) {
      event.preventDefault(); // Prevent navigation if mutation is pending
      return;
    }
    setIsAdvancedModalOpen(true);
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
                  onValueChange={setSelectedModelName}
                  disabled={
                    setModelMutation.isPending || availableModels.length === 0
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
                      setModelMutation.isPending || availableModels.length === 0
                    } // Also disable trigger if pending
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
              <Text as="div" size="2" mb="1" weight="medium">
                Context Window Size (Optional)
              </Text>
              <TextField.Root
                size="2"
                placeholder="e.g., 4096 (Default if empty)"
                value={contextSizeInput}
                onChange={(e) => setContextSizeInput(e.target.value)}
                disabled={setModelMutation.isPending}
                type="number"
                min="1"
              />
              <Text size="1" color="gray" mt="1">
                Leave empty to use the model's default context size.
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
            {/* Conditionally prevent click instead of using disabled prop */}
            <Link
              onClick={
                !setModelMutation.isPending
                  ? handleAdvancedModalLinkClick
                  : (e) => e.preventDefault()
              }
              size="2"
              aria-disabled={setModelMutation.isPending} // For accessibility
              style={
                setModelMutation.isPending
                  ? { pointerEvents: 'none', opacity: 0.6 }
                  : {}
              } // Visual cue
            >
              Advanced: Pull, Delete, or View All Models...
            </Link>
          </Flex>

          <Flex gap="3" mt="4" justify="end">
            <Button
              variant="soft"
              color="gray"
              onClick={() => handleManualClose(false)}
              disabled={setModelMutation.isPending}
            >
              <Cross2Icon /> Cancel
            </Button>
            <Button
              onClick={handleSetModel}
              disabled={
                setModelMutation.isPending ||
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
        </Dialog.Content>
      </Dialog.Root>

      <LlmManagementModal
        isOpen={isAdvancedModalOpen}
        onOpenChange={setIsAdvancedModalOpen}
      />
    </>
  );
}
