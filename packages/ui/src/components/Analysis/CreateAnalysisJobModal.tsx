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
  Tooltip,
  Table,
  Checkbox,
} from '@radix-ui/themes';
import {
  InfoCircledIcon,
  Cross2Icon,
  CheckIcon,
  QuestionMarkCircledIcon,
  StarIcon,
} from '@radix-ui/react-icons';
import {
  createAnalysisJob,
  fetchSession,
  fetchTemplates,
  fetchLlmStatus,
} from '../../api/api';
import type { Session, LlmStatus, Template } from '../../types';
import { toastMessageAtom } from '../../store';
import { cn } from '../../utils';
import { formatIsoDateToYMD } from '../../helpers';
import {
  LlmSettingsForm,
  type LlmSettingsState,
} from '../Shared/LlmSettingsForm';

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

  const [isTemplatePopoverOpen, setIsTemplatePopoverOpen] = useState(false);
  const [useAdvancedStrategy, setUseAdvancedStrategy] = useState(true); // Default to true

  const [formState, setFormState] = useState<LlmSettingsState>({
    selectedModel: '',
    contextSizeInput: '',
    isRemote: false,
    remoteUrl: '',
    temperature: 0.7,
    topP: 0.9,
    repeatPenalty: 1.1,
    numGpuLayers: undefined,
    thinkingBudget: -1,
  });

  // Fetch the currently active LLM model + context size. `staleTime: 0`
  // guarantees a fresh GET /api/llm/status on every open — we never want
  // a cached "model A" leaking into the picker after the user has loaded
  // "model B" in the chat. The query is local to the modal (not lifted
  // into the parent page) so no other view can poison the cache.
  const { data: llmStatus } = useQuery<LlmStatus, Error>({
    queryKey: ['llmStatus'],
    queryFn: () => fetchLlmStatus(),
    enabled: isOpen,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

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

  // Snapshot the backend's currently active model + context size into the
  // form once per open-cycle, and reset ephemeral fields. The effect waits
  // for `llmStatus` to land before initializing, because the local useQuery
  // refetches on every open (staleTime: 0) and `llmStatus` is `undefined`
  // during the in-flight request.
  const prevIsOpenRef = useRef(false);
  useEffect(() => {
    if (!isOpen) {
      prevIsOpenRef.current = false;
      return;
    }
    if (prevIsOpenRef.current) return; // already initialized this open
    if (!llmStatus) return; // wait for the fresh /api/llm/status to land
    prevIsOpenRef.current = true;

    // Reset ephemeral prompt/strategy fields every time we open.
    setPrompt('');
    setMapPhaseSystemPrompt('');
    setValidationError(null);
    setIsTemplatePopoverOpen(false);
    setUseAdvancedStrategy(true); // Reset to default

    setFormState({
      selectedModel:
        llmStatus.activeModel && llmStatus.activeModel !== 'default'
          ? llmStatus.activeModel
          : '',
      contextSizeInput: llmStatus.configuredContextSize
        ? String(llmStatus.configuredContextSize)
        : '',
      isRemote: llmStatus.isRemoteBaseUrl ?? false,
      remoteUrl:
        (llmStatus.isRemoteBaseUrl ? llmStatus.activeBaseUrl : '') ?? '',
      temperature: llmStatus.configuredTemperature ?? 0.7,
      topP: llmStatus.configuredTopP ?? 0.9,
      repeatPenalty: llmStatus.configuredRepeatPenalty ?? 1.1,
      numGpuLayers:
        llmStatus.configuredNumGpuLayers != null
          ? llmStatus.configuredNumGpuLayers
          : undefined,
      thinkingBudget: llmStatus.configuredThinkingBudget ?? -1,
    });

    const timer = setTimeout(() => {
      textAreaRef.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, [isOpen, llmStatus]);

  const isValidHttpUrl = React.useCallback((value: string): boolean => {
    try {
      const parsed = new URL(value.trim());
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }, []);

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
    if (!formState.selectedModel) {
      setValidationError('Please select a model.');
      return;
    }

    let baseUrl: string | null = null;
    if (formState.isRemote) {
      const trimmed = formState.remoteUrl.trim();
      if (!isValidHttpUrl(trimmed)) {
        setValidationError(
          'Please enter a valid http(s) URL for the remote LM Studio server.'
        );
        return;
      }
      baseUrl = trimmed;
    }

    const contextSize = formState.contextSizeInput
      ? parseInt(formState.contextSizeInput, 10)
      : null;
    if (
      formState.contextSizeInput &&
      (isNaN(contextSize!) || contextSize! <= 0)
    ) {
      setValidationError('Context size must be a positive number if provided.');
      return;
    }

    createJobMutation.mutate({
      sessionIds,
      prompt,
      modelName: formState.selectedModel,
      useAdvancedStrategy,
      ...(contextSize ? { contextSize } : {}),
      ...(mapPhaseSystemPrompt.trim().length > 0
        ? { mapPhaseSystemPrompt: mapPhaseSystemPrompt.trim() }
        : {}),
      ...(baseUrl ? { baseUrl } : {}),
      temperature: formState.temperature,
      topP: formState.topP,
      repeatPenalty: formState.repeatPenalty,
      numGpuLayers: formState.numGpuLayers ?? null,
      thinkingBudget: formState.thinkingBudget,
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
                  className={cn('rt-TableRootTable rt-sticky-table size-1')}
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

            <LlmSettingsForm
              llmStatus={llmStatus}
              activeTranscriptTokens={maxTranscriptTokens}
              state={formState}
              onChange={setFormState}
              isOpen={isOpen}
              isSaving={isMutationPending}
            />

            <Text as="label" size="2" mt="2">
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
            disabled={
              isMutationPending || isLoadingSessions || !formState.selectedModel
            }
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
