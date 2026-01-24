// packages/ui/src/components/StandaloneChatView/StandaloneChatHeader.tsx
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSetAtom } from 'jotai';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Flex,
  IconButton,
  DropdownMenu,
  AlertDialog,
  Button,
  Text,
  Spinner,
  Callout,
  Badge,
  Tooltip,
  Box,
  Progress,
} from '@radix-ui/themes';
import {
  DotsHorizontalIcon,
  Pencil1Icon,
  TrashIcon,
  InfoCircledIcon,
  MixerVerticalIcon,
  CheckCircledIcon,
  SymbolIcon,
  LightningBoltIcon,
  ArchiveIcon, // <-- Keep ArchiveIcon for tokens
} from '@radix-ui/react-icons';
import { EntitySelectorDropdown } from '../Shared/EntitySelectorDropdown';
import { EditStandaloneChatModal } from './EditStandaloneChatModal';
import { fetchStandaloneChats, deleteStandaloneChat } from '../../api/api';
import type {
  StandaloneChatListItem,
  OllamaStatus,
  UIContextUsageResponse,
} from '../../types';
import { toastMessageAtom } from '../../store';
import { fetchStandaloneContextUsage } from '../../api/chat';
import { formatTimestamp } from '../../helpers';
import { cn } from '../../utils';
import prettyBytes from 'pretty-bytes'; // Added for VRAM usage display

interface StandaloneChatHeaderProps {
  activeChatId: number | null;
  ollamaStatus: OllamaStatus | undefined;
  isLoadingOllamaStatus: boolean;
  onOpenLlmModal: () => void;
  latestPromptTokens?: number | null;
  latestCompletionTokens?: number | null;
}

export function StandaloneChatHeader({
  activeChatId,
  ollamaStatus,
  isLoadingOllamaStatus,
  onOpenLlmModal,
  latestPromptTokens,
  latestCompletionTokens,
}: StandaloneChatHeaderProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setToast = useSetAtom(toastMessageAtom);

  const {
    data: standaloneChats,
    isLoading: isLoadingChats,
    error: chatsError,
  } = useQuery<StandaloneChatListItem[], Error>({
    queryKey: ['standaloneChats'],
    queryFn: fetchStandaloneChats,
    staleTime: 60 * 1000,
  });

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [chatToEdit, setChatToEdit] = useState<StandaloneChatListItem | null>(
    null
  );

  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [chatToDelete, setChatToDelete] =
    useState<StandaloneChatListItem | null>(null);

  const activeChat = standaloneChats?.find((c) => c.id === activeChatId);

  const deleteChatMutation = useMutation<{ message: string }, Error, number>({
    mutationFn: deleteStandaloneChat,
    onSuccess: (data, deletedChatId) => {
      setToast(data.message || `Chat ${deletedChatId} deleted.`);
      queryClient.invalidateQueries({ queryKey: ['standaloneChats'] });
      queryClient.removeQueries({
        queryKey: ['standaloneChat', deletedChatId],
      });
      setIsDeleteConfirmOpen(false);
      setChatToDelete(null);
      navigate(`/chats-list`, { replace: true });
    },
    onError: (error) => setToast(`Error deleting chat: ${error.message}`),
  });

  const handleChatSelect = (chatId: number) => {
    navigate(`/chats/${chatId}`);
  };

  const handleOpenEditModal = () => {
    if (activeChat) {
      setChatToEdit(activeChat);
      setIsEditModalOpen(true);
    }
  };

  const handleOpenDeleteConfirm = () => {
    if (activeChat) {
      setChatToDelete(activeChat);
      setIsDeleteConfirmOpen(true);
    }
  };

  const modelName = ollamaStatus?.activeModel ?? 'No Model Selected';
  const isLoaded = ollamaStatus?.loaded ?? false;
  const isActiveModelLoaded =
    isLoaded && ollamaStatus?.modelChecked === ollamaStatus?.activeModel;
  const configuredContextSize = ollamaStatus?.configuredContextSize;
  const activeModelDefaultContextSize =
    ollamaStatus?.details?.name === ollamaStatus?.activeModel
      ? ollamaStatus?.details?.defaultContextSize
      : null;

  // --- CALCULATE VRAM USAGE STRING ---
  let vramUsageString = '';
  if (isActiveModelLoaded && ollamaStatus?.details) {
    const sizeVram = ollamaStatus.details.size_vram || 0;
    vramUsageString = ` | VRAM: ${prettyBytes(sizeVram)}`;
    const totalSize = ollamaStatus.details.size;
    if (totalSize > 0) {
      const pct = Math.round((sizeVram / totalSize) * 100);
      if (pct < 100) {
        vramUsageString += ` (${pct}% GPU)`;
      } else {
        vramUsageString += ` (100% GPU)`;
      }
    }
  }
  // --- END VRAM USAGE STRING ---

  // --- FETCH CONTEXT USAGE (standalone chats) ---
  const { data: contextUsage } = useQuery<
    UIContextUsageResponse | undefined,
    Error
  >({
    queryKey: [
      'contextUsage',
      'standalone',
      activeChatId,
      configuredContextSize ?? 'default',
    ],
    queryFn: () => fetchStandaloneContextUsage(activeChatId!),
    enabled: !!activeChatId,
    staleTime: 15 * 1000,
    refetchOnWindowFocus: true,
  });

  // --- CONTEXT USAGE WARNING & METER ---
  const effectiveModelContextSize =
    contextUsage?.model.effectiveContextSize ||
    configuredContextSize ||
    activeModelDefaultContextSize;

  let contextUsagePercentage: number | null = null;
  if (
    contextUsage?.totals.percentUsed !== null &&
    contextUsage?.totals.percentUsed !== undefined
  ) {
    contextUsagePercentage = Math.round(
      (contextUsage.totals.percentUsed || 0) * 100
    );
  }

  // Fallback: compute prompt tokens locally from breakdown if server percentUsed is null
  const fallbackPromptTokens: number | null = (() => {
    if (!contextUsage) return null;
    const parts: Array<number> = [];
    if (typeof contextUsage.breakdown.systemTokens === 'number')
      parts.push(contextUsage.breakdown.systemTokens);
    if (typeof contextUsage.breakdown.chatHistoryTokens === 'number')
      parts.push(contextUsage.breakdown.chatHistoryTokens);
    if (typeof contextUsage.breakdown.inputDraftTokens === 'number')
      parts.push(contextUsage.breakdown.inputDraftTokens);
    // transcriptTokens are not used for standalone
    if (parts.length === 0) return null;
    return parts.reduce((a, b) => a + b, 0);
  })();

  if (
    contextUsagePercentage === null &&
    fallbackPromptTokens !== null &&
    typeof effectiveModelContextSize === 'number' &&
    effectiveModelContextSize > 0
  ) {
    contextUsagePercentage = Math.min(
      100,
      Math.round((fallbackPromptTokens / effectiveModelContextSize) * 100)
    );
  }

  const showContextWarning =
    (contextUsagePercentage !== null && contextUsagePercentage > 75) ||
    (() => {
      if (!contextUsage) return false;
      const prompt =
        contextUsage.totals.promptTokens ?? fallbackPromptTokens ?? null;
      if (prompt == null) return false;
      if (
        typeof effectiveModelContextSize !== 'number' ||
        effectiveModelContextSize <= 0
      )
        return false;
      const projected = prompt + contextUsage.reserved.outputTokens;
      return projected > effectiveModelContextSize;
    })();

  // Clamp progress value to [0, 100] and allow null for indeterminate
  const progressValue: number | null = (() => {
    if (
      typeof contextUsagePercentage !== 'number' ||
      !Number.isFinite(contextUsagePercentage)
    )
      return null;
    return Math.max(0, Math.min(100, contextUsagePercentage));
  })();

  const renderStatusBadge = () => {
    if (isLoadingOllamaStatus) return <Spinner size="1" />;
    if (!ollamaStatus?.activeModel)
      return <SymbolIcon className="text-yellow-500" width="14" height="14" />;
    if (isActiveModelLoaded)
      return (
        <CheckCircledIcon className="text-green-600" width="14" height="14" />
      );
    return <SymbolIcon className="text-gray-500" width="14" height="14" />;
  };

  let statusTooltipContent = 'Loading status...';
  if (!isLoadingOllamaStatus) {
    if (!ollamaStatus?.activeModel) {
      statusTooltipContent =
        'No AI model selected. Click "Configure Model" to choose one.';
    } else if (isActiveModelLoaded) {
      statusTooltipContent = `Active Model: ${modelName} (Loaded)${vramUsageString}`;
    } else {
      statusTooltipContent = `Active Model: ${modelName} (Not loaded or unavailable)`;
    }
  }

  const totalTokens = (latestPromptTokens ?? 0) + (latestCompletionTokens ?? 0);

  const isLoadingAny =
    isLoadingChats || deleteChatMutation.isPending || isLoadingOllamaStatus;

  return (
    <>
      <Flex
        direction="column"
        className="bg-white/70 dark:bg-slate-950/70 backdrop-blur-md border-b border-slate-200 dark:border-slate-800"
        style={{ flexShrink: 0 }}
      >
        <Flex
          align="center"
          gap="2"
          className={cn('px-4 md:px-6 lg:px-8', 'py-2')}
        >
          <Flex align="center" gap="1" style={{ flexGrow: 1, minWidth: 0 }}>
            <EntitySelectorDropdown
              items={standaloneChats || []}
              activeItemId={activeChatId}
              onItemSelect={handleChatSelect}
              placeholderText="Select a Chat..."
              entityTypeLabel="Chat"
              disabled={isLoadingAny}
            />
            <DropdownMenu.Root>
              <DropdownMenu.Trigger>
                <IconButton
                  variant="ghost"
                  color="gray"
                  size="1"
                  disabled={!activeChat || isLoadingAny}
                  title="Chat Actions"
                >
                  <DotsHorizontalIcon />
                </IconButton>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="end">
                <DropdownMenu.Item
                  onSelect={handleOpenEditModal}
                  disabled={!activeChat || deleteChatMutation.isPending}
                >
                  <Pencil1Icon className="mr-1" /> Edit Details
                </DropdownMenu.Item>
                <DropdownMenu.Separator />
                <DropdownMenu.Item
                  color="red"
                  onSelect={handleOpenDeleteConfirm}
                  disabled={!activeChat || deleteChatMutation.isPending}
                >
                  <TrashIcon className="mr-1" /> Delete Chat
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          </Flex>

          <Flex align="center" gap="2" flexShrink="0">
            <Tooltip content={statusTooltipContent}>
              <Flex align="center" gap="1">
                {renderStatusBadge()}
              </Flex>
            </Tooltip>
            {ollamaStatus?.activeModel && (
              <Tooltip
                content={
                  `Configured Context: ${configuredContextSize ? configuredContextSize.toLocaleString() : 'Default'}` +
                  (activeModelDefaultContextSize
                    ? ` (Model Max: ${activeModelDefaultContextSize.toLocaleString()})`
                    : '')
                }
              >
                <Badge
                  variant="soft"
                  color={configuredContextSize ? 'blue' : 'gray'}
                  size="1"
                  className={cn(isLoadingOllamaStatus ? 'opacity-50' : '')}
                >
                  <LightningBoltIcon
                    width="14"
                    height="14"
                    style={{ marginRight: '2px' }}
                  />
                  {isLoadingOllamaStatus
                    ? '...'
                    : configuredContextSize
                      ? configuredContextSize.toLocaleString()
                      : 'Default'}
                </Badge>
              </Tooltip>
            )}

            {/* --- CONTEXT METER --- */}
            {effectiveModelContextSize && (
              <Tooltip
                content={
                  contextUsage
                    ? (() => {
                        const prompt =
                          contextUsage.totals.promptTokens ??
                          fallbackPromptTokens ??
                          '?';
                        const eff = effectiveModelContextSize ?? '?';
                        const reserved = contextUsage.reserved.outputTokens;
                        const projected =
                          typeof prompt === 'number' && typeof eff === 'number'
                            ? prompt + reserved
                            : '?';
                        const overflow =
                          typeof projected === 'number' &&
                          typeof eff === 'number' &&
                          projected > eff;
                        return (
                          `Prompt: ${prompt} / ${eff} tokens` +
                          `\nReserved Output: ${reserved}` +
                          `\nProjected: ${projected} / ${eff}${overflow ? ' (will exceed)' : ''}` +
                          `\nBreakdown — System: ${contextUsage.breakdown.systemTokens ?? '?'}, Chat: ${contextUsage.breakdown.chatHistoryTokens ?? '?'}, Input: ${contextUsage.breakdown.inputDraftTokens ?? 0}`
                        );
                      })()
                    : 'Estimating context usage...'
                }
              >
                <Box style={{ minWidth: 140 }}>
                  <Progress
                    size="1"
                    value={progressValue}
                    max={100}
                    variant={
                      progressValue !== null && contextUsage
                        ? (() => {
                            const warnAt = contextUsage.thresholds.warnAt * 100;
                            const dangerAt =
                              contextUsage.thresholds.dangerAt * 100;
                            if (progressValue >= dangerAt) return 'surface';
                            if (progressValue >= warnAt) return 'classic';
                            return 'soft';
                          })()
                        : 'soft'
                    }
                  />
                </Box>
              </Tooltip>
            )}
            {/* Display Last Interaction Tokens */}
            {(latestPromptTokens !== null ||
              latestCompletionTokens !== null) && (
              <Tooltip
                content={`Last Interaction: ${latestPromptTokens?.toLocaleString() ?? '?'} Input + ${latestCompletionTokens?.toLocaleString() ?? '?'} Output Tokens`}
              >
                <Badge variant="soft" color="gray" highContrast>
                  <ArchiveIcon
                    width="14"
                    height="14"
                    style={{ marginRight: '4px', opacity: 0.8 }}
                  />
                  <Text size="1">{totalTokens.toLocaleString()} Tokens</Text>
                </Badge>
              </Tooltip>
            )}
            <Button
              variant="soft"
              size="1"
              onClick={onOpenLlmModal}
              title="Configure AI Model"
              disabled={isLoadingAny}
            >
              <MixerVerticalIcon width="14" height="14" />
            </Button>
          </Flex>
        </Flex>
      </Flex>

      <EditStandaloneChatModal
        isOpen={isEditModalOpen}
        onOpenChange={setIsEditModalOpen}
        chat={chatToEdit}
      />

      <AlertDialog.Root
        open={isDeleteConfirmOpen}
        onOpenChange={(open) => {
          if (!open) {
            setIsDeleteConfirmOpen(false);
            setChatToDelete(null);
            deleteChatMutation.reset();
          }
        }}
      >
        <AlertDialog.Content style={{ maxWidth: 450 }}>
          <AlertDialog.Title>Delete Chat</AlertDialog.Title>
          <AlertDialog.Description size="2">
            Are you sure you want to delete "
            <Text weight="bold">
              {chatToDelete?.name ||
                `Chat (${formatTimestamp(chatToDelete?.timestamp || 0)})`}
            </Text>
            "? This action cannot be undone.
          </AlertDialog.Description>
          {deleteChatMutation.isError && (
            <Callout.Root color="red" size="1" my="2">
              <Callout.Icon>
                <InfoCircledIcon />
              </Callout.Icon>
              <Callout.Text>{deleteChatMutation.error.message}</Callout.Text>
            </Callout.Root>
          )}
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button
                variant="soft"
                color="gray"
                disabled={deleteChatMutation.isPending}
                className="transition-all duration-150"
              >
                Cancel
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button
                color="red"
                onClick={() =>
                  chatToDelete && deleteChatMutation.mutate(chatToDelete.id)
                }
                disabled={deleteChatMutation.isPending}
                className="transition-all duration-150"
              >
                {deleteChatMutation.isPending ? (
                  <Spinner size="1" />
                ) : (
                  <TrashIcon />
                )}
                <Text ml="1">Delete</Text>
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </>
  );
}
