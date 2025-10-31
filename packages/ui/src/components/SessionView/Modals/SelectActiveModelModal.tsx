/* packages/ui/src/components/SessionView/Modals/SelectActiveModelModal.tsx */
import React, { useState, useEffect } from 'react';
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
  Strong,
  Tooltip,
  Badge,
} from '@radix-ui/themes';
import {
  InfoCircledIcon,
  Cross2Icon,
  CheckIcon,
  LightningBoltIcon,
} from '@radix-ui/react-icons';
import { fetchAvailableModels, setOllamaModel } from '../../../api/api';
import type { OllamaModelInfo, OllamaStatus } from '../../../types';
import prettyBytes from 'pretty-bytes';

interface SelectActiveModelModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onModelSuccessfullySet: () => void;
  currentActiveModelName?: string | null;
  currentConfiguredContextSize?: number | null;
  activeTranscriptTokens?: number | null;
  ollamaStatus?: OllamaStatus;
}

export function SelectActiveModelModal({
  isOpen,
  onOpenChange,
  onModelSuccessfullySet,
  currentActiveModelName,
  currentConfiguredContextSize,
  activeTranscriptTokens,
  ollamaStatus,
}: SelectActiveModelModalProps) {
  const queryClient = useQueryClient();
  const [selectedModel, setSelectedModel] = useState(
    currentActiveModelName || ''
  );
  const [contextSizeInput, setContextSizeInput] = useState('');
  const [userTouchedContext, setUserTouchedContext] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: availableModelsData, isLoading: isLoadingModels } = useQuery({
    queryKey: ['availableOllamaModels'],
    queryFn: fetchAvailableModels,
    enabled: isOpen,
    staleTime: 60 * 1000,
  });

  const setModelMutation = useMutation({
    mutationFn: (variables: {
      modelName: string;
      contextSize?: number | null;
    }) => setOllamaModel(variables.modelName, variables.contextSize),
    onSuccess: () => {
      onModelSuccessfullySet();
      queryClient.invalidateQueries({ queryKey: ['ollamaStatus'] });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      setError(`Failed to set model: ${err.message}`);
    },
  });

  useEffect(() => {
    if (isOpen) {
      setSelectedModel(currentActiveModelName || '');
      if (currentConfiguredContextSize && currentConfiguredContextSize > 0) {
        setContextSizeInput(String(currentConfiguredContextSize));
        // Preserve existing custom size; avoid auto-overwriting with recommended
        setUserTouchedContext(true);
      } else {
        // Start empty; will auto-fill with recommended when available
        setContextSizeInput('');
        setUserTouchedContext(false);
      }
      setError(null);
    }
  }, [isOpen, currentActiveModelName, currentConfiguredContextSize]);

  const handleSave = () => {
    setError(null);
    if (!selectedModel) {
      setError('Please select a model.');
      return;
    }
    const contextSize = contextSizeInput
      ? parseInt(contextSizeInput, 10)
      : null;
    if (contextSizeInput && (isNaN(contextSize!) || contextSize! <= 0)) {
      setError('Context size must be a positive number if provided.');
      return;
    }
    setModelMutation.mutate({ modelName: selectedModel, contextSize });
  };

  const isSaving = setModelMutation.isPending;
  const models = availableModelsData?.models || [];
  const selectedModelDetails = models.find((m) => m.name === selectedModel);
  const effectiveContextSize =
    contextSizeInput && parseInt(contextSizeInput, 10) > 0
      ? parseInt(contextSizeInput, 10)
      : selectedModelDetails?.defaultContextSize;
  const isContextSufficient = activeTranscriptTokens
    ? effectiveContextSize
      ? activeTranscriptTokens < effectiveContextSize
      : true
    : true;

  // --- Recommended Context Size (avoid max by default) ---
  const recommendedContextSize = React.useMemo(() => {
    if (!activeTranscriptTokens) return undefined;
    const modelMax = selectedModelDetails?.defaultContextSize ?? null;
    const base = Math.max(4096, activeTranscriptTokens + 2048);
    const rounded = Math.ceil(base / 256) * 256;
    return modelMax != null ? Math.min(rounded, modelMax) : rounded;
  }, [activeTranscriptTokens, selectedModelDetails?.defaultContextSize]);

  // Auto-fill the input with recommended when available and user hasn't typed
  useEffect(() => {
    if (!isOpen) return;
    if (userTouchedContext) return;
    if (recommendedContextSize && recommendedContextSize > 0) {
      setContextSizeInput(String(recommendedContextSize));
    }
  }, [isOpen, userTouchedContext, recommendedContextSize]);

  return (
    <Dialog.Root open={isOpen} onOpenChange={onOpenChange}>
      <Dialog.Content style={{ maxWidth: 450 }}>
        <Dialog.Title>Configure AI Model</Dialog.Title>
        <Dialog.Description size="2" mb="4">
          Select the active model and optionally override its context size.
        </Dialog.Description>
        <Flex direction="column" gap="4">
          <label>
            <Text as="div" size="2" mb="1" weight="medium">
              Select Model
            </Text>
            <Select.Root
              value={selectedModel}
              onValueChange={setSelectedModel}
              disabled={isSaving || isLoadingModels}
              size="2"
            >
              <Select.Trigger
                placeholder={
                  isLoadingModels ? 'Loading models...' : 'Choose a model'
                }
              />
              <Select.Content>
                {models.map((model) => (
                  <Select.Item key={model.name} value={model.name}>
                    {/* --- *** UPDATED SECTION *** --- */}
                    <Flex justify="between" align="center" gap="4" width="100%">
                      <Text truncate>{model.name}</Text>
                      {model.defaultContextSize &&
                        model.defaultContextSize > 0 && (
                          <Tooltip
                            content={`Default Max Context: ${model.defaultContextSize.toLocaleString()} Tokens`}
                          >
                            <Badge
                              variant="soft"
                              color="blue"
                              radius="full"
                              size="1"
                              style={{ flexShrink: 0 }}
                            >
                              <LightningBoltIcon
                                style={{ marginRight: '2px' }}
                              />
                              {prettyBytes(model.defaultContextSize).replace(
                                ' ',
                                ''
                              )}
                            </Badge>
                          </Tooltip>
                        )}
                    </Flex>
                    {/* --- *** END UPDATED SECTION *** --- */}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </label>

          <label>
            <Text as="div" size="2" mb="1" weight="medium">
              Context Size (Optional)
            </Text>
            <TextField.Root
              type="number"
              min="1"
              step="1024"
              placeholder={`Default (${selectedModelDetails?.defaultContextSize?.toLocaleString() ?? 'auto'})`}
              value={contextSizeInput}
              onChange={(e) => {
                setContextSizeInput(e.target.value);
                setUserTouchedContext(true);
              }}
              disabled={isSaving}
            />
            {/* Removed explicit Recommended UI in favor of info message below */}
          </label>

          {activeTranscriptTokens && (
            <Callout.Root
              size="1"
              color={isContextSufficient ? 'gray' : 'amber'}
            >
              <Callout.Icon>
                <InfoCircledIcon />
              </Callout.Icon>
              <Callout.Text>
                Transcript requires ~
                <Strong> {activeTranscriptTokens.toLocaleString()}</Strong>{' '}
                tokens.{' '}
                {recommendedContextSize ? (
                  <>
                    Recommended context:{' '}
                    <Strong>{recommendedContextSize.toLocaleString()}</Strong>.
                  </>
                ) : null}
              </Callout.Text>
            </Callout.Root>
          )}

          {(error || setModelMutation.isError) && (
            <Callout.Root color="red" role="alert" size="1">
              <Callout.Icon>
                <InfoCircledIcon />
              </Callout.Icon>
              <Callout.Text>
                {error || setModelMutation.error?.message}
              </Callout.Text>
            </Callout.Root>
          )}
        </Flex>

        <Flex gap="3" mt="4" justify="end">
          <Button
            variant="soft"
            color="gray"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            <Cross2Icon /> Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving || !selectedModel}>
            {isSaving ? (
              <>
                <Spinner /> <Text ml="1">Saving...</Text>
              </>
            ) : (
              <>
                <CheckIcon /> Save & Set Active
              </>
            )}
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
