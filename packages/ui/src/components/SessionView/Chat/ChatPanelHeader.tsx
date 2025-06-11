// packages/ui/src/components/SessionView/Chat/ChatPanelHeader.tsx
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Flex,
  Text,
  Badge,
  Button,
  Tooltip,
  Box,
  Spinner,
  DropdownMenu,
  IconButton,
  AlertDialog,
  TextField,
  Callout, // Added Callout
} from '@radix-ui/themes';
import {
  MixerVerticalIcon,
  InfoCircledIcon, // Keep for general info
  ExclamationTriangleIcon, // <-- For warning Callout
  CheckCircledIcon,
  SymbolIcon,
  LightningBoltIcon,
  ArchiveIcon,
  DotsHorizontalIcon,
  PlusCircledIcon,
  Pencil1Icon,
  TrashIcon,
  Cross1Icon,
  CheckIcon,
  ReaderIcon, // For transcript tokens
} from '@radix-ui/react-icons';
import type { OllamaStatus, Session, ChatSession } from '../../../types';
import { cn } from '../../../utils';
import { EntitySelectorDropdown } from '../../Shared/EntitySelectorDropdown';
import { EditEntityModal } from '../../Shared/EditEntityModal';
import {
  startSessionChat,
  renameSessionChat,
  deleteSessionChat,
  fetchSessionChatDetails,
} from '../../../api/api';
import { useSetAtom } from 'jotai';
import { toastMessageAtom } from '../../../store';
import { formatTimestamp } from '../../../helpers';

const PADDING_ESTIMATE = 1500; // Estimated tokens for chat history, prompts, and response

interface ChatPanelHeaderProps {
  session: Session;
  activeChatId: number | null;
  ollamaStatus: OllamaStatus | undefined;
  isLoadingOllamaStatus: boolean;
  latestPromptTokens: number | null;
  latestCompletionTokens: number | null;
  onOpenLlmModal: () => void;
  transcriptTokenCount?: number | null; // <-- ADDED
  activeModelDefaultContextSize?: number | null; // <-- ADDED
}

interface ChatRenameFormState {
  name: string;
}

export function ChatPanelHeader({
  session,
  activeChatId,
  ollamaStatus,
  isLoadingOllamaStatus,
  latestPromptTokens,
  latestCompletionTokens,
  onOpenLlmModal,
  transcriptTokenCount, // <-- DESTRUCTURED
  activeModelDefaultContextSize, // <-- DESTRUCTURED
}: ChatPanelHeaderProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const setToast = useSetAtom(toastMessageAtom);

  const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
  const [chatToEdit, setChatToEdit] = useState<ChatSession | null>(null);

  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [chatToDelete, setChatToDelete] = useState<ChatSession | null>(null);

  const activeChat = session.chats.find((c) => c.id === activeChatId);

  const startNewChatMutation = useMutation<ChatSession, Error>({
    mutationFn: () => startSessionChat(session.id),
    onSuccess: (newChat) => {
      setToast('New chat started.');
      queryClient.setQueryData<Session>(
        ['sessionMeta', session.id],
        (oldData) => {
          if (!oldData) return oldData;
          return { ...oldData, chats: [...(oldData.chats || []), newChat] };
        }
      );
      queryClient.prefetchQuery({
        queryKey: ['chat', session.id, newChat.id],
        queryFn: () => fetchSessionChatDetails(session.id, newChat.id),
      });
      navigate(`/sessions/${session.id}/chats/${newChat.id}`);
    },
    onError: (error) => setToast(`Error starting chat: ${error.message}`),
  });

  const renameChatMutation = useMutation<
    ChatSession,
    Error,
    { chatId: number; formState: ChatRenameFormState }
  >({
    mutationFn: ({ chatId, formState }) =>
      renameSessionChat(session.id, chatId, formState.name.trim() || null),
    onSuccess: (updatedChat) => {
      setToast('Chat renamed successfully.');
      queryClient.invalidateQueries({ queryKey: ['sessionMeta', session.id] });
      queryClient.invalidateQueries({
        queryKey: ['chat', session.id, updatedChat.id],
      });
      setIsRenameModalOpen(false);
      setChatToEdit(null);
    },
    onError: (error) => {
      console.error('Rename chat failed:', error);
    },
  });

  const deleteChatMutation = useMutation<{ message: string }, Error, number>({
    mutationFn: (chatId) => deleteSessionChat(session.id, chatId),
    onSuccess: (data, deletedChatId) => {
      setToast(data.message || `Chat ${deletedChatId} deleted.`);
      queryClient.invalidateQueries({ queryKey: ['sessionMeta', session.id] });
      queryClient.removeQueries({
        queryKey: ['chat', session.id, deletedChatId],
      });
      setIsDeleteConfirmOpen(false);
      setChatToDelete(null);
      navigate(`/sessions/${session.id}`, { replace: true });
    },
    onError: (error) => setToast(`Error deleting chat: ${error.message}`),
  });

  const handleChatSelect = (chatId: number) => {
    navigate(`/sessions/${session.id}/chats/${chatId}`);
  };

  const handleNewChat = () => {
    if (startNewChatMutation.isPending) return;
    startNewChatMutation.mutate();
  };

  const handleOpenRenameModal = () => {
    if (activeChat) {
      setChatToEdit(activeChat);
      setIsRenameModalOpen(true);
    }
  };

  const handleOpenDeleteConfirm = () => {
    if (activeChat) {
      setChatToDelete(activeChat);
      setIsDeleteConfirmOpen(true);
    }
  };

  const getInitialRenameFormState = useCallback(
    (entity: ChatSession | null): ChatRenameFormState => ({
      name: entity?.name || '',
    }),
    []
  );

  const validateRenameForm = useCallback(
    (formState: ChatRenameFormState): string | null => {
      if (!formState.name.trim() && activeChat?.name) {
        return null;
      }
      if (!formState.name.trim() && !activeChat?.name) {
        return 'No changes detected.';
      }
      if (formState.name.trim() === activeChat?.name) {
        return 'No changes detected.';
      }
      return null;
    },
    [activeChat]
  );

  const handleSaveRename = async (
    entityId: number,
    formState: ChatRenameFormState
  ) => {
    renameChatMutation.mutate({ chatId: entityId, formState });
  };

  const renderRenameFormFields = useCallback(
    (
      formState: ChatRenameFormState,
      setFormState: React.Dispatch<React.SetStateAction<ChatRenameFormState>>,
      isSaving: boolean,
      firstInputRef: React.RefObject<
        HTMLInputElement | HTMLTextAreaElement | null
      >
    ): React.ReactNode => (
      <label>
        <Text as="div" size="2" mb="1" weight="medium">
          Chat Name (Optional)
        </Text>
        <TextField.Root
          ref={firstInputRef as React.RefObject<HTMLInputElement>}
          size="2"
          placeholder="Enter new chat name"
          value={formState.name}
          onChange={(e) => setFormState({ name: e.target.value })}
          disabled={isSaving}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (chatToEdit && !validateRenameForm(formState)) {
                handleSaveRename(chatToEdit.id, formState);
              }
            }
          }}
        />
      </label>
    ),
    [chatToEdit, validateRenameForm, handleSaveRename] // Dependencies for useCallback
  );

  const modelName = ollamaStatus?.activeModel ?? 'No Model Selected';
  const isLoaded = ollamaStatus?.loaded ?? false;
  const isActiveModelLoaded =
    isLoaded && ollamaStatus?.modelChecked === ollamaStatus?.activeModel;
  const configuredContextSize = ollamaStatus?.configuredContextSize;

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
      statusTooltipContent = `Active Model: ${modelName} (Loaded)`;
    } else {
      statusTooltipContent = `Active Model: ${modelName} (Not loaded or unavailable)`;
    }
  }
  const totalTokens = (latestPromptTokens ?? 0) + (latestCompletionTokens ?? 0);
  const isAnyActionInProgress =
    startNewChatMutation.isPending ||
    renameChatMutation.isPending ||
    deleteChatMutation.isPending;

  // Context Window Warning Logic
  const effectiveModelContextSize =
    configuredContextSize ?? activeModelDefaultContextSize ?? 0;
  const showContextWarning =
    typeof transcriptTokenCount === 'number' &&
    transcriptTokenCount > 0 &&
    effectiveModelContextSize > 0 &&
    transcriptTokenCount + PADDING_ESTIMATE > effectiveModelContextSize;

  return (
    <>
      <Flex
        direction="column" // Main direction is column for Header + Optional Warning
        style={{
          borderBottom: '1px solid var(--gray-a6)',
          flexShrink: 0,
        }}
      >
        <Flex // Inner flex for the main header content row
          align="center"
          justify="between"
          py="2"
          px="3"
          gap="2"
        >
          <Flex align="center" gap="2" style={{ minWidth: 0, flexGrow: 1 }}>
            <EntitySelectorDropdown
              items={session.chats}
              activeItemId={activeChatId}
              onItemSelect={handleChatSelect}
              placeholderText="Select a Chat..."
              entityTypeLabel="Chat"
              disabled={isAnyActionInProgress}
            />
            <IconButton
              variant="soft"
              size="1"
              onClick={handleNewChat}
              disabled={startNewChatMutation.isPending || isAnyActionInProgress}
              title="Start New Chat"
            >
              {startNewChatMutation.isPending ? (
                <Spinner size="1" />
              ) : (
                <PlusCircledIcon />
              )}
            </IconButton>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger>
                <IconButton
                  variant="ghost"
                  color="gray"
                  size="1"
                  disabled={!activeChat || isAnyActionInProgress}
                  title="Chat Actions"
                >
                  <DotsHorizontalIcon />
                </IconButton>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="start">
                <DropdownMenu.Item
                  onSelect={handleOpenRenameModal}
                  disabled={!activeChat || renameChatMutation.isPending}
                >
                  <Pencil1Icon className="mr-1" /> Rename Chat
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
            {/* Transcript Token Count */}
            {typeof transcriptTokenCount === 'number' && (
              <Tooltip content="Transcript Size (Tokens)">
                <Badge variant="soft" color="gray">
                  <ReaderIcon
                    width="14"
                    height="14"
                    style={{ marginRight: '3px' }}
                  />
                  {transcriptTokenCount.toLocaleString()}
                </Badge>
              </Tooltip>
            )}

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
            >
              <MixerVerticalIcon width="14" height="14" />
            </Button>
          </Flex>
        </Flex>
        {/* Context Window Warning Callout */}
        {showContextWarning && (
          <Box px="3" pb="2" pt="1">
            <Callout.Root color="yellow" size="1">
              <Callout.Icon>
                <ExclamationTriangleIcon />
              </Callout.Icon>
              <Callout.Text>
                Warning: Transcript size (~
                {(transcriptTokenCount || 0).toLocaleString()} tokens) plus chat
                padding (~{PADDING_ESTIMATE.toLocaleString()} tokens) may exceed
                the model's current context window (
                {effectiveModelContextSize.toLocaleString()} tokens for{' '}
                {modelName}). Consider selecting a model with a larger context
                or increasing the context size in "Configure Model".
              </Callout.Text>
            </Callout.Root>
          </Box>
        )}
      </Flex>

      {chatToEdit && (
        <EditEntityModal<ChatSession, ChatRenameFormState>
          isOpen={isRenameModalOpen}
          onOpenChange={(open) => {
            if (!open) {
              setIsRenameModalOpen(false);
              setChatToEdit(null);
              renameChatMutation.reset();
            }
          }}
          entity={chatToEdit}
          entityTypeLabel="Chat"
          getInitialFormState={getInitialRenameFormState}
          renderFormFields={renderRenameFormFields}
          validateForm={validateRenameForm}
          onSave={handleSaveRename}
          isSaving={renameChatMutation.isPending}
          saveError={renameChatMutation.error?.message}
        />
      )}

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
