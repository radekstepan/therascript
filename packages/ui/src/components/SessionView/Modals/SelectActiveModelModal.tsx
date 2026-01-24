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
  Slider,
} from '@radix-ui/themes';
import {
  InfoCircledIcon,
  Cross2Icon,
  CheckIcon,
  LightningBoltIcon,
} from '@radix-ui/react-icons';
import {
  fetchAvailableModels,
  setOllamaModel,
  estimateModelVram,
  fetchGpuStats,
} from '../../../api/api';
import type {
  OllamaModelInfo,
  OllamaStatus,
  VramEstimateResponse,
} from '../../../types';
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

  const [temperature, setTemperature] = useState(0.7);
  const [topP, setTopP] = useState(0.9);
  const [repeatPenalty, setRepeatPenalty] = useState(1.1);
  const [vramEstimate, setVramEstimate] = useState<{
    estimated_vram_bytes: number | null;
    vram_per_token_bytes: number | null;
    breakdown?: {
      weights_bytes: number;
      kv_cache_bytes: number;
    };
    error?: string;
  } | null>(null);

  const { data: availableModelsData, isLoading: isLoadingModels } = useQuery({
    queryKey: ['availableOllamaModels'],
    queryFn: fetchAvailableModels,
    enabled: isOpen,
    staleTime: 60 * 1000,
  });

  const { data: gpuStats } = useQuery({
    queryKey: ['gpuStats'],
    queryFn: fetchGpuStats,
    enabled: isOpen,
    refetchInterval: 10000,
  });

  const setModelMutation = useMutation({
    mutationFn: (variables: {
      modelName: string;
      contextSize?: number | null;
      temperature?: number;
      topP?: number;
      repeatPenalty?: number;
    }) =>
      setOllamaModel(
        variables.modelName,
        variables.contextSize,
        variables.temperature,
        variables.topP,
        variables.repeatPenalty
      ),
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
        setUserTouchedContext(true);
      } else {
        setContextSizeInput('');
        setUserTouchedContext(false);
      }
      setTemperature(ollamaStatus?.configuredTemperature ?? 0.7);
      setTopP(ollamaStatus?.configuredTopP ?? 0.9);
      setRepeatPenalty(ollamaStatus?.configuredRepeatPenalty ?? 1.1);
      setError(null);
    }
  }, [
    isOpen,
    currentActiveModelName,
    currentConfiguredContextSize,
    ollamaStatus?.configuredTemperature,
    ollamaStatus?.configuredTopP,
    ollamaStatus?.configuredRepeatPenalty,
  ]);

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
    setModelMutation.mutate({
      modelName: selectedModel,
      contextSize,
      temperature,
      topP,
      repeatPenalty,
    });
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

  // Update VRAM estimate when model or context size changes
  useEffect(() => {
    if (!selectedModel || !contextSizeInput) {
      setVramEstimate(null);
      return;
    }

    const contextSize = parseInt(contextSizeInput, 10);
    if (isNaN(contextSize) || contextSize <= 0) return;

    estimateModelVram(selectedModel, contextSize)
      .then(setVramEstimate)
      .catch((err) => {
        console.error('Failed to estimate VRAM:', err);
        setVramEstimate({
          estimated_vram_bytes: null,
          vram_per_token_bytes: null,
          error: err.message,
        });
      });
  }, [selectedModel, contextSizeInput]);

  // Calculate VRAM warning based on available GPU memory
  const vramWarning = React.useMemo(() => {
    if (!vramEstimate?.estimated_vram_bytes || !gpuStats?.available)
      return null;

    const totalGpuMemory = gpuStats.gpus[0]?.memory.totalMb * 1024 * 1024 || 0;
    const estimate = vramEstimate.estimated_vram_bytes;

    if (estimate > totalGpuMemory) {
      return {
        type: 'error' as const,
        message: `Estimated VRAM (${prettyBytes(estimate)}) exceeds GPU capacity (${prettyBytes(totalGpuMemory)}). This will force CPU offloading and degrade performance.`,
      };
    }

    const percentUsed = (estimate / totalGpuMemory) * 100;
    if (percentUsed > 90) {
      return {
        type: 'warning' as const,
        message: `Estimated VRAM (${prettyBytes(estimate)}) is very close to GPU capacity (${prettyBytes(totalGpuMemory)}). Consider reducing context size.`,
      };
    }

    return null;
  }, [vramEstimate, gpuStats]);

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
          </label>

          <Box>
            <Text as="div" size="2" mb="2" weight="medium">
              Model Parameters
            </Text>
            <Box className="space-y-4">
              <Box>
                <Flex align="center" justify="between" mb="2">
                  <Text size="1">Temperature</Text>
                  <Badge variant="outline" size="1">
                    {temperature.toFixed(1)}
                  </Badge>
                </Flex>
                <Slider
                  value={[temperature]}
                  onValueChange={([value]) => setTemperature(value)}
                  min={0}
                  max={2}
                  step={0.1}
                />
              </Box>

              <Box>
                <Flex align="center" justify="between" mb="2">
                  <Text size="1">Top-P</Text>
                  <Badge variant="outline" size="1">
                    {topP.toFixed(2)}
                  </Badge>
                </Flex>
                <Slider
                  value={[topP]}
                  onValueChange={([value]) => setTopP(value)}
                  min={0}
                  max={1}
                  step={0.05}
                />
              </Box>

              <Box>
                <Flex align="center" justify="between" mb="2">
                  <Text size="1">Repeat Penalty</Text>
                  <Badge variant="outline" size="1">
                    {repeatPenalty.toFixed(1)}
                  </Badge>
                </Flex>
                <Slider
                  value={[repeatPenalty]}
                  onValueChange={([value]) => setRepeatPenalty(value)}
                  min={0.5}
                  max={2}
                  step={0.1}
                />
              </Box>
            </Box>
          </Box>

          {vramEstimate && (
            <Callout.Root size="1" color={vramEstimate.error ? 'gray' : 'blue'}>
              <Callout.Icon>
                <LightningBoltIcon />
              </Callout.Icon>
              <Callout.Text>
                {vramEstimate.error ? (
                  <>VRAM estimation unavailable: {vramEstimate.error}</>
                ) : vramEstimate.estimated_vram_bytes ? (
                  <>
                    Estimated VRAM:{' '}
                    <Strong>
                      {prettyBytes(vramEstimate.estimated_vram_bytes)}
                    </Strong>
                    {vramEstimate.breakdown && (
                      <>
                        {' '}
                        ({prettyBytes(
                          vramEstimate.breakdown.weights_bytes
                        )}{' '}
                        weights +{' '}
                        {prettyBytes(vramEstimate.breakdown.kv_cache_bytes)} KV
                        cache )
                      </>
                    )}
                  </>
                ) : (
                  <>VRAM data unavailable for this model</>
                )}
              </Callout.Text>
            </Callout.Root>
          )}

          {vramWarning && (
            <Callout.Root
              size="1"
              color={vramWarning.type === 'error' ? 'red' : 'amber'}
            >
              <Callout.Icon>
                <InfoCircledIcon />
              </Callout.Icon>
              <Callout.Text>{vramWarning.message}</Callout.Text>
            </Callout.Root>
          )}

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
            className="transition-all duration-150"
          >
            <Cross2Icon /> Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving || !selectedModel}
            className="transition-all duration-150"
          >
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
