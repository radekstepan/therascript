// packages/ui/src/components/SessionView/Modals/LlmManagementModal.tsx
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
  ScrollArea,
  Badge,
  Tooltip,
  TextField,
  Separator,
  Progress,
  Strong,
  DropdownMenu,
  IconButton,
  AlertDialog,
} from '@radix-ui/themes';
import {
  InfoCircledIcon,
  Cross2Icon,
  CheckCircledIcon,
  SymbolIcon,
  ReloadIcon,
  ExclamationTriangleIcon,
  DownloadIcon,
  StopIcon,
  MagnifyingGlassIcon,
  LightningBoltIcon,
  DotsHorizontalIcon,
  Pencil1Icon,
  TrashIcon,
  CheckIcon,
} from '@radix-ui/react-icons';
import {
  fetchOllamaStatus,
  fetchAvailableModels,
  unloadOllamaModel,
  setOllamaModel,
  startPullOllamaModel,
  fetchPullOllamaModelStatus,
  cancelPullOllamaModel,
  deleteOllamaModel,
} from '../../../api/api';
import { toastMessageAtom } from '../../../store';
import { useSetAtom } from 'jotai';
import type {
  OllamaModelInfo,
  OllamaStatus,
  UIPullJobStatus,
  UIPullJobStatusState,
} from '../../../types';
import { cn } from '../../../utils';

interface LlmManagementModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

// Helper to format model size
const formatBytes = (bytes: number, decimals = 2): string => {
  if (!bytes || bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

export function LlmManagementModal({
  isOpen,
  onOpenChange,
}: LlmManagementModalProps) {
  const queryClient = useQueryClient();
  const setToast = useSetAtom(toastMessageAtom);
  const [isWaitingForUnload, setIsWaitingForUnload] = useState(false);
  const [loadingModelName, setLoadingModelName] = useState<string | null>(null);
  const [modelToPull, setModelToPull] = useState<string>('');

  // State for Polling
  const [pullJobId, setPullJobId] = useState<string | null>(null);
  const [pullingModelName, setPullingModelName] = useState<string | null>(null);

  // State for Custom Context Modal
  const [isContextModalOpen, setIsContextModalOpen] = useState(false);
  const [modelForContextModal, setModelForContextModal] =
    useState<OllamaModelInfo | null>(null);
  const [customContextSizeInput, setCustomContextSizeInput] = useState('');
  const [contextModalError, setContextModalError] = useState<string | null>(
    null
  );

  // State for Delete Confirmation
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [modelToDelete, setModelToDelete] = useState<OllamaModelInfo | null>(
    null
  );

  // --- Queries and Mutations ---
  const {
    data: ollamaStatus,
    isLoading: isLoadingStatus,
    error: statusError,
  } = useQuery({
    queryKey: ['ollamaStatus'],
    queryFn: () => fetchOllamaStatus(),
    enabled: isOpen,
    staleTime: 0,
    gcTime: 1000,
    refetchInterval:
      isOpen && (isWaitingForUnload || loadingModelName || !!pullJobId)
        ? 2000
        : 10000,
    refetchOnWindowFocus: false,
  });

  const {
    data: availableModelsData,
    isLoading: isLoadingAvailable,
    error: availableError,
    refetch: refetchAvailableModels,
  } = useQuery({
    queryKey: ['availableOllamaModels'],
    queryFn: fetchAvailableModels,
    enabled: isOpen,
    staleTime: 10 * 1000,
    gcTime: 1 * 60 * 1000,
  });

  const unloadMutation = useMutation({
    mutationFn: unloadOllamaModel,
    onMutate: () => {
      setLoadingModelName(null);
      setIsWaitingForUnload(true);
    },
    onSuccess: (data) => {
      setToast(`✅ ${data.message}`);
      queryClient.invalidateQueries({ queryKey: ['ollamaStatus'] });
    },
    onError: (error: Error) => {
      console.error('Unload request failed:', error);
      setToast(
        `❌ Error: ${error.message || 'Failed to send unload request.'}`
      );
      setIsWaitingForUnload(false);
    },
  });

  const setModelMutation = useMutation({
    mutationFn: (variables: {
      modelName: string;
      contextSize?: number | null;
    }) => {
      const { modelName, contextSize } = variables;
      setLoadingModelName(modelName);
      setIsWaitingForUnload(false);
      return setOllamaModel(modelName, contextSize);
    },
    onSuccess: (data, variables) => {
      setToast(`✅ ${data.message}`);
      console.log(
        `[LlmModal] Set model request successful for ${variables.modelName}. Waiting for status update...`
      );
      queryClient.invalidateQueries({ queryKey: ['ollamaStatus'] });
      if (modelForContextModal?.name === variables.modelName) {
        closeContextModal();
      }
    },
    onError: (error: Error, variables) => {
      console.error(
        `Set model request failed for ${variables.modelName}:`,
        error
      );
      setToast(
        `❌ Error setting model ${variables.modelName}: ${error.message || 'Request failed.'}`
      );
      setLoadingModelName(null);
      if (modelForContextModal?.name === variables.modelName) {
        setContextModalError(
          `Failed to set model: ${error.message || 'Request failed.'}`
        );
      }
    },
  });

  const startPullMutation = useMutation({
    mutationFn: startPullOllamaModel,
    onMutate: (modelName: string) => {
      resetPullState(true);
      setPullingModelName(modelName);
      console.log(`[LlmModal Mutate] Starting pull for ${modelName}`);
    },
    onSuccess: (data, modelName: string) => {
      console.log(
        `[LlmModal Success] Pull job started successfully. Job ID: ${data.jobId} for Model: ${modelName}`
      );
      setPullJobId(data.jobId);
      setModelToPull('');
    },
    onError: (error: Error, modelName: string) => {
      console.error(`Error starting pull job for ${modelName}:`, error);
      setToast(`❌ Failed to start download: ${error.message}`);
      resetPullState(false);
    },
  });

  const { data: pullStatus, error: pullStatusError } = useQuery<
    UIPullJobStatus,
    Error
  >({
    queryKey: ['ollamaPullStatus', pullJobId],
    queryFn: () => {
      if (!pullJobId) {
        throw new Error('No Job ID to poll');
      }
      return fetchPullOllamaModelStatus(pullJobId);
    },
    enabled: !!pullJobId,
    refetchInterval: (query) => {
      const statusData = query.state.data;
      if (
        statusData?.status === 'completed' ||
        statusData?.status === 'failed' ||
        statusData?.status === 'canceled'
      ) {
        console.log(
          `[Pull Query ${pullJobId}] Status is terminal (${statusData.status}). Stopping polling.`
        );
        if (statusData.status === 'completed') {
          setToast(`✅ Pull complete for ${statusData.modelName}.`);
          setTimeout(() => {
            queryClient.invalidateQueries({
              queryKey: ['availableOllamaModels'],
            });
            resetPullState(false);
          }, 1500);
        } else if (statusData.status === 'failed') {
          setToast(
            `❌ Pull failed for ${statusData.modelName}: ${statusData.error || 'Unknown reason'}`
          );
        } else if (statusData.status === 'canceled') {
          setToast(`⏹️ Pull canceled for ${statusData.modelName}.`);
          resetPullState(false);
        }
        return false;
      }
      return 2000;
    },
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    retry: (failureCount, error) => {
      if (
        error.message.includes('404') ||
        error.message.includes('not found')
      ) {
        console.error(`[Pull Query ${pullJobId}] Job ID not found on server.`);
        setToast(`❌ Error: Download job ${pullJobId} not found.`);
        resetPullState(false);
        return false;
      }
      return failureCount < 3;
    },
    gcTime: 5 * 60 * 1000,
  });

  const cancelPullMutation = useMutation({
    mutationFn: cancelPullOllamaModel,
    onMutate: (jobIdToCancel) => {
      console.log(
        `[LlmModal Mutate] Sending cancel request for job ${jobIdToCancel}...`
      );
      queryClient.setQueryData<UIPullJobStatus>(
        ['ollamaPullStatus', jobIdToCancel],
        (oldData) =>
          oldData
            ? {
                ...oldData,
                status: 'canceling',
                message: 'Cancellation requested...',
              }
            : oldData
      );
    },
    onSuccess: (data, jobIdCancelled) => {
      setToast(`✅ ${data.message}`);
    },
    onError: (error: Error, jobIdCancelled) => {
      console.error(`Error cancelling pull job ${jobIdCancelled}:`, error);
      setToast(`❌ Failed to cancel download: ${error.message}`);
      queryClient.invalidateQueries({
        queryKey: ['ollamaPullStatus', jobIdCancelled],
      });
    },
  });

  const deleteModelMutation = useMutation({
    mutationFn: deleteOllamaModel,
    onMutate: (modelName: string) => {
      setLoadingModelName(modelName);
      console.log(
        `[LlmModal Mutate] Sending delete request for ${modelName}...`
      );
    },
    onSuccess: (data, modelName) => {
      setToast(`✅ ${data.message || `Model ${modelName} deleted.`}`);
      queryClient.invalidateQueries({ queryKey: ['availableOllamaModels'] });
      queryClient.invalidateQueries({ queryKey: ['ollamaStatus'] });
      closeDeleteConfirm();
    },
    onError: (error: Error, modelName) => {
      console.error(`Error deleting model ${modelName}:`, error);
      setToast(`❌ Failed to delete model ${modelName}: ${error.message}`);
      closeDeleteConfirm();
    },
    onSettled: (data, error, modelName) => {
      setLoadingModelName(null);
    },
  });

  // --- Handlers ---
  const resetPullState = (clearQuery: boolean = true) => {
    const currentJobId = pullJobId;
    setPullJobId(null);
    setPullingModelName(null);
    if (clearQuery && currentJobId) {
      console.log(
        `[LlmModal] Resetting pull state and removing poll query for job ${currentJobId}.`
      );
      queryClient.removeQueries({
        queryKey: ['ollamaPullStatus', currentJobId],
      });
    }
    startPullMutation.reset();
    cancelPullMutation.reset();
  };
  const handlePullClick = () => {
    const modelName = modelToPull.trim();
    if (
      !modelName ||
      startPullMutation.isPending ||
      !!pullJobId ||
      isAnyLoadingProcessActive
    )
      return;
    startPullMutation.mutate(modelName);
  };
  const handleCancelPullClick = () => {
    if (pullJobId && !cancelPullMutation.isPending) {
      const currentStatus = pullStatus?.status;
      if (
        currentStatus &&
        currentStatus !== 'completed' &&
        currentStatus !== 'failed' &&
        currentStatus !== 'canceled'
      ) {
        cancelPullMutation.mutate(pullJobId);
      } else {
        setToast(`Job already ${currentStatus}.`);
      }
    }
  };

  // Effects for unload/load confirmation
  useEffect(() => {
    if (isWaitingForUnload && ollamaStatus) {
      if (
        ollamaStatus.modelChecked === ollamaStatus.activeModel &&
        !ollamaStatus.loaded
      ) {
        setIsWaitingForUnload(false);
      }
    }
  }, [isWaitingForUnload, ollamaStatus]);
  useEffect(() => {
    if (loadingModelName && ollamaStatus) {
      if (
        ollamaStatus.modelChecked === loadingModelName &&
        ollamaStatus.loaded
      ) {
        setLoadingModelName(null);
      }
    }
  }, [loadingModelName, ollamaStatus]);

  // Event Handlers (Unload, Load)
  const handleUnloadClick = () => {
    if (isAnyOperationActive || unloadMutation.isPending) return;
    unloadMutation.mutate();
  };
  const handleLoadDefaultClick = (modelName: string) => {
    if (isAnyOperationActive || setModelMutation.isPending) return;
    setModelMutation.mutate({ modelName, contextSize: null });
  };

  // Handlers for Modals
  const openContextModal = (model: OllamaModelInfo) => {
    setModelForContextModal(model);
    setCustomContextSizeInput('');
    setContextModalError(null);
    setIsContextModalOpen(true);
  };
  const closeContextModal = () => {
    setIsContextModalOpen(false);
    setModelForContextModal(null);
    setCustomContextSizeInput('');
    setContextModalError(null);
    setModelMutation.reset();
  };
  const handleSaveCustomContext = () => {
    if (!modelForContextModal || setModelMutation.isPending) return;
    const sizeStr = customContextSizeInput.trim();
    const sizeNum = parseInt(sizeStr, 10);
    if (!sizeStr || isNaN(sizeNum) || sizeNum <= 0) {
      setContextModalError(
        'Please enter a valid positive number for context size.'
      );
      return;
    }
    setContextModalError(null);
    setModelMutation.mutate({
      modelName: modelForContextModal.name,
      contextSize: sizeNum,
    });
  };
  const openDeleteConfirm = (model: OllamaModelInfo) => {
    setModelToDelete(model);
    setIsDeleteConfirmOpen(true);
  };
  const closeDeleteConfirm = () => {
    setIsDeleteConfirmOpen(false);
    setModelToDelete(null);
    deleteModelMutation.reset();
  };
  const handleConfirmDelete = () => {
    if (!modelToDelete || deleteModelMutation.isPending) return;
    deleteModelMutation.mutate(modelToDelete.name);
  };

  const handleManualClose = (open: boolean) => {
    const hasFailedJob = pullStatus?.status === 'failed' || !!pullStatusError;
    const isActiveJob =
      !!pullJobId &&
      pullStatus?.status !== 'completed' &&
      pullStatus?.status !== 'failed' &&
      pullStatus?.status !== 'canceled';
    if (
      !open &&
      (isAnyLoadingProcessActive || (isActiveJob && !hasFailedJob))
    ) {
      return;
    }
    onOpenChange(open);
    if (!open) {
      setIsWaitingForUnload(false);
      setLoadingModelName(null);
      setModelToPull('');
      unloadMutation.reset();
      setModelMutation.reset();
      deleteModelMutation.reset();
      resetPullState(true);
      closeContextModal();
      closeDeleteConfirm();
    }
  };

  // Loading states
  const isUnloading = unloadMutation.isPending || isWaitingForUnload;
  const isLoadingSelectedModel =
    setModelMutation.isPending ||
    (loadingModelName !== null && !deleteModelMutation.isPending);
  const isDeletingSelectedModel = deleteModelMutation.isPending;
  const isPulling =
    !!pullJobId &&
    pullStatus?.status !== 'completed' &&
    pullStatus?.status !== 'failed' &&
    pullStatus?.status !== 'canceled';
  const isCancelingPull =
    cancelPullMutation.isPending || pullStatus?.status === 'canceling';
  const isStartingPull = startPullMutation.isPending;
  const isAnyLoadingProcessActive =
    isUnloading || isLoadingSelectedModel || isDeletingSelectedModel;
  const isAnyPullProcessActive = isPulling || isCancelingPull || isStartingPull;
  const isAnyOperationActive =
    isAnyLoadingProcessActive || isAnyPullProcessActive;
  const overallError =
    statusError?.message ||
    availableError?.message ||
    unloadMutation.error?.message ||
    setModelMutation.error?.message ||
    pullStatusError?.message ||
    pullStatus?.error ||
    deleteModelMutation.error?.message;

  // UI Display Values
  const activeModelName = ollamaStatus?.activeModel ?? 'N/A';
  const isAnyModelLoaded = ollamaStatus?.loaded ?? false;
  const loadedModelFullName = ollamaStatus?.details?.name;
  const activeConfiguredContextSize = ollamaStatus?.configuredContextSize;

  // Render list item function
  const renderModelListItem = (model: OllamaModelInfo) => {
    const isCurrentlyLoadingThis =
      (isLoadingSelectedModel || isDeletingSelectedModel) &&
      loadingModelName === model.name;
    const isCurrentlyActiveAndLoaded =
      isAnyModelLoaded && loadedModelFullName === model.name;
    const actionsDisabled = isAnyOperationActive || isCurrentlyLoadingThis;
    const canSetActive = !isCurrentlyActiveAndLoaded;
    const canDelete = !isCurrentlyActiveAndLoaded;

    return (
      <Box
        key={model.digest}
        p="2"
        style={{ borderBottom: '1px solid var(--gray-a3)' }}
      >
        {/* Outer Flex: Aligns Left Block and Right Block */}
        <Flex justify="between" align="center" gap="3">
          {' '}
          {/* Increased gap */}
          {/* Left Block: Name and Tags */}
          <Flex direction="column" gap="1" style={{ minWidth: 0, flexGrow: 1 }}>
            {/* Name Row */}
            <Flex>
              <Text size="2" weight="medium" truncate title={model.name}>
                {model.name}
              </Text>
            </Flex>
            {/* Tags Row */}
            <Flex gap="1" wrap="wrap" align="center">
              {model.details?.family && (
                <Badge variant="outline" color="gray" radius="full" size="1">
                  {model.details.family}
                </Badge>
              )}
              {model.details?.parameter_size && (
                <Badge variant="outline" color="gray" radius="full" size="1">
                  {model.details.parameter_size}
                </Badge>
              )}
              {model.details?.quantization_level && (
                <Badge variant="outline" color="gray" radius="full" size="1">
                  {model.details.quantization_level}
                </Badge>
              )}
            </Flex>
          </Flex>
          {/* Right Block: Size Badge + Status/Actions */}
          <Flex align="center" gap="2" flexShrink="0">
            {/* Size Badge */}
            <Badge variant="soft" color="gray">
              {formatBytes(model.size)}
            </Badge>

            {/* Status Badge or Actions Menu */}
            {isCurrentlyLoadingThis ? (
              <Badge
                variant="soft"
                color="gray"
                size="1"
                style={{
                  minWidth: '80px',
                  justifyContent: 'center',
                  display: 'inline-flex',
                }}
              >
                {' '}
                {/* Reduced minWidth */}
                <Spinner size="1" />{' '}
                {isDeletingSelectedModel ? 'Deleting...' : 'Loading...'}
              </Badge>
            ) : isCurrentlyActiveAndLoaded ? (
              <Badge
                color="green"
                variant="soft"
                size="1"
                style={{
                  minWidth: '80px',
                  justifyContent: 'center',
                  display: 'inline-flex',
                }}
              >
                {' '}
                {/* Reduced minWidth */}
                <CheckCircledIcon /> Active
              </Badge>
            ) : (
              <DropdownMenu.Root>
                <DropdownMenu.Trigger>
                  <IconButton
                    variant="ghost"
                    color="gray"
                    size="1"
                    title="Model Actions"
                    aria-label={`Actions for ${model.name}`}
                    disabled={actionsDisabled}
                  >
                    <DotsHorizontalIcon />
                  </IconButton>
                </DropdownMenu.Trigger>
                <DropdownMenu.Content size="1" align="end">
                  <DropdownMenu.Item
                    onSelect={() => handleLoadDefaultClick(model.name)}
                    disabled={actionsDisabled || !canSetActive}
                  >
                    {' '}
                    <DownloadIcon width="14" height="14" className="mr-1" /> Set
                    Active{' '}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    onSelect={() => openContextModal(model)}
                    disabled={actionsDisabled || !canSetActive}
                  >
                    {' '}
                    <Pencil1Icon width="14" height="14" className="mr-1" /> Set
                    Active (Custom Ctx){' '}
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item
                    color="red"
                    onSelect={() => openDeleteConfirm(model)}
                    disabled={actionsDisabled || !canDelete}
                  >
                    {' '}
                    <TrashIcon width="14" height="14" className="mr-1" /> Delete
                    Model...{' '}
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Root>
            )}
          </Flex>
        </Flex>
      </Box>
    );
  };

  // Determine pull progress display values
  const displayPullProgress =
    pullStatus?.progress ??
    (pullStatus?.status === 'completed'
      ? 100
      : pullStatus?.status === 'failed' || pullStatus?.status === 'canceled'
        ? 0
        : 0);
  const displayPullMessage =
    pullStatus?.message ||
    (startPullMutation.isPending ? 'Starting download job...' : '');
  const displayPullModelName = pullingModelName || pullStatus?.modelName || '';
  const displayPullError = pullStatusError?.message || pullStatus?.error;

  return (
    <>
      {' '}
      {/* Wrap in fragment */}
      <Dialog.Root open={isOpen} onOpenChange={handleManualClose}>
        <Dialog.Content style={{ maxWidth: 600 }}>
          <Dialog.Title>Manage Language Model</Dialog.Title>
          <Dialog.Description size="2" mb="4" color="gray">
            View models, set the active model and context size, or download new
            models.
          </Dialog.Description>

          {/* Active Model Status */}
          <Box
            mb="4"
            p="3"
            style={{
              backgroundColor: 'var(--gray-a2)',
              borderRadius: 'var(--radius-3)',
            }}
          >
            <Text as="div" size="1" weight="medium" color="gray" mb="2">
              Active Model Status
            </Text>
            <Flex align="center" justify="between" gap="3">
              <Flex align="center" gap="2" style={{ minWidth: 0 }}>
                {(isLoadingStatus && !ollamaStatus) || isWaitingForUnload ? (
                  <Spinner size="2" />
                ) : isAnyModelLoaded ? (
                  <CheckCircledIcon
                    width="18"
                    height="18"
                    className="text-green-600"
                  />
                ) : (
                  <SymbolIcon
                    width="18"
                    height="18"
                    className="text-gray-500"
                  />
                )}
                <Text size="3" weight="bold" truncate title={activeModelName}>
                  {activeModelName}
                </Text>
                <Tooltip content={`Configured Context Size (num_ctx)`}>
                  <Badge
                    variant="soft"
                    color={activeConfiguredContextSize ? 'blue' : 'gray'}
                    size="1"
                    className={cn(isLoadingStatus ? 'opacity-50' : '')}
                  >
                    <LightningBoltIcon style={{ marginRight: '2px' }} />
                    {isLoadingStatus
                      ? '...'
                      : activeConfiguredContextSize
                        ? activeConfiguredContextSize.toLocaleString()
                        : 'Default'}
                  </Badge>
                </Tooltip>
                {isAnyModelLoaded &&
                  loadedModelFullName &&
                  loadedModelFullName !== activeModelName && (
                    <Tooltip content={`Loaded: ${loadedModelFullName}`}>
                      <InfoCircledIcon className="text-blue-500" />
                    </Tooltip>
                  )}
              </Flex>
              <Button
                color="orange"
                variant="soft"
                size="1"
                onClick={handleUnloadClick}
                disabled={!isAnyModelLoaded || isAnyOperationActive}
                title={
                  !isAnyModelLoaded ? 'No model loaded' : 'Unload active model'
                }
              >
                {isUnloading ? (
                  <>
                    {' '}
                    <Spinner size="1" /> Unloading...{' '}
                  </>
                ) : (
                  <>
                    {' '}
                    <ReloadIcon /> Unload{' '}
                  </>
                )}
              </Button>
            </Flex>
            {statusError && !isAnyLoadingProcessActive && (
              <Callout.Root color="red" size="1" mt="2">
                <Callout.Icon>
                  <ExclamationTriangleIcon />
                </Callout.Icon>
                <Callout.Text>
                  Error checking status: {statusError.message}
                </Callout.Text>
              </Callout.Root>
            )}
          </Box>

          {/* Available Models List */}
          <Box mb="4">
            <Flex justify="between" align="center" mb="2">
              {' '}
              <Text as="div" size="1" weight="medium" color="gray">
                Available Local Models
              </Text>{' '}
              <Button
                variant="ghost"
                size="1"
                onClick={() => refetchAvailableModels()}
                disabled={isLoadingAvailable || isAnyOperationActive}
                title="Refresh list"
              >
                {' '}
                <ReloadIcon
                  className={isLoadingAvailable ? 'animate-spin' : ''}
                />{' '}
              </Button>{' '}
            </Flex>
            <ScrollArea
              type="auto"
              scrollbars="vertical"
              style={{
                maxHeight: '250px',
                border: '1px solid var(--gray-a6)',
                borderRadius: 'var(--radius-3)',
              }}
            >
              <Box pr="2">
                {isLoadingAvailable && (
                  <Flex align="center" justify="center" p="4">
                    <Spinner size="2" />{' '}
                    <Text ml="2" color="gray" size="2">
                      Loading available models...
                    </Text>
                  </Flex>
                )}
                {availableError && (
                  <Callout.Root color="red" size="1" m="2">
                    <Callout.Icon>
                      <ExclamationTriangleIcon />
                    </Callout.Icon>
                    <Callout.Text>
                      Error loading available models: {availableError.message}
                    </Callout.Text>
                  </Callout.Root>
                )}
                {!isLoadingAvailable &&
                  !availableError &&
                  availableModelsData?.models.length === 0 && (
                    <Flex align="center" justify="center" p="4">
                      <Text color="gray" size="2">
                        No models found locally.
                      </Text>
                    </Flex>
                  )}
                {!isLoadingAvailable &&
                  !availableError &&
                  availableModelsData &&
                  availableModelsData.models.length > 0 && (
                    <>
                      {' '}
                      {availableModelsData.models
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map(renderModelListItem)}{' '}
                    </>
                  )}
              </Box>
            </ScrollArea>
          </Box>

          {/* Download New Model Section */}
          <Separator my="3" size="4" />
          <Box mb="4">
            <Text as="div" size="1" weight="medium" color="gray" mb="2">
              Download New Model
            </Text>
            {(isStartingPull || isPulling || isCancelingPull || pullStatus) &&
              displayPullModelName && (
                <Box mb="2">
                  <Text size="1" color="gray" mb="1">
                    Status for <Strong>{displayPullModelName}</Strong>:&nbsp;
                  </Text>
                  {(pullStatus?.status === 'downloading' ||
                    pullStatus?.status === 'verifying' ||
                    pullStatus?.status === 'parsing') && (
                    <Progress
                      value={displayPullProgress}
                      size="2"
                      mt="1"
                      mb="1"
                    />
                  )}
                  {pullStatus?.status !== 'completed' &&
                    pullStatus?.status !== 'canceled' &&
                    pullStatus?.status !== 'canceling' && (
                      <Text
                        size="1"
                        color="gray"
                        mt="1"
                        ml="1"
                        style={{ display: 'inline-block' }}
                      >
                        {displayPullMessage}
                      </Text>
                    )}{' '}
                </Box>
              )}
            {displayPullError &&
              !isPulling &&
              !isCancelingPull &&
              !isStartingPull && (
                <Callout.Root color="red" size="1" mt="0" mb="2">
                  <Callout.Icon>
                    <ExclamationTriangleIcon />
                  </Callout.Icon>
                  <Callout.Text>{displayPullError}</Callout.Text>
                </Callout.Root>
              )}
            <Flex gap="2">
              <TextField.Root
                style={{ flexGrow: 1 }}
                size="2"
                placeholder="Enter model name (e.g., llama3:latest, mistral:7b)"
                value={modelToPull}
                onChange={(e) => setModelToPull(e.target.value)}
                disabled={isAnyOperationActive}
              />
              {isPulling || isCancelingPull ? (
                <Button
                  color="red"
                  variant="soft"
                  onClick={handleCancelPullClick}
                  disabled={
                    cancelPullMutation.isPending ||
                    !pullJobId ||
                    pullStatus?.status === 'canceling' ||
                    pullStatus?.status === 'canceled' ||
                    pullStatus?.status === 'completed' ||
                    pullStatus?.status === 'failed'
                  }
                  title="Cancel download"
                >
                  {cancelPullMutation.isPending ||
                  pullStatus?.status === 'canceling' ? (
                    <>
                      {' '}
                      <Spinner size="1" /> Canceling...{' '}
                    </>
                  ) : (
                    <>
                      <StopIcon /> Cancel
                    </>
                  )}
                </Button>
              ) : (
                <Button
                  onClick={handlePullClick}
                  disabled={!modelToPull.trim() || isAnyOperationActive}
                  title={
                    !modelToPull.trim()
                      ? 'Enter a model name'
                      : 'Download model'
                  }
                >
                  {startPullMutation.isPending ? (
                    <>
                      {' '}
                      <Spinner size="1" /> Starting...{' '}
                    </>
                  ) : (
                    <>
                      <MagnifyingGlassIcon /> Download
                    </>
                  )}
                </Button>
              )}
            </Flex>
          </Box>

          {/* Display General Mutation Errors */}
          {unloadMutation.isError && (
            <Callout.Root color="red" size="1" mt="2">
              <Callout.Icon>
                <ExclamationTriangleIcon />
              </Callout.Icon>
              <Callout.Text>
                Error during unload: {unloadMutation.error.message}
              </Callout.Text>
            </Callout.Root>
          )}
          {setModelMutation.isError && !isContextModalOpen && (
            <Callout.Root color="red" size="1" mt="2">
              <Callout.Icon>
                <ExclamationTriangleIcon />
              </Callout.Icon>
              <Callout.Text>
                Error setting model: {setModelMutation.error.message}
              </Callout.Text>
            </Callout.Root>
          )}
          {deleteModelMutation.isError && (
            <Callout.Root color="red" size="1" mt="2">
              <Callout.Icon>
                <ExclamationTriangleIcon />
              </Callout.Icon>
              <Callout.Text>
                Error deleting model: {deleteModelMutation.error.message}
              </Callout.Text>
            </Callout.Root>
          )}
          {overallError &&
            !displayPullError &&
            !unloadMutation.isError &&
            !(setModelMutation.isError && !isContextModalOpen) &&
            !deleteModelMutation.isError && (
              <Callout.Root color="red" size="1" mt="2">
                <Callout.Icon>
                  <ExclamationTriangleIcon />
                </Callout.Icon>
                <Callout.Text>Error: {overallError}</Callout.Text>
              </Callout.Root>
            )}

          {/* Footer Buttons */}
          <Flex gap="3" mt="4" justify="end">
            <Button
              type="button"
              variant="soft"
              color="gray"
              onClick={() => handleManualClose(false)}
              disabled={
                isAnyOperationActive &&
                !(pullStatus?.status === 'failed' || !!pullStatusError)
              }
            >
              {' '}
              <Cross2Icon /> Close{' '}
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
      {/* Custom Context Size Modal */}
      <Dialog.Root
        open={isContextModalOpen}
        onOpenChange={(open) => !open && closeContextModal()}
      >
        <Dialog.Content style={{ maxWidth: 400 }}>
          <Dialog.Title>Set Custom Context Size</Dialog.Title>
          <Dialog.Description size="2" mb="4" color="gray">
            {' '}
            Enter the desired context window size (num_ctx) for{' '}
            <Strong>{modelForContextModal?.name ?? 'this model'}</Strong>. Leave
            empty or 0 to use the model's default.{' '}
          </Dialog.Description>
          <Flex direction="column" gap="3">
            <label>
              {' '}
              <Text as="div" size="2" mb="1" weight="medium">
                Context Size (e.g., 2048, 4096)
              </Text>
              <TextField.Root
                size="2"
                type="number"
                min="1"
                step="1"
                placeholder="Enter positive number (optional)"
                value={customContextSizeInput}
                onChange={(e) => {
                  const val = e.target.value;
                  if (/^\d*$/.test(val)) {
                    setCustomContextSizeInput(val);
                    if (contextModalError) setContextModalError(null);
                  }
                }}
                disabled={setModelMutation.isPending}
                autoFocus
              />
            </label>
            {contextModalError && (
              <Callout.Root color="red" size="1">
                <Callout.Icon>
                  <InfoCircledIcon />
                </Callout.Icon>
                <Callout.Text>{contextModalError}</Callout.Text>
              </Callout.Root>
            )}
            {setModelMutation.isError && isContextModalOpen && (
              <Callout.Root color="red" size="1">
                <Callout.Icon>
                  <InfoCircledIcon />
                </Callout.Icon>
                <Callout.Text>
                  Error: {setModelMutation.error.message}
                </Callout.Text>
              </Callout.Root>
            )}
          </Flex>
          <Flex gap="3" mt="4" justify="end">
            <Button
              variant="soft"
              color="gray"
              onClick={closeContextModal}
              disabled={setModelMutation.isPending}
            >
              {' '}
              <Cross2Icon /> Cancel{' '}
            </Button>
            <Button
              onClick={handleSaveCustomContext}
              disabled={setModelMutation.isPending}
            >
              {' '}
              {setModelMutation.isPending &&
              loadingModelName === modelForContextModal?.name ? (
                <>
                  {' '}
                  <Spinner size="2" /> <Text ml="1">Setting...</Text>{' '}
                </>
              ) : (
                <>
                  {' '}
                  <CheckIcon /> Set Active{' '}
                </>
              )}{' '}
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
      {/* Delete Confirmation Modal */}
      <AlertDialog.Root
        open={isDeleteConfirmOpen}
        onOpenChange={(open) => !open && closeDeleteConfirm()}
      >
        <AlertDialog.Content style={{ maxWidth: 450 }}>
          <AlertDialog.Title>Delete Model</AlertDialog.Title>
          <AlertDialog.Description size="2" color="gray" mt="1" mb="4">
            {' '}
            Are you sure you want to delete the model{' '}
            <Strong>{modelToDelete?.name ?? 'this model'}</Strong> from your
            local storage? This action cannot be undone.{' '}
          </AlertDialog.Description>
          {deleteModelMutation.isError && (
            <Callout.Root color="red" size="1" mb="3">
              <Callout.Icon>
                <InfoCircledIcon />
              </Callout.Icon>
              <Callout.Text>
                Error: {deleteModelMutation.error.message}
              </Callout.Text>
            </Callout.Root>
          )}
          <Flex gap="3" mt="4" justify="end">
            <Button
              variant="soft"
              color="gray"
              onClick={closeDeleteConfirm}
              disabled={deleteModelMutation.isPending}
            >
              {' '}
              <Cross2Icon /> Cancel{' '}
            </Button>
            <Button
              color="red"
              onClick={handleConfirmDelete}
              disabled={deleteModelMutation.isPending}
            >
              {' '}
              {deleteModelMutation.isPending ? (
                <>
                  {' '}
                  <Spinner size="2" /> <Text ml="1">Deleting...</Text>{' '}
                </>
              ) : (
                <>
                  {' '}
                  <TrashIcon /> Delete{' '}
                </>
              )}{' '}
            </Button>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </>
  );
}
