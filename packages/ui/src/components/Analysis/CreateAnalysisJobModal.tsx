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
  Badge,
  Select,
  TextField,
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
  LightningBoltIcon,
} from '@radix-ui/react-icons';
import {
  createAnalysisJob,
  fetchSession,
  fetchAvailableModels,
  fetchTemplates,
} from '../../api/api';
import type { Session, OllamaModelInfo, Template } from '../../types';
import { toastMessageAtom } from '../../store';
import { cn } from '../../utils';
import { formatIsoDateToYMD } from '../../helpers';
import prettyBytes from 'pretty-bytes';

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
  const [validationError, setValidationError] = useState<string | null>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  const [selectedModel, setSelectedModel] = useState<string>('');
  const [isTemplatePopoverOpen, setIsTemplatePopoverOpen] = useState(false);
  const [useAdvancedStrategy, setUseAdvancedStrategy] = useState(true); // Default to true

  const { data: availableModelsData, isLoading: isLoadingModels } = useQuery({
    queryKey: ['availableOllamaModels'],
    queryFn: fetchAvailableModels,
    enabled: isOpen,
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

  useEffect(() => {
    if (
      isOpen &&
      availableModelsData?.models &&
      availableModelsData.models.length > 0 &&
      !selectedModel
    ) {
      const defaultModel =
        availableModelsData.models.find((m) => m.name.includes('llama3:8b')) ||
        availableModelsData.models[0];
      setSelectedModel(defaultModel.name);
    }
  }, [isOpen, availableModelsData, selectedModel]);

  useEffect(() => {
    if (isOpen) {
      setPrompt('');
      setValidationError(null);
      setIsTemplatePopoverOpen(false);
      setUseAdvancedStrategy(true); // Reset to default
      const timer = setTimeout(() => {
        textAreaRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

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

    createJobMutation.mutate({
      sessionIds,
      prompt,
      modelName: selectedModel,
      useAdvancedStrategy,
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
                <Table.Root size="1" variant="surface">
                  <Table.Header>
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
                </Table.Root>
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

          <Flex direction="column" gap="3" mt="2">
            <Text as="div" size="2" weight="medium">
              AI Configuration
            </Text>
            <Flex gap="3" direction={{ initial: 'column', xs: 'row' }}>
              <Box style={{ flexGrow: 1 }}>
                <Text as="div" size="1" color="gray" mb="1">
                  Language Model
                </Text>
                <Select.Root
                  value={selectedModel}
                  onValueChange={setSelectedModel}
                  disabled={isMutationPending || isLoadingModels}
                >
                  <Select.Trigger
                    placeholder={
                      isLoadingModels
                        ? 'Loading models...'
                        : 'Select a model...'
                    }
                    style={{ width: '100%' }}
                  />
                  <Select.Content>
                    {availableModelsData?.models.map((model) => (
                      <Select.Item key={model.name} value={model.name}>
                        <Flex
                          justify="between"
                          align="center"
                          gap="4"
                          width="100%"
                        >
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
                                  {prettyBytes(
                                    model.defaultContextSize
                                  ).replace(' ', '')}
                                </Badge>
                              </Tooltip>
                            )}
                        </Flex>
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
              </Box>
            </Flex>
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
            disabled={isMutationPending || isLoadingSessions || isLoadingModels}
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
