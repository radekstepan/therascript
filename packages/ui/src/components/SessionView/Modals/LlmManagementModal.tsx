/* packages/ui/src/components/SessionView/Modals/LlmManagementModal.tsx */
import React, { useState, useEffect, useRef } from 'react';
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
  StopIcon,
  MagnifyingGlassIcon,
  LightningBoltIcon,
  DotsHorizontalIcon,
  TrashIcon,
} from '@radix-ui/react-icons';
import {
  fetchLlmStatus,
  fetchAvailableModels,
  unloadLlmModel,
  startDownloadLlmModel,
  fetchDownloadLlmModelStatus,
  cancelDownloadLlmModel,
  deleteLlmModel,
} from '../../../api/api';
import { toastMessageAtom } from '../../../store';
import { useSetAtom } from 'jotai';
import type {
  LlmModelInfo,
  LlmStatus,
  UIDownloadJobStatus,
  UIDownloadJobStatusState,
} from '../../../types';
import { cn } from '../../../utils';
import prettyBytes from 'pretty-bytes';

interface LlmManagementModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LlmManagementModal({
  isOpen,
  onOpenChange,
}: LlmManagementModalProps) {
  const queryClient = useQueryClient();
  const setToast = useSetAtom(toastMessageAtom);
  const [isWaitingForUnload, setIsWaitingForUnload] = useState(false);
  const [modelUrlToDownload, setModelUrlToDownload] = useState<string>('');

  // Ref for auto-focus
  const downloadUrlInputRef = useRef<HTMLInputElement>(null);

  // State for Polling
  const [pullJobId, setPullJobId] = useState<string | null>(null);
  const [pullingModelName, setPullingModelName] = useState<string | null>(null);

  // State for Delete Confirmation
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [modelToDelete, setModelToDelete] = useState<LlmModelInfo | null>(null);
  // Ref for delete confirm button focus
  const deleteConfirmButtonRef = useRef<HTMLButtonElement>(null);

  // --- Auto-focus on main modal open ---
  useEffect(() => {
    if (isOpen && !pullJobId) {
      // Only focus pull input if not currently pulling
      const timer = setTimeout(() => {
        downloadUrlInputRef.current?.focus();
      }, 50); // Small delay ensures element is ready
      return () => clearTimeout(timer);
    }
  }, [isOpen, pullJobId]);

  // --- Auto-focus on delete confirm modal open ---
  useEffect(() => {
    if (isDeleteConfirmOpen) {
      const timer = setTimeout(() => {
        deleteConfirmButtonRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isDeleteConfirmOpen]);

  // --- Queries and Mutations (Unchanged logic, only ref updates) ---
  const {
    data: llmStatus,
    isLoading: isLoadingStatus,
    error: statusError,
  } = useQuery({
    queryKey: ['llmStatus'],
    queryFn: () => fetchLlmStatus(),
    enabled: isOpen,
    staleTime: 0,
    gcTime: 1000,
    refetchInterval:
      isOpen && (isWaitingForUnload || !!pullJobId) ? 2000 : 10000,
    refetchOnWindowFocus: false,
  });

  const {
    data: availableModelsData,
    isLoading: isLoadingAvailable,
    error: availableError,
    refetch: refetchAvailableModels,
  } = useQuery({
    queryKey: ['availableLlmModels'],
    queryFn: fetchAvailableModels,
    enabled: isOpen,
    staleTime: 10 * 1000,
    gcTime: 1 * 60 * 1000,
  });

  const unloadMutation = useMutation({
    mutationFn: unloadLlmModel,
    onMutate: () => {
      setIsWaitingForUnload(true);
    },
    onSuccess: (data) => {
      setToast(`✅ ${data.message}`);
      queryClient.invalidateQueries({ queryKey: ['llmStatus'] });
    },
    onError: (error: Error) => {
      console.error('Unload request failed:', error);
      setToast(
        `❌ Error: ${error.message || 'Failed to send unload request.'}`
      );
      setIsWaitingForUnload(false);
    },
  });

  const startPullMutation = useMutation({
    mutationFn: startDownloadLlmModel,
    onMutate: (modelUrl: string) => {
      resetPullState(true);
      setPullingModelName(modelUrl);
      console.log(`[LlmModal Mutate] Starting download from ${modelUrl}`);
    },
    onSuccess: (data, modelUrl: string) => {
      console.log(
        `[LlmModal Success] Download job started successfully. Job ID: ${data.jobId} from URL: ${modelUrl}`
      );
      setPullJobId(data.jobId);
      setModelUrlToDownload('');
    },
    onError: (error: Error, modelUrl: string) => {
      console.error(`Error starting download from ${modelUrl}:`, error);
      setToast(`❌ Failed to start download: ${error.message}`);
      resetPullState(false);
    },
  });

  const { data: pullStatus, error: pullStatusError } = useQuery<
    UIDownloadJobStatus,
    Error
  >({
    queryKey: ['llmPullStatus', pullJobId],
    queryFn: () => {
      if (!pullJobId) {
        throw new Error('No Job ID to poll');
      }
      return fetchDownloadLlmModelStatus(pullJobId);
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
              queryKey: ['availableLlmModels'],
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
    mutationFn: cancelDownloadLlmModel,
    onMutate: (jobIdToCancel) => {
      console.log(
        `[LlmModal Mutate] Sending cancel request for job ${jobIdToCancel}...`
      );
      queryClient.setQueryData<UIDownloadJobStatus>(
        ['llmPullStatus', jobIdToCancel],
        (oldData: UIDownloadJobStatus | undefined) =>
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
        queryKey: ['llmPullStatus', jobIdCancelled],
      });
    },
  });

  const deleteModelMutation = useMutation({
    mutationFn: deleteLlmModel,
    onMutate: (modelName: string) => {
      console.log(
        `[LlmModal Mutate] Sending delete request for ${modelName}...`
      );
    },
    onSuccess: (data, modelName) => {
      setToast(`✅ ${data.message || `Model ${modelName} deleted.`}`);
      queryClient.invalidateQueries({ queryKey: ['availableLlmModels'] });
      queryClient.invalidateQueries({ queryKey: ['llmStatus'] });
      closeDeleteConfirm();
    },
    onError: (error: Error, modelName) => {
      console.error(`Error deleting model ${modelName}:`, error);
      setToast(`❌ Failed to delete model ${modelName}: ${error.message}`);
      closeDeleteConfirm();
    },
  });

  // --- Handlers (Unchanged) ---
  const resetPullState = (clearQuery: boolean = true) => {
    const currentJobId = pullJobId;
    setPullJobId(null);
    setPullingModelName(null);
    if (clearQuery && currentJobId) {
      console.log(
        `[LlmModal] Resetting pull state and removing poll query for job ${currentJobId}.`
      );
      queryClient.removeQueries({
        queryKey: ['llmPullStatus', currentJobId],
      });
    }
    startPullMutation.reset();
    cancelPullMutation.reset();
  };
  const handlePullClick = () => {
    const modelUrl = modelUrlToDownload.trim();
    if (
      !modelUrl ||
      startPullMutation.isPending ||
      !!pullJobId ||
      isAnyLoadingProcessActive
    )
      return;
    startPullMutation.mutate(modelUrl);
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

  // Effects for unload confirmation (Unchanged)
  useEffect(() => {
    if (isWaitingForUnload && llmStatus) {
      if (
        llmStatus.modelChecked === llmStatus.activeModel &&
        !llmStatus.loaded
      ) {
        setIsWaitingForUnload(false);
      }
    }
  }, [isWaitingForUnload, llmStatus]);

  // Event Handlers (Unload) (Unchanged)
  const handleUnloadClick = () => {
    if (isAnyOperationActive || unloadMutation.isPending) return;
    unloadMutation.mutate();
  };

  // Handlers for Modals (Unchanged)
  const openDeleteConfirm = (model: LlmModelInfo) => {
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
      setModelUrlToDownload('');
      unloadMutation.reset();
      deleteModelMutation.reset();
      resetPullState(true);
      closeDeleteConfirm();
    }
  };

  // Handle Enter key press in inputs
  const handlePullInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handlePullClick();
    }
  };

  // Loading states (Unchanged)
  const isUnloading = unloadMutation.isPending || isWaitingForUnload;
  const isDeletingSelectedModel = deleteModelMutation.isPending;
  const isPulling =
    !!pullJobId &&
    pullStatus?.status !== 'completed' &&
    pullStatus?.status !== 'failed' &&
    pullStatus?.status !== 'canceled';
  const isCancelingPull =
    cancelPullMutation.isPending || pullStatus?.status === 'canceling';
  const isStartingPull = startPullMutation.isPending;
  const isAnyLoadingProcessActive = isUnloading || isDeletingSelectedModel;
  const isAnyPullProcessActive = isPulling || isCancelingPull || isStartingPull;
  const isAnyOperationActive =
    isAnyLoadingProcessActive || isAnyPullProcessActive;
  const overallError =
    statusError?.message ||
    availableError?.message ||
    unloadMutation.error?.message ||
    pullStatusError?.message ||
    pullStatus?.error ||
    deleteModelMutation.error?.message;

  // UI Display Values (Unchanged)
  const activeModelName = llmStatus?.activeModel ?? 'N/A';
  const isAnyModelLoaded = llmStatus?.loaded ?? false;
  const loadedModelFullName = llmStatus?.details?.name;
  const activeConfiguredContextSize = llmStatus?.configuredContextSize;

  // Render list item function (Changed)
  const renderModelListItem = (model: LlmModelInfo) => {
    const isCurrentlyLoadingThis = isDeletingSelectedModel;
    const isCurrentlyActiveAndLoaded =
      isAnyModelLoaded && loadedModelFullName === model.name;
    const actionsDisabled = isAnyOperationActive || isCurrentlyLoadingThis;
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
              {/* --- UPDATED BADGE FOR CONTEXT SIZE --- */}
              {model.defaultContextSize && model.defaultContextSize > 0 && (
                <Tooltip
                  content={`Default Max Context Size: ${model.defaultContextSize.toLocaleString()} Tokens`}
                >
                  <Badge variant="outline" color="blue" radius="full" size="1">
                    <LightningBoltIcon style={{ marginRight: '2px' }} />
                    {prettyBytes(model.defaultContextSize).replace(' ', '')}
                  </Badge>
                </Tooltip>
              )}
              {/* --- END UPDATED BADGE --- */}
            </Flex>
          </Flex>
          {/* Right Block: Size Badge + Status/Actions */}
          <Flex align="center" gap="2" flexShrink="0">
            {/* Size Badge - Use prettyBytes */}
            <Badge variant="soft" color="gray">
              {prettyBytes(model.size)}
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
                <Spinner size="1" /> Deleting...
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

  // Determine pull progress display values (Unchanged)
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

          {/* Active Model Status (UPDATED) */}
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
                {(isLoadingStatus && !llmStatus) || isWaitingForUnload ? (
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
                <Tooltip
                  content={`Configured Context Size: ${activeConfiguredContextSize ? activeConfiguredContextSize.toLocaleString() : 'Default'}`}
                >
                  <Badge
                    variant="soft"
                    color={activeConfiguredContextSize ? 'blue' : 'gray'}
                    size="1"
                    className={cn(isLoadingStatus ? 'opacity-50' : '')}
                  >
                    <LightningBoltIcon style={{ marginRight: '2px' }} />
                    {/* --- MODIFICATION FOR ACTIVE MODEL CONTEXT SIZE --- */}
                    {isLoadingStatus
                      ? '...'
                      : activeConfiguredContextSize
                        ? prettyBytes(activeConfiguredContextSize).replace(
                            ' ',
                            ''
                          )
                        : 'Default'}
                    {/* --- END MODIFICATION --- */}
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

          {/* Available Models List (Unchanged) */}
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
              Download Model from URL
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
                ref={downloadUrlInputRef} // Attach ref for focus
                style={{ flexGrow: 1 }}
                size="2"
                placeholder="Enter GGUF model URL (e.g., https://huggingface.co/.../model.gguf)"
                value={modelUrlToDownload}
                onChange={(e) => setModelUrlToDownload(e.target.value)}
                disabled={isAnyOperationActive}
                onKeyDown={handlePullInputKeyDown} // Add keydown handler
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
                  disabled={!modelUrlToDownload.trim() || isAnyOperationActive}
                  title={
                    !modelUrlToDownload.trim()
                      ? 'Enter a model URL'
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

          {/* Display General Mutation Errors (Unchanged) */}
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
            !deleteModelMutation.isError && (
              <Callout.Root color="red" size="1" mt="2">
                <Callout.Icon>
                  <ExclamationTriangleIcon />
                </Callout.Icon>
                <Callout.Text>Error: {overallError}</Callout.Text>
              </Callout.Root>
            )}

          {/* Footer Buttons (Unchanged) */}
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
              ref={deleteConfirmButtonRef} // Attach ref for focus
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
