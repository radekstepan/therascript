// packages/ui/src/components/Analysis/CreateAnalysisJobModal.tsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useMutation, useQueries, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useSetAtom } from 'jotai';
import {
  Dialog,
  Button,
  Flex,
  Text,
  TextArea,
  Box,
  Spinner,
  Callout,
  ScrollArea,
  TextField,
  Tooltip,
  Table,
  Checkbox,
  Strong,
} from '@radix-ui/themes';
import {
  InfoCircledIcon,
  Cross2Icon,
  CheckIcon,
  QuestionMarkCircledIcon,
  StarIcon,
  LightningBoltIcon,
} from '@radix-ui/react-icons';
import {
  createAnalysisJob,
  fetchSession,
  fetchTemplates,
  estimateModelVram,
  fetchGpuStats,
} from '../../api/api';
import type {
  Session,
  LlmModelInfo,
  Template,
  VramEstimateResponse,
} from '../../types';
import { toastMessageAtom } from '../../store';
import { cn } from '../../utils';
import { formatIsoDateToYMD } from '../../helpers';
import prettyBytes from 'pretty-bytes';
import { LlmEndpointModelPicker } from '../Shared/LlmEndpointModelPicker';

// --- Sub-component for the template picker popover ---
const TemplatePicker: React.FC<{
  onSelectTemplate: (text: string) => void;
  onClose: () => void;
}> = ({ onSelectTemplate, onClose }) => {
  const {
    data: templates,
    isLoading,
    error,
  } = useQuery<Template[], Error>({
    queryKey: ['templates'],
    queryFn: fetchTemplates,
    staleTime: 5 * 60 * 1000,
  });
  const popoverRef = useRef<HTMLDivElement>(null);

  const userTemplates = useMemo(() => {
    if (!templates) return [];
    return templates.filter(
      (template) => !template.title.startsWith('system_')
    );
  }, [templates]);

  // Close on Escape key or click outside
  useEffect(() => {
    const handler = (event: KeyboardEvent | MouseEvent) => {
      // Allow parent button to toggle the popover
      const target = event.target as HTMLElement;
      if (target.closest('[aria-label="Use Template"]')) {
        return;
      }

      if (event instanceof KeyboardEvent && event.key === 'Escape') {
        onClose();
        return;
      }
      if (event instanceof MouseEvent) {
        if (
          popoverRef.current &&
          !popoverRef.current.contains(event.target as Node)
        ) {
          onClose();
        }
      }
    };
    document.addEventListener('keydown', handler);
    document.addEventListener('mousedown', handler, true); // Use capture phase
    return () => {
      document.removeEventListener('keydown', handler);
      document.removeEventListener('mousedown', handler, true);
    };
  }, [onClose]);

  return (
    <Box
      ref={popoverRef}
      className="absolute top-0 left-0 right-0 z-10 max-h-60 overflow-hidden flex flex-col rounded-md border shadow-lg bg-[--color-panel-solid] border-[--gray-a6]"
    >
      <ScrollArea type="auto" scrollbars="vertical" style={{ flexGrow: 1 }}>
        <Box p="1">
          {isLoading ? (
            <Flex align="center" justify="center" p="4">
              <Spinner size="2" />
            </Flex>
          ) : error ? (
            <Flex p="4">
              <Text color="red" size="2">
                Error: {error.message}
              </Text>
            </Flex>
          ) : !userTemplates || userTemplates.length === 0 ? (
            <Flex align="center" justify="center" p="4">
              <Text size="2" color="gray">
                No user-created templates found.
              </Text>
            </Flex>
          ) : (
            [...userTemplates]
              .sort((a, b) => a.title.localeCompare(b.title))
              .map((template) => (
                <Button
                  key={template.id}
                  variant="ghost"
                  onClick={() => {
                    // This is now the only place that handles selection and closing
                    onSelectTemplate(template.text);
                    onClose();
                  }}
                  className="block w-full h-auto text-left p-2 text-sm rounded whitespace-normal justify-start"
                  style={{
                    whiteSpace: 'normal',
                    justifyContent: 'flex-start',
                    textAlign: 'left',
                  }}
                  title={`Insert: "${template.text.substring(0, 100)}..."`}
                  size="2"
                >
                  {template.title}
                </Button>
              ))
          )}
        </Box>
      </ScrollArea>
    </Box>
  );
};

interface CreateAnalysisJobModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  sessionIds: number[];
}

export function CreateAnalysisJobModal({
  isOpen,
  onOpenChange,
  sessionIds,
}: CreateAnalysisJobModalProps) {
  const navigate = useNavigate();
  const setToast = useSetAtom(toastMessageAtom);
  const [prompt, setPrompt] = useState('');
  const [mapPhaseSystemPrompt, setMapPhaseSystemPrompt] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  const [selectedModel, setSelectedModel] = useState<string>('');
  const [isTemplatePopoverOpen, setIsTemplatePopoverOpen] = useState(false);
  const [useAdvancedStrategy, setUseAdvancedStrategy] = useState(true); // Default to true
  const [contextSizeInput, setContextSizeInput] = useState('');
  const [userTouchedContext, setUserTouchedContext] = useState(false);
  const [vramEstimate, setVramEstimate] = useState<VramEstimateResponse | null>(
    null
  );

  // Local / Remote LLM endpoint toggle for this analysis job. The shared
  // LlmEndpointModelPicker renders the UI and owns the model-list query;
  // when the user picks a remote URL we snapshot it into the create-job
  // payload so the worker targets that endpoint. The picker persists the
  // remote URL through `remoteBaseUrlAtom` (localStorage) so it stays in
  // sync with the chat modal.
  const [isRemote, setIsRemote] = useState(false);
  const [remoteUrl, setRemoteUrl] = useState('');
  const [availableModels, setAvailableModels] = useState<LlmModelInfo[]>([]);

  const { data: gpuStats } = useQuery({
    queryKey: ['gpuStats'],
    queryFn: fetchGpuStats,
    enabled: isOpen,
    refetchInterval: 10000,
  });

  const selectedModelDetails = useMemo(
    () => availableModels.find((m) => m.name === selectedModel),
    [availableModels, selectedModel]
  );

  const sessionQueries = useQueries({
    queries: sessionIds.map((id) => ({
      queryKey: ['sessionMeta', id],
      queryFn: () => fetchSession(id),
      staleTime: Infinity,
      enabled: isOpen,
    })),
  });

  const isLoadingSessions = sessionQueries.some((q) => q.isLoading);
  const sessionData = useMemo(
    () => sessionQueries.map((q) => q.data).filter(Boolean) as Session[],
    [sessionQueries]
  );

  const maxTranscriptTokens = useMemo(() => {
    let max = 0;
    for (const s of sessionData) {
      if (s.transcriptTokenCount && s.transcriptTokenCount > max) {
        max = s.transcriptTokenCount;
      }
    }
    return max || null;
  }, [sessionData]);

  // Auto-select a default model the first time a non-empty model list
  // arrives while the modal is open. We only do this once per session so
  // that toggling Local<->Remote (or any other action that clears
  // `selectedModel` to '') leaves the picker empty until the user picks
  // a model for the new endpoint.
  const hasAutoSelectedRef = useRef(false);

  useEffect(() => {
    if (!isOpen) {
      // Reset for the next time the modal opens.
      hasAutoSelectedRef.current = false;
      return;
    }
    if (
      isOpen &&
      availableModels.length > 0 &&
      !selectedModel &&
      !hasAutoSelectedRef.current
    ) {
      const defaultModel =
        availableModels.find((m) => m.name.includes('llama3:8b')) ||
        availableModels[0];
      setSelectedModel(defaultModel.name);
      hasAutoSelectedRef.current = true;
    }
  }, [isOpen, availableModels, selectedModel]);

  const recommendedContextSize = useMemo(() => {
    if (!maxTranscriptTokens) return undefined;
    const modelMax = selectedModelDetails?.defaultContextSize ?? null;
    const base = Math.max(4096, maxTranscriptTokens + 2048);
    const rounded = Math.ceil(base / 256) * 256;
    return modelMax != null ? Math.min(rounded, modelMax) : rounded;
  }, [maxTranscriptTokens, selectedModelDetails?.defaultContextSize]);

  useEffect(() => {
    if (!isOpen) return;
    if (userTouchedContext) return;
    if (recommendedContextSize && recommendedContextSize > 0) {
      setContextSizeInput(String(recommendedContextSize));
    }
  }, [isOpen, userTouchedContext, recommendedContextSize]);

  useEffect(() => {
    if (isOpen) {
      setPrompt('');
      setMapPhaseSystemPrompt('');
      setValidationError(null);
      setIsTemplatePopoverOpen(false);
      setUseAdvancedStrategy(true); // Reset to default
      setContextSizeInput('');
      setUserTouchedContext(false);
      setVramEstimate(null);
      const timer = setTimeout(() => {
        textAreaRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  useEffect(() => {
    // VRAM is a local-machine concept; skip the estimate when the user is
    // targeting a remote endpoint. The backend's `estimate-vram` endpoint
    // 404s for remote-only models, which previously surfaced as a gray
    // "VRAM estimation unavailable" callout.
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
    estimateModelVram(selectedModel, contextSize)
      .then(setVramEstimate)
      .catch((err) => {
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
  }, [isRemote, selectedModel, selectedModelDetails, contextSizeInput]);

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

  const handleSelectTemplate = (templateText: string) => {
    setPrompt(templateText);
    textAreaRef.current?.focus();
  };

  const createJobMutation = useMutation({
    mutationFn: createAnalysisJob,
    onSuccess: (data) => {
      setToast('Analysis job has been started.');
      onOpenChange(false);
      navigate(`/analysis-jobs`);
    },
    onError: (error: Error) => {
      setValidationError(`Failed to create job: ${error.message}`);
    },
  });

  const handleSubmit = () => {
    setValidationError(null);
    if (prompt.trim().length < 10) {
      setValidationError(
        'Please enter a prompt that is at least 10 characters long.'
      );
      return;
    }
    if (sessionIds.length === 0) {
      setValidationError('No sessions selected.');
      return;
    }
    if (!selectedModel) {
      setValidationError('Please select a language model.');
      return;
    }
    if (isRemote && remoteUrl.trim().length > 0) {
      try {
        const parsed = new URL(remoteUrl.trim());
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          setValidationError(
            'Please enter a valid http:// or https:// URL for the remote LM Studio server.'
          );
          return;
        }
      } catch {
        setValidationError(
          'Please enter a valid http:// or https:// URL for the remote LM Studio server.'
        );
        return;
      }
    }

    createJobMutation.mutate({
      sessionIds,
      prompt,
      modelName: selectedModel,
      useAdvancedStrategy,
      ...(contextSizeInput
        ? { contextSize: parseInt(contextSizeInput, 10) }
        : {}),
      ...(mapPhaseSystemPrompt.trim().length > 0
        ? { mapPhaseSystemPrompt: mapPhaseSystemPrompt.trim() }
        : {}),
      // In Remote mode, snapshot the URL into the job. The worker will
      // target it for the Map/Reduce streams regardless of what the
      // backend's currently active URL is. In Local mode we omit it so
      // the backend uses the active URL.
      ...(isRemote && remoteUrl.trim().length > 0
        ? { baseUrl: remoteUrl.trim() }
        : {}),
    });
  };

  const isMutationPending = createJobMutation.isPending;

  return (
    <Dialog.Root open={isOpen} onOpenChange={onOpenChange}>
      <Dialog.Content style={{ maxWidth: 600 }}>
        <Dialog.Title>Analyze Multiple Sessions</Dialog.Title>
        <Dialog.Description size="2" mb="4">
          Ask a high-level question across all selected sessions. The AI will
          summarize each one and then synthesize a final answer.
        </Dialog.Description>

        <Flex direction="column" gap="4">
          <Box>
            <Text as="div" size="2" mb="1" weight="medium">
              Selected Sessions ({sessionIds.length})
            </Text>
            <ScrollArea
              type="auto"
              scrollbars="vertical"
              style={{
                maxHeight: '120px',
                border: '1px solid var(--gray-a5)',
                borderRadius: 'var(--radius-3)',
              }}
            >
              {isLoadingSessions ? (
                <Flex align="center" gap="2" p="2">
                  <Spinner size="1" />
                  <Text size="1" color="gray">
                    Loading session details...
                  </Text>
                </Flex>
              ) : (
                <table
                  className="rt-TableRootTable rt-sticky-table size-1"
                  style={{ width: '100%' }}
                >
                  <Table.Header
                    style={{
                      position: 'sticky',
                      top: 0,
                      zIndex: 1,
                      background: 'var(--color-panel-solid)',
                    }}
                  >
                    <Table.Row>
                      <Table.ColumnHeaderCell>
                        Session Name
                      </Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Client</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>Date</Table.ColumnHeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {sessionData.map((session) => (
                      <Table.Row key={session.id}>
                        <Table.Cell>
                          <Text truncate>
                            {session.sessionName || session.fileName}
                          </Text>
                        </Table.Cell>
                        <Table.Cell>{session.clientName}</Table.Cell>
                        <Table.Cell>
                          {formatIsoDateToYMD(session.date)}
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </table>
              )}
            </ScrollArea>
          </Box>
          <Box>
            <Flex justify="between" align="center" mb="1">
              {/* Accessible label pointing only to the textarea */}
              <Text
                as="label"
                size="2"
                weight="medium"
                htmlFor="analysisPrompt"
              >
                Analysis Prompt
              </Text>

              <Button
                size="1"
                variant="soft"
                onClick={(e) => {
                  e.stopPropagation(); // optional: guard against odd bubbling
                  setIsTemplatePopoverOpen((p) => !p);
                }}
                disabled={isMutationPending}
                aria-label="Use Template"
                className="hover:bg-[var(--gray-a5)] transition-colors"
              >
                <StarIcon width="12" height="12" />
                Use Template
              </Button>
            </Flex>

            <Box position="relative">
              <TextArea
                id="analysisPrompt" // <-- ties to the label above
                ref={textAreaRef}
                placeholder="e.g., 'What are the recurring themes of self-doubt across these sessions?'"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={isMutationPending}
                rows={5}
                style={{ minHeight: 80, resize: 'vertical' }}
              />
              {isTemplatePopoverOpen && (
                <TemplatePicker
                  onSelectTemplate={handleSelectTemplate}
                  onClose={() => setIsTemplatePopoverOpen(false)}
                />
              )}
            </Box>
          </Box>

          <Box>
            <Flex align="center" gap="2" mb="1">
              <Text
                as="label"
                size="2"
                weight="medium"
                htmlFor="mapPhaseSystemPrompt"
              >
                Map Phase System Prompt (Optional)
              </Text>
              <Tooltip content="Prepended as a system message to every per-session analysis call. Use for global instructions like reasoning style, output length, or analytical lens. Example: 'Keep your thinking brief. Focus only on explicit statements and avoid speculation.'">
                <QuestionMarkCircledIcon className="text-[--gray-a10]" />
              </Tooltip>
            </Flex>
            <TextArea
              id="mapPhaseSystemPrompt"
              placeholder="e.g., 'Keep your thinking brief (max 2 sentences). Focus on observable behaviors only.'"
              value={mapPhaseSystemPrompt}
              onChange={(e) => setMapPhaseSystemPrompt(e.target.value)}
              disabled={isMutationPending}
              rows={3}
              maxLength={2000}
              style={{ minHeight: 60, resize: 'vertical' }}
            />
            {mapPhaseSystemPrompt.length > 0 && (
              <Text
                size="1"
                color={mapPhaseSystemPrompt.length > 2000 ? 'red' : 'gray'}
                mt="1"
              >
                {mapPhaseSystemPrompt.length} / 2000
              </Text>
            )}
          </Box>

          <Flex direction="column" gap="3" mt="2">
            <Text as="div" size="2" weight="medium">
              AI Configuration
            </Text>
            <LlmEndpointModelPicker
              selectedModel={selectedModel}
              onSelectedModelChange={setSelectedModel}
              isRemote={isRemote}
              setIsRemote={setIsRemote}
              remoteUrl={remoteUrl}
              setRemoteUrl={setRemoteUrl}
              disabled={isMutationPending}
              enabled={isOpen}
              placeholder="Select a model..."
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
                  disabled={isMutationPending}
                />
              </label>
            )}

            {!isRemote && vramEstimate && (
              <Callout.Root
                size="1"
                color={vramEstimate.error ? 'gray' : 'blue'}
              >
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
            <Text as="label" size="2">
              <Flex gap="2" align="center">
                <Checkbox
                  checked={useAdvancedStrategy}
                  onCheckedChange={(checked) =>
                    setUseAdvancedStrategy(checked as boolean)
                  }
                  disabled={isMutationPending}
                  className="cursor-pointer"
                />
                Use Advanced Analysis Strategy
                <Tooltip content="When checked, the AI will create a dynamic two-step plan to better answer complex questions about trends or patterns. When unchecked, it uses a simpler, faster summarization approach.">
                  <QuestionMarkCircledIcon className="text-[--gray-a10]" />
                </Tooltip>
              </Flex>
            </Text>
          </Flex>

          {(validationError || createJobMutation.isError) && (
            <Callout.Root color="red" role="alert" size="1">
              <Callout.Icon>
                <InfoCircledIcon />
              </Callout.Icon>
              <Callout.Text>
                {validationError || createJobMutation.error?.message}
              </Callout.Text>
            </Callout.Root>
          )}
        </Flex>

        <Flex gap="3" mt="4" justify="end">
          <Dialog.Close>
            <Button
              variant="soft"
              color="gray"
              disabled={isMutationPending}
              className="hover:bg-[var(--gray-a5)] transition-colors"
            >
              <Cross2Icon /> Cancel
            </Button>
          </Dialog.Close>
          <Button
            onClick={handleSubmit}
            disabled={isMutationPending || isLoadingSessions}
            className="hover:brightness-110 transition-all"
          >
            {isMutationPending ? (
              <>
                <Spinner size="2" />
                <Text ml="2">Submitting...</Text>
              </>
            ) : (
              <>
                <CheckIcon /> Submit Analysis
              </>
            )}
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
