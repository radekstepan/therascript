/* packages/ui/src/components/SessionView/Modals/SelectActiveModelModal.tsx */
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  Button,
  Flex,
  Text,
  Box,
  Spinner,
  Callout,
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
  ReloadIcon,
} from '@radix-ui/react-icons';
import {
  setLlmModel,
  unloadLlmModel,
  estimateModelVram,
  fetchGpuStats,
} from '../../../api/api';
import type {
  LlmModelInfo,
  LlmStatus,
  VramEstimateResponse,
} from '../../../types';
import prettyBytes from 'pretty-bytes';
import { LlmEndpointModelPicker } from '../../Shared/LlmEndpointModelPicker';

interface SelectActiveModelModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onModelSuccessfullySet: () => void;
  currentActiveModelName?: string | null;
  currentConfiguredContextSize?: number | null;
  activeTranscriptTokens?: number | null;
  llmStatus?: LlmStatus;
}

export function SelectActiveModelModal({
  isOpen,
  onOpenChange,
  onModelSuccessfullySet,
  currentActiveModelName,
  currentConfiguredContextSize,
  activeTranscriptTokens,
  llmStatus,
}: SelectActiveModelModalProps) {
  const queryClient = useQueryClient();
  const prevIsOpenRef = useRef(false);
  const [selectedModel, setSelectedModel] = useState(
    currentActiveModelName || ''
  );
  const [contextSizeInput, setContextSizeInput] = useState('');
  const [userTouchedContext, setUserTouchedContext] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Local / Remote LLM toggle. The shared LlmEndpointModelPicker renders the
  // toggle UI and owns the model-list query, but the parent still needs
  // these values to compute the `baseUrl` it sends to the backend and to
  // decide whether to fetch the VRAM estimate. The picker persists the
  // remote URL through `remoteBaseUrlAtom` (localStorage) and pre-fills it
  // when the user toggles to Remote.
  const [isRemote, setIsRemote] = useState(false);
  const [remoteUrl, setRemoteUrl] = useState('');

  const [temperature, setTemperature] = useState(0.7);
  const [topP, setTopP] = useState(0.9);
  const [repeatPenalty, setRepeatPenalty] = useState(1.1);
  // undefined = Auto (let Llm decide); 0 = CPU only; N = N layers on GPU
  const [numGpuLayers, setNumGpuLayers] = useState<number | undefined>(
    undefined
  );
  // -1 = Unrestricted (default), 0 = Disabled, >0 = Token budget
  const [thinkingBudget, setThinkingBudget] = useState<number>(-1);
  const [vramEstimate, setVramEstimate] = useState<VramEstimateResponse | null>(
    null
  );

  // Models fetched by the shared picker; we keep a local mirror so
  // `selectedModelDetails` (used for default context, VRAM, params UI) is
  // always in sync with whatever the picker just queried.
  const [availableModels, setAvailableModels] = useState<LlmModelInfo[]>([]);

  const isValidHttpUrl = React.useCallback((value: string): boolean => {
    try {
      const parsed = new URL(value.trim());
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }, []);

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
      numGpuLayers?: number | null;
      thinkingBudget?: number | null;
      baseUrl?: string | null;
    }) =>
      setLlmModel(
        variables.modelName,
        variables.contextSize,
        variables.temperature,
        variables.topP,
        variables.repeatPenalty,
        variables.numGpuLayers,
        variables.thinkingBudget,
        variables.baseUrl
      ),
    onSuccess: () => {
      onModelSuccessfullySet();
      queryClient.invalidateQueries({ queryKey: ['llmStatus'] });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      setError(`Failed to set model: ${err.message}`);
    },
  });

  const unloadMutation = useMutation({
    mutationFn: unloadLlmModel,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['llmStatus'] });
    },
    onError: (err: Error) => {
      setError(`Failed to unload model: ${err.message}`);
    },
  });

  // Fix flickering bug: only initialize form once when modal opens
  // Decouple from llmStatus polling by using ref-based guard
  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      // Modal just opened — snapshot current backend state into local form
      setSelectedModel(currentActiveModelName || '');
      if (currentConfiguredContextSize && currentConfiguredContextSize > 0) {
        setContextSizeInput(String(currentConfiguredContextSize));
        setUserTouchedContext(true);
      } else {
        setContextSizeInput('');
        setUserTouchedContext(false);
      }
      setTemperature(llmStatus?.configuredTemperature ?? 0.7);
      setTopP(llmStatus?.configuredTopP ?? 0.9);
      setRepeatPenalty(llmStatus?.configuredRepeatPenalty ?? 1.1);
      setNumGpuLayers(
        llmStatus?.configuredNumGpuLayers != null
          ? llmStatus.configuredNumGpuLayers
          : undefined
      );
      setThinkingBudget(llmStatus?.configuredThinkingBudget ?? -1);
      // Initialize Local/Remote toggle from backend-provided state
      // (no brittle "localhost" substring checks).
      if (llmStatus?.isRemoteBaseUrl && llmStatus.activeBaseUrl) {
        setIsRemote(true);
        setRemoteUrl(llmStatus.activeBaseUrl);
      } else {
        setIsRemote(false);
        setRemoteUrl('');
      }
      setError(null);
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen]); // ← llmStatus properties intentionally excluded

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

    // Resolve the base URL we send to the backend.
    // - Remote mode + invalid URL -> block save with a clear error
    // - Remote mode + valid URL  -> send the trimmed URL
    // - Local mode               -> send null to reset to default
    let baseUrl: string | null = null;
    if (isRemote) {
      const trimmed = remoteUrl.trim();
      if (!isValidHttpUrl(trimmed)) {
        setError(
          'Please enter a valid http(s) URL for the remote LM Studio server.'
        );
        return;
      }
      baseUrl = trimmed;
    }

    setModelMutation.mutate({
      modelName: selectedModel,
      contextSize,
      temperature,
      topP,
      repeatPenalty,
      numGpuLayers: numGpuLayers ?? null,
      thinkingBudget: thinkingBudget,
      baseUrl,
    });
  };

  const isSaving = setModelMutation.isPending;
  const isModelLoaded = llmStatus?.loaded === true;
  const selectedModelDetails = useMemo(
    () => availableModels.find((m) => m.name === selectedModel),
    [availableModels, selectedModel]
  );
  const effectiveContextSize =
    contextSizeInput && parseInt(contextSizeInput, 10) > 0
      ? parseInt(contextSizeInput, 10)
      : selectedModelDetails?.defaultContextSize;
  const isContextSufficient = activeTranscriptTokens
    ? effectiveContextSize
      ? activeTranscriptTokens < effectiveContextSize
      : true
    : true;

  // Reset GPU layers to Auto when the user picks a model that no longer exists
  // in the available list. The `availableModels.length > 0` guard prevents
  // clearing the pre-selected model on initial render before the picker's
  // query has loaded.
  useEffect(() => {
    if (!isOpen) return;
    if (!selectedModel) return;
    if (availableModels.length === 0) return;
    if (selectedModelDetails) return;
    setSelectedModel('');
    setVramEstimate(null);
  }, [isOpen, selectedModel, selectedModelDetails, availableModels.length]);

  useEffect(() => {
    if (selectedModel !== currentActiveModelName) {
      setNumGpuLayers(undefined);
      setUserTouchedContext(false); // Allow auto-fill for new model
      setTemperature(0.7);
      setTopP(0.9);
      setRepeatPenalty(1.1);
      setThinkingBudget(-1);
    }
  }, [selectedModel]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Update VRAM estimate when model or context size changes. VRAM is a
  // local-machine concept, so we skip the estimate entirely when the user
  // is targeting a remote endpoint — there's no local GPU to size against
  // and the backend's `estimate-vram` endpoint 404s for remote-only models.
  // The AbortController cancels in-flight requests when dependencies change
  // so stale responses can't overwrite the latest one.
  useEffect(() => {
    if (isRemote) {
      setVramEstimate(null);
      return;
    }
    if (!selectedModel || !selectedModelDetails) {
      setVramEstimate(null);
      return;
    }

    const trimmedContextSize = contextSizeInput.trim();
    const contextSize = trimmedContextSize
      ? parseInt(trimmedContextSize, 10)
      : null;

    if (
      trimmedContextSize &&
      (isNaN(contextSize as number) || (contextSize as number) <= 0)
    ) {
      return;
    }

    const controller = new AbortController();
    estimateModelVram(
      selectedModel,
      contextSize,
      numGpuLayers,
      controller.signal
    )
      .then((data) => {
        if (controller.signal.aborted) return;
        setVramEstimate(data);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        console.error('Failed to estimate VRAM:', err);
        setVramEstimate({
          model: selectedModel,
          context_size: contextSize,
          estimated_vram_bytes: null,
          estimated_ram_bytes: null,
          vram_per_token_bytes: null,
          error: err.message,
        });
      });
    return () => controller.abort();
  }, [
    isRemote,
    selectedModel,
    selectedModelDetails,
    contextSizeInput,
    numGpuLayers,
  ]);

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
          {isModelLoaded && llmStatus?.activeModel !== 'default' && (
            <Callout.Root color="blue" size="1">
              <Callout.Icon>
                <InfoCircledIcon />
              </Callout.Icon>
              <Callout.Text>
                Model <Strong>{llmStatus?.activeModel}</Strong> is currently
                loaded in memory. Unload it to change settings.
              </Callout.Text>
            </Callout.Root>
          )}

          <LlmEndpointModelPicker
            selectedModel={selectedModel}
            onSelectedModelChange={setSelectedModel}
            isRemote={isRemote}
            setIsRemote={setIsRemote}
            remoteUrl={remoteUrl}
            setRemoteUrl={setRemoteUrl}
            disabled={isSaving || isModelLoaded}
            enabled={isOpen}
            placeholder="Choose a model"
            onModelsChange={setAvailableModels}
          />

          {selectedModelDetails && (
            <label>
              <Text as="div" size="2" mb="1" weight="medium">
                Context Size (Optional)
              </Text>
              <TextField.Root
                type="number"
                min="1"
                step="1024"
                placeholder={`Default (${selectedModelDetails.defaultContextSize?.toLocaleString() ?? 'auto'})`}
                value={contextSizeInput}
                onChange={(e) => {
                  setContextSizeInput(e.target.value);
                  setUserTouchedContext(true);
                }}
                disabled={isSaving || isModelLoaded}
              />
            </label>
          )}

          <Box>
            <Text as="div" size="2" mb="2" weight="medium">
              Model Parameters
            </Text>
            <Box className="space-y-4">
              {/* GPU Layers — only shown when architecture metadata is available */}
              {selectedModelDetails?.architecture?.num_layers != null && (
                <Box>
                  <Flex align="center" justify="between" mb="2">
                    <Text size="1">GPU Layers</Text>
                    <Badge variant="outline" size="1">
                      {numGpuLayers === undefined ||
                      numGpuLayers >=
                        selectedModelDetails.architecture.num_layers!
                        ? `Auto (all GPU)`
                        : numGpuLayers === 0
                          ? 'CPU Only'
                          : `${numGpuLayers} / ${selectedModelDetails.architecture.num_layers}`}
                    </Badge>
                  </Flex>
                  <Slider
                    value={[
                      numGpuLayers ??
                        selectedModelDetails.architecture.num_layers!,
                    ]}
                    onValueChange={([value]) => {
                      const max =
                        selectedModelDetails.architecture!.num_layers!;
                      // Treat max as "auto" (undefined = let Llm decide)
                      setNumGpuLayers(value >= max ? undefined : value);
                    }}
                    min={0}
                    max={selectedModelDetails.architecture.num_layers!}
                    step={1}
                    disabled={isSaving || isModelLoaded}
                  />
                  <Flex justify="between" mt="2">
                    <Text size="1" color="gray" style={{ fontSize: '10px' }}>
                      CPU Only
                    </Text>
                    <Text size="1" color="gray" style={{ fontSize: '10px' }}>
                      Auto (all GPU)
                    </Text>
                  </Flex>
                  {numGpuLayers != null &&
                    numGpuLayers > 0 &&
                    numGpuLayers <
                      selectedModelDetails.architecture.num_layers! && (
                      <Callout.Root size="1" color="amber" mt="2">
                        <Callout.Icon>
                          <InfoCircledIcon />
                        </Callout.Icon>
                        <Callout.Text>
                          Partial GPU offloading severely hurts performance.
                          Even one layer on CPU forces a GPU↔CPU round-trip on
                          every token. Use <Strong>Auto (all GPU)</Strong> or{' '}
                          <Strong>CPU Only</Strong>.
                        </Callout.Text>
                      </Callout.Root>
                    )}
                </Box>
              )}
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
                  disabled={isModelLoaded}
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
                  disabled={isModelLoaded}
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
                  disabled={isModelLoaded}
                />
              </Box>

              <Box>
                <Flex align="center" justify="between" mb="2">
                  <Text size="1">Thinking Budget</Text>
                  <Badge variant="outline" size="1">
                    {thinkingBudget === -1
                      ? 'Unrestricted (-1)'
                      : thinkingBudget === 0
                        ? 'Disabled (0)'
                        : thinkingBudget}
                  </Badge>
                </Flex>
                <Slider
                  value={[thinkingBudget === -1 ? 8192 : thinkingBudget]} // Max slider value visually if unrestricted
                  onValueChange={([value]) =>
                    setThinkingBudget(value >= 8192 ? -1 : value)
                  }
                  min={0}
                  max={8192}
                  step={128}
                  disabled={isModelLoaded}
                />
                <Text size="1" color="gray" mt="1">
                  Control reasoning tokens. Drag fully right for -1
                  (unrestricted). Only has an effect if the model supports it.
                </Text>
              </Box>
            </Box>
          </Box>

          {!isRemote && vramEstimate && (
            <Callout.Root size="1" color={vramEstimate.error ? 'gray' : 'blue'}>
              <Callout.Icon>
                <LightningBoltIcon />
              </Callout.Icon>
              <Callout.Text>
                {vramEstimate.error ? (
                  <>VRAM estimation unavailable: {vramEstimate.error}</>
                ) : vramEstimate.estimated_vram_bytes ? (
                  <>
                    VRAM:{' '}
                    <Strong>
                      {prettyBytes(vramEstimate.estimated_vram_bytes)}
                    </Strong>
                    {vramEstimate.context_size == null && (
                      <> using model default context</>
                    )}
                    {vramEstimate.breakdown &&
                      vramEstimate.breakdown.weights_vram_bytes +
                        vramEstimate.breakdown.kv_cache_bytes +
                        vramEstimate.breakdown.overhead_bytes >
                        0 && (
                        <>
                          {' '}
                          (
                          {prettyBytes(
                            vramEstimate.breakdown.weights_vram_bytes
                          )}{' '}
                          weights +{' '}
                          {prettyBytes(vramEstimate.breakdown.kv_cache_bytes)}{' '}
                          KV cache +{' '}
                          {prettyBytes(vramEstimate.breakdown.overhead_bytes)}{' '}
                          CUDA)
                        </>
                      )}
                    {vramEstimate.estimated_ram_bytes != null &&
                      vramEstimate.estimated_ram_bytes > 0 && (
                        <>
                          {' · '}RAM:{' '}
                          <Strong>
                            {prettyBytes(vramEstimate.estimated_ram_bytes)}
                          </Strong>{' '}
                          (CPU offload)
                        </>
                      )}
                  </>
                ) : (
                  <>VRAM data unavailable for this model</>
                )}
              </Callout.Text>
            </Callout.Root>
          )}

          {!isRemote && vramWarning && (
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
            disabled={isSaving || unloadMutation.isPending}
            className="transition-all duration-150"
          >
            <Cross2Icon /> Cancel
          </Button>
          {isModelLoaded ? (
            <Button
              color="red"
              variant="soft"
              onClick={() => unloadMutation.mutate()}
              disabled={unloadMutation.isPending}
              className="transition-all duration-150"
            >
              {unloadMutation.isPending ? (
                <>
                  <Spinner /> <Text ml="1">Unloading...</Text>
                </>
              ) : (
                <>
                  <ReloadIcon /> Unload Model to Change Settings
                </>
              )}
            </Button>
          ) : (
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
                  <CheckIcon /> Save & Load Model
                </>
              )}
            </Button>
          )}
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
