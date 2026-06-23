// packages/ui/src/components/Shared/LlmSettingsForm.tsx
//
// Shared LLM configuration form (model picker, context size, sampling
// parameters, GPU layers, thinking budget, VRAM estimation, load/unload
// guards). Used as a controlled child by:
//
//   - SelectActiveModelModal (Configure AI Model dialog) — to set the chat's
//     active model and endpoint.
//   - CreateAnalysisJobModal (Analyze Multiple Sessions dialog) — to choose
//     which model + endpoint + sampling params a one-off analysis job should
//     use.
//
// The parent owns `state` and updates it via the `onChange` updater
// (compatible with React's `useState` setter signature).
import React, { useMemo, useEffect } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import {
  Flex,
  Text,
  Box,
  TextField,
  Slider,
  Callout,
  Strong,
  Badge,
  Button,
  Spinner,
} from '@radix-ui/themes';
import {
  LightningBoltIcon,
  InfoCircledIcon,
  ReloadIcon,
} from '@radix-ui/react-icons';
import prettyBytes from 'pretty-bytes';
import { LlmEndpointModelPicker } from './LlmEndpointModelPicker';
import {
  estimateModelVram,
  fetchGpuStats,
  unloadLlmModel,
} from '../../api/api';
import type {
  LlmModelInfo,
  LlmStatus,
  VramEstimateResponse,
} from '../../types';

export interface LlmSettingsState {
  selectedModel: string;
  contextSizeInput: string;
  isRemote: boolean;
  remoteUrl: string;
  temperature: number;
  topP: number;
  repeatPenalty: number;
  numGpuLayers?: number | null;
  thinkingBudget: number;
}

interface LlmSettingsFormProps {
  llmStatus?: LlmStatus;
  activeTranscriptTokens?: number | null;
  state: LlmSettingsState;
  onChange: (updater: (prev: LlmSettingsState) => LlmSettingsState) => void;
  isOpen: boolean;
  isSaving?: boolean;
}

export function LlmSettingsForm({
  llmStatus,
  activeTranscriptTokens,
  state,
  onChange,
  isOpen,
  isSaving,
}: LlmSettingsFormProps) {
  const queryClient = useQueryClient();
  const [availableModels, setAvailableModels] = React.useState<LlmModelInfo[]>(
    []
  );
  const [vramEstimate, setVramEstimate] =
    React.useState<VramEstimateResponse | null>(null);
  const [userTouchedContext, setUserTouchedContext] = React.useState(false);

  const { data: gpuStats } = useQuery({
    queryKey: ['gpuStats'],
    queryFn: fetchGpuStats,
    enabled: isOpen,
    refetchInterval: 10000,
  });

  const unloadMutation = useMutation({
    mutationFn: unloadLlmModel,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['llmStatus'] });
    },
    onError: (err: Error) => {
      console.error(`Failed to unload model: ${err.message}`);
    },
  });

  const isModelLoaded = llmStatus?.loaded === true;
  const isUnloading = unloadMutation.isPending;

  const selectedModelDetails = useMemo(
    () => availableModels.find((m) => m.name === state.selectedModel),
    [availableModels, state.selectedModel]
  );

  const effectiveContextSize =
    state.contextSizeInput && parseInt(state.contextSizeInput, 10) > 0
      ? parseInt(state.contextSizeInput, 10)
      : selectedModelDetails?.defaultContextSize;

  const isContextSufficient = activeTranscriptTokens
    ? effectiveContextSize
      ? activeTranscriptTokens < effectiveContextSize
      : true
    : true;

  // Reset GPU layers + sampling defaults when the user picks a model that
  // no longer exists in the available list. The `availableModels.length > 0`
  // guard prevents clearing the pre-selected model on initial render
  // before the picker's query has loaded.
  useEffect(() => {
    if (!isOpen) return;
    if (!state.selectedModel) return;
    if (availableModels.length === 0) return;
    if (selectedModelDetails) return;
    onChange((prev) => ({ ...prev, selectedModel: '' }));
    setVramEstimate(null);
  }, [
    isOpen,
    state.selectedModel,
    selectedModelDetails,
    availableModels.length,
    onChange,
  ]);

  // When the user picks a model that isn't the active one, reset the
  // sampling/loading params to defaults. This mirrors the original
  // SelectActiveModelModal behavior.
  useEffect(() => {
    if (state.selectedModel !== llmStatus?.activeModel) {
      onChange((prev) => ({
        ...prev,
        numGpuLayers: undefined,
        temperature: 0.7,
        topP: 0.9,
        repeatPenalty: 1.1,
        thinkingBudget: -1,
      }));
      setUserTouchedContext(false);
    }
  }, [state.selectedModel, llmStatus?.activeModel, onChange]);

  // --- Recommended Context Size (avoid max by default) ---
  const recommendedContextSize = useMemo(() => {
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
      onChange((prev) => ({
        ...prev,
        contextSizeInput: String(recommendedContextSize),
      }));
    }
  }, [isOpen, userTouchedContext, recommendedContextSize, onChange]);

  // Update VRAM estimate when model or context size changes. VRAM is a
  // local-machine concept, so we skip the estimate entirely when the user
  // is targeting a remote endpoint — there's no local GPU to size against
  // and the backend's `estimate-vram` endpoint 404s for remote-only models.
  // The AbortController cancels in-flight requests when dependencies change
  // so stale responses can't overwrite the latest one.
  useEffect(() => {
    if (state.isRemote) {
      setVramEstimate(null);
      return;
    }
    if (!state.selectedModel || !selectedModelDetails) {
      setVramEstimate(null);
      return;
    }

    const trimmedContextSize = state.contextSizeInput.trim();
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
      state.selectedModel,
      contextSize,
      state.numGpuLayers,
      controller.signal,
      llmStatus?.defaultBaseUrl
    )
      .then((data) => {
        if (controller.signal.aborted) return;
        setVramEstimate(data);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setVramEstimate({
          model: state.selectedModel,
          context_size: contextSize,
          estimated_vram_bytes: null,
          estimated_ram_bytes: null,
          vram_per_token_bytes: null,
          error: err.message,
        });
      });
    return () => controller.abort();
  }, [
    state.isRemote,
    state.selectedModel,
    selectedModelDetails,
    state.contextSizeInput,
    state.numGpuLayers,
    llmStatus?.defaultBaseUrl,
  ]);

  // Calculate VRAM warning based on available GPU memory
  const vramWarning = useMemo(() => {
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

  const handleContextChange = (value: string) => {
    onChange((prev) => ({ ...prev, contextSizeInput: value }));
    setUserTouchedContext(true);
  };

  return (
    <Flex direction="column" gap="4">
      {isModelLoaded && llmStatus?.activeModel !== 'default' && (
        <Callout.Root color="blue" size="1">
          <Callout.Icon>
            <InfoCircledIcon />
          </Callout.Icon>
          <Callout.Text>
            <Flex align="center" gap="3" justify="between">
              <Text>
                Model <Strong>{llmStatus?.activeModel}</Strong> is currently
                loaded in memory. Unload it to change settings.
              </Text>
              <Button
                color="red"
                variant="soft"
                size="1"
                onClick={() => unloadMutation.mutate()}
                disabled={isUnloading}
                className="transition-all duration-150"
              >
                {isUnloading ? (
                  <>
                    <Spinner /> <Text ml="1">Unloading...</Text>
                  </>
                ) : (
                  <>
                    <ReloadIcon /> Unload
                  </>
                )}
              </Button>
            </Flex>
          </Callout.Text>
        </Callout.Root>
      )}

      <LlmEndpointModelPicker
        selectedModel={state.selectedModel}
        onSelectedModelChange={(val) =>
          onChange((prev) => ({ ...prev, selectedModel: val }))
        }
        isRemote={state.isRemote}
        setIsRemote={(val) => onChange((prev) => ({ ...prev, isRemote: val }))}
        remoteUrl={state.remoteUrl}
        setRemoteUrl={(val) =>
          onChange((prev) => ({ ...prev, remoteUrl: val }))
        }
        localBaseUrl={llmStatus?.defaultBaseUrl ?? ''}
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
            value={state.contextSizeInput}
            onChange={(e) => handleContextChange(e.target.value)}
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
                  {state.numGpuLayers == null ||
                  state.numGpuLayers >=
                    selectedModelDetails.architecture.num_layers!
                    ? `Auto (all GPU)`
                    : state.numGpuLayers === 0
                      ? 'CPU Only'
                      : `${state.numGpuLayers} / ${selectedModelDetails.architecture.num_layers}`}
                </Badge>
              </Flex>
              <Slider
                value={[
                  state.numGpuLayers ??
                    selectedModelDetails.architecture.num_layers!,
                ]}
                onValueChange={([value]) => {
                  const max = selectedModelDetails.architecture!.num_layers!;
                  // Treat max as "auto" (undefined = let Llm decide)
                  onChange((prev) => ({
                    ...prev,
                    numGpuLayers: value >= max ? undefined : value,
                  }));
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
              {state.numGpuLayers != null &&
                state.numGpuLayers > 0 &&
                state.numGpuLayers <
                  selectedModelDetails.architecture.num_layers! && (
                  <Callout.Root size="1" color="amber" mt="2">
                    <Callout.Icon>
                      <InfoCircledIcon />
                    </Callout.Icon>
                    <Callout.Text>
                      Partial GPU offloading severely hurts performance. Even
                      one layer on CPU forces a GPU↔CPU round-trip on every
                      token. Use <Strong>Auto (all GPU)</Strong> or{' '}
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
                {state.temperature.toFixed(1)}
              </Badge>
            </Flex>
            <Slider
              value={[state.temperature]}
              onValueChange={([value]) =>
                onChange((prev) => ({ ...prev, temperature: value }))
              }
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
                {state.topP.toFixed(2)}
              </Badge>
            </Flex>
            <Slider
              value={[state.topP]}
              onValueChange={([value]) =>
                onChange((prev) => ({ ...prev, topP: value }))
              }
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
                {state.repeatPenalty.toFixed(1)}
              </Badge>
            </Flex>
            <Slider
              value={[state.repeatPenalty]}
              onValueChange={([value]) =>
                onChange((prev) => ({ ...prev, repeatPenalty: value }))
              }
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
                {state.thinkingBudget === -1
                  ? 'Unrestricted (-1)'
                  : state.thinkingBudget === 0
                    ? 'Disabled (0)'
                    : state.thinkingBudget}
              </Badge>
            </Flex>
            <Slider
              value={[
                state.thinkingBudget === -1 ? 8192 : state.thinkingBudget,
              ]}
              onValueChange={([value]) =>
                onChange((prev) => ({
                  ...prev,
                  thinkingBudget: value >= 8192 ? -1 : value,
                }))
              }
              min={0}
              max={8192}
              step={128}
              disabled={isModelLoaded}
            />
            <Text size="1" color="gray" mt="1">
              Control reasoning tokens. Drag fully right for -1 (unrestricted).
              Only has an effect if the model supports it.
            </Text>
          </Box>
        </Box>
      </Box>

      {!state.isRemote && vramEstimate && (
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
                      ({prettyBytes(
                        vramEstimate.breakdown.weights_vram_bytes
                      )}{' '}
                      weights +{' '}
                      {prettyBytes(vramEstimate.breakdown.kv_cache_bytes)} KV
                      cache +{' '}
                      {prettyBytes(vramEstimate.breakdown.overhead_bytes)} CUDA)
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

      {!state.isRemote && vramWarning && (
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
        <Callout.Root size="1" color={isContextSufficient ? 'gray' : 'amber'}>
          <Callout.Icon>
            <InfoCircledIcon />
          </Callout.Icon>
          <Callout.Text>
            Transcript requires ~
            <Strong> {activeTranscriptTokens.toLocaleString()}</Strong> tokens.{' '}
            {recommendedContextSize ? (
              <>
                Recommended context:{' '}
                <Strong>{recommendedContextSize.toLocaleString()}</Strong>.
              </>
            ) : null}
          </Callout.Text>
        </Callout.Root>
      )}
    </Flex>
  );
}
