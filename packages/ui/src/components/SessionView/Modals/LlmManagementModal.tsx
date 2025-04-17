// packages/ui/src/components/SessionView/Modals/LlmManagementModal.tsx
import React, { useState, useEffect } from 'react'; // Removed useRef
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
// Import Strong component
import { Dialog, Button, Flex, Text, Box, Spinner, Callout, ScrollArea, Badge, Tooltip, TextField, Separator, Progress, Strong } from '@radix-ui/themes'; // Added Progress and Strong
import {
    InfoCircledIcon, Cross2Icon, CheckCircledIcon, SymbolIcon,
    ReloadIcon, ExclamationTriangleIcon, DownloadIcon, StopIcon, // Added StopIcon
    MagnifyingGlassIcon, LightningBoltIcon, // Added icon for context size
} from '@radix-ui/react-icons';
import {
    fetchOllamaStatus, fetchAvailableModels, unloadOllamaModel,
    setOllamaModel,
    // Renamed and added polling functions
    startPullOllamaModel, fetchPullOllamaModelStatus, cancelPullOllamaModel,
    // Removed SSE types
} from '../../../api/api';
import { toastMessageAtom } from '../../../store';
import { useSetAtom } from 'jotai';
// Added UIPullJobStatus types and state enum
import type { OllamaModelInfo, OllamaStatus, UIPullJobStatus, UIPullJobStatusState } from '../../../types';
import { cn } from '../../../utils'; // Import cn

interface LlmManagementModalProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
}

// Helper to format model size (no change)
const formatBytes = (bytes: number, decimals = 2): string => {
    if (!bytes || bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

export function LlmManagementModal({ isOpen, onOpenChange }: LlmManagementModalProps) {
    const queryClient = useQueryClient();
    const setToast = useSetAtom(toastMessageAtom);
    const [isWaitingForUnload, setIsWaitingForUnload] = useState(false);
    const [loadingModelName, setLoadingModelName] = useState<string | null>(null);
    const [modelToPull, setModelToPull] = useState<string>('');
    const [contextSizes, setContextSizes] = useState<Record<string, string>>({});

    // --- State for Polling ---
    const [pullJobId, setPullJobId] = useState<string | null>(null);
    const [pullingModelName, setPullingModelName] = useState<string | null>(null); // Keep track of which model the jobId relates to
    // Status/progress now comes from useQuery data
    // --- End Polling State ---

    // --- Queries and Mutations ---
    const { data: ollamaStatus, isLoading: isLoadingStatus, error: statusError } = useQuery({
        queryKey: ['ollamaStatus'],
        queryFn: () => fetchOllamaStatus(),
        enabled: isOpen, // Only fetch when modal is open
        staleTime: 0, // Fetch fresh status on open
        gcTime: 1000, // Short cache time
        // Poll status less frequently unless an operation is active
        refetchInterval: isOpen && (isWaitingForUnload || loadingModelName || !!pullJobId) ? 2000 : 10000,
        refetchOnWindowFocus: false, // Don't refetch just on focus
    });

    const { data: availableModelsData, isLoading: isLoadingAvailable, error: availableError, refetch: refetchAvailableModels } = useQuery({
        queryKey: ['availableOllamaModels'],
        queryFn: fetchAvailableModels,
        enabled: isOpen, // Only fetch when modal is open
        staleTime: 10 * 1000, // Cache for a bit longer
        gcTime: 1 * 60 * 1000,
     });

    const unloadMutation = useMutation({
        mutationFn: unloadOllamaModel,
        onMutate: () => { setLoadingModelName(null); setIsWaitingForUnload(true); },
        onSuccess: (data) => { setToast(`✅ ${data.message}`); queryClient.invalidateQueries({ queryKey: ['ollamaStatus'] }); },
        onError: (error: Error) => { console.error("Unload request failed:", error); setToast(`❌ Error: ${error.message || 'Failed to send unload request.'}`); setIsWaitingForUnload(false); },
    });

    const setModelMutation = useMutation({
        mutationFn: (variables: { modelName: string; contextSize?: number | null }) => {
            const { modelName, contextSize } = variables;
            setLoadingModelName(modelName);
            setIsWaitingForUnload(false); // Reset unload waiting state
            return setOllamaModel(modelName, contextSize);
        },
        onSuccess: (data, variables) => {
            setToast(`✅ ${data.message}`);
            console.log(`[LlmModal] Set model request successful for ${variables.modelName}. Waiting for status update...`);
            queryClient.invalidateQueries({ queryKey: ['ollamaStatus'] });
            // Clear context size input for the newly set model
            setContextSizes(prev => ({ ...prev, [variables.modelName]: '' }));
            // setLoadingModelName(null); // Loading confirmation handled by useEffect
        },
        onError: (error: Error, variables) => {
            console.error(`Set model request failed for ${variables.modelName}:`, error);
            setToast(`❌ Error setting model ${variables.modelName}: ${error.message || 'Request failed.'}`);
            setLoadingModelName(null); // Clear loading state on error
        },
    });

    // --- NEW: Mutation to Start Pull Job ---
    const startPullMutation = useMutation({
         mutationFn: startPullOllamaModel, // Uses the renamed API function
         onMutate: (modelName: string) => { // --- FIX: variables is the modelName string ---
            // Clear previous job state before starting new one
            // Use 'true' to clear potentially running poll query for a previous job
            resetPullState(true);
            // Track which model we are *trying* to pull
            setPullingModelName(modelName); // --- FIX: Use modelName directly ---
            console.log(`[LlmModal Mutate] Starting pull for ${modelName}`);
         },
         onSuccess: (data, modelName: string) => { // --- FIX: variables is the modelName string --- data = { jobId: string }
             console.log(`[LlmModal Success] Pull job started successfully. Job ID: ${data.jobId} for Model: ${modelName}`); // --- FIX: Use modelName directly ---
             // Set the jobId - this will enable the polling query below
             setPullJobId(data.jobId);
             setModelToPull(''); // Clear input field
             // Polling query (`pullStatusQuery`) will automatically enable and start fetching
         },
         onError: (error: Error, modelName: string) => { // --- FIX: variables is the modelName string ---
             console.error(`Error starting pull job for ${modelName}:`, error); // --- FIX: Use modelName directly ---
             setToast(`❌ Failed to start download: ${error.message}`);
             // Reset UI state, don't clear poll query as it likely never started or enabled
             resetPullState(false);
         },
    });

     // --- NEW: Query to Poll Pull Status ---
     const { data: pullStatus, error: pullStatusError } = useQuery<UIPullJobStatus, Error>({
         queryKey: ['ollamaPullStatus', pullJobId], // Include jobId in the query key
         queryFn: () => {
             if (!pullJobId) {
                 // Should not happen if enabled correctly, but defensively handle
                 console.warn("[Pull Query] Attempted fetch without pullJobId.");
                 throw new Error("No Job ID to poll");
             }
             // Call the API function to fetch status
             return fetchPullOllamaModelStatus(pullJobId);
         },
         enabled: !!pullJobId, // Only run this query if pullJobId is set
         refetchInterval: (query) => {
             // Decide polling interval based on current status
             const statusData = query.state.data;
             // Stop polling if completed, failed, or canceled
             if (statusData?.status === 'completed' || statusData?.status === 'failed' || statusData?.status === 'canceled') {
                 console.log(`[Pull Query ${pullJobId}] Status is terminal (${statusData.status}). Stopping polling.`);

                 // Perform final actions based on terminal status
                 if (statusData.status === 'completed') {
                     setToast(`✅ Pull complete for ${statusData.modelName}.`);
                     // Refresh available models list after a short delay
                     setTimeout(() => {
                         console.log("[LlmModal] Pull complete (via polling), refreshing available models list.");
                         queryClient.invalidateQueries({ queryKey: ['availableOllamaModels'] });
                         // TODO: Should we trigger refetch explicitly or rely on invalidation?
                         // refetchAvailableModels(); // Optional explicit refetch
                         resetPullState(false); // Reset UI state but keep query data briefly visible
                     }, 1500);
                 } else if (statusData.status === 'failed') {
                      setToast(`❌ Pull failed for ${statusData.modelName}: ${statusData.error || 'Unknown reason'}`);
                      // State is reset by user action (Retry or Close) or next pull attempt
                      // resetPullState(false); // Keep state to show error
                 } else if (statusData.status === 'canceled') {
                      setToast(`⏹️ Pull canceled for ${statusData.modelName}.`);
                      resetPullState(false); // Reset UI state after cancellation confirmed
                 }
                 return false; // Stop interval
             }
             // Poll frequently while active
             return 2000; // Poll every 2 seconds otherwise
         },
         refetchIntervalInBackground: false, // Don't poll if tab is not visible
         refetchOnWindowFocus: false, // Don't refetch on focus, rely on interval
         retry: (failureCount, error) => { // Custom retry logic
             // Don't retry endlessly if job ID not found (e.g., 404 from API)
             if (error.message.includes('404') || error.message.includes('not found')) {
                 console.error(`[Pull Query ${pullJobId}] Job ID not found on server. Stopping polling.`);
                 setToast(`❌ Error: Download job ${pullJobId} not found.`);
                 resetPullState(false); // Reset state if job disappears
                 return false; // Stop retrying
             }
             // Default retry behavior for other errors (e.g., network issues)
             return failureCount < 3;
         },
         gcTime: 5 * 60 * 1000, // Keep status data in cache for 5 mins after polling stops
     });

    // --- NEW: Mutation to Cancel Pull Job ---
    const cancelPullMutation = useMutation({
        mutationFn: cancelPullOllamaModel, // Uses the new API function
        onMutate: (jobIdToCancel) => {
             console.log(`[LlmModal Mutate] Sending cancel request for job ${jobIdToCancel}...`);
             // Optionally update UI immediately to "Canceling..."
             // The polling query will eventually reflect the 'canceled' or 'canceling' status from backend.
             // We can optimistically update the cached status:
             queryClient.setQueryData<UIPullJobStatus>(['ollamaPullStatus', jobIdToCancel], (oldData) =>
                oldData ? { ...oldData, status: 'canceling', message: 'Cancellation requested...' } : oldData
             );
        },
        onSuccess: (data, jobIdCancelled) => {
            setToast(`✅ ${data.message}`);
            // Polling query will eventually stop itself when backend confirms cancellation.
            // We might force invalidation to speed it up if needed:
            // queryClient.invalidateQueries({ queryKey: ['ollamaPullStatus', jobIdCancelled] });
        },
        onError: (error: Error, jobIdCancelled) => {
             console.error(`Error cancelling pull job ${jobIdCancelled}:`, error);
             setToast(`❌ Failed to cancel download: ${error.message}`);
             // Revert optimistic UI update if one was made
             queryClient.invalidateQueries({ queryKey: ['ollamaPullStatus', jobIdCancelled] });
        },
    });
    // --- End Mutations & Queries ---

    // --- Handlers for Pulling ---
    const resetPullState = (clearQuery: boolean = true) => {
        const currentJobId = pullJobId; // Capture before clearing state
        setPullJobId(null); // This disables the polling query
        setPullingModelName(null); // Clear the tracked model name

        // If requested, explicitly remove the query data from the cache
        // This prevents stale data from showing if the modal is reopened quickly
        if (clearQuery && currentJobId) {
            console.log(`[LlmModal] Resetting pull state and removing poll query for job ${currentJobId}.`);
            queryClient.removeQueries({ queryKey: ['ollamaPullStatus', currentJobId] });
        }
         // Reset mutation states as well
         startPullMutation.reset();
         cancelPullMutation.reset();
    };

    const handlePullClick = () => {
        const modelName = modelToPull.trim();
        // Prevent starting if already pulling, starting, or another operation is active
        if (!modelName || startPullMutation.isPending || !!pullJobId || isAnyLoadingProcessActive) return;
        // Call the mutation to start the job
        // --- FIX: Pass only the string modelName ---
        startPullMutation.mutate(modelName);
        // --- END FIX ---
    };

     const handleCancelPullClick = () => {
         // Can only cancel if we have a job ID and cancel mutation isn't already running
         if (pullJobId && !cancelPullMutation.isPending) {
            // Check the *current* status from the polling query data
            const currentStatus = pullStatus?.status;
            if (currentStatus && currentStatus !== 'completed' && currentStatus !== 'failed' && currentStatus !== 'canceled') {
                // Initiate the cancel mutation
                cancelPullMutation.mutate(pullJobId);
            } else {
                 console.log(`[LlmModal] Cannot cancel job ${pullJobId}, status is already terminal: ${currentStatus}`);
                 setToast(`Job already ${currentStatus}.`);
            }
         }
     };
     // --- End Pull Handlers ---

    // Effects for unload/load confirmation (no change)
    useEffect(() => {
        if (isWaitingForUnload && ollamaStatus) {
             if (ollamaStatus.modelChecked === ollamaStatus.activeModel && !ollamaStatus.loaded) {
                 console.log("[LlmModal] Unload confirmed by status query.");
                 setIsWaitingForUnload(false);
             }
        }
    }, [isWaitingForUnload, ollamaStatus]);
     useEffect(() => {
        if (loadingModelName && ollamaStatus) {
             // Confirm load only if the checked model matches the one we are waiting for AND it's loaded
             if (ollamaStatus.modelChecked === loadingModelName && ollamaStatus.loaded) {
                 console.log(`[LlmModal] Load for ${loadingModelName} confirmed via status query. Clearing spinner.`);
                 setLoadingModelName(null); // Stop showing "Loading..." on the button
             }
         }
     }, [loadingModelName, ollamaStatus]); // Depend on both loadingModelName and ollamaStatus

    // Cleanup effect for polling query (no change needed, handled by useQuery's lifecycle + enabled flag)


    // Event Handlers (Unload, Load, Context Change) - Disable based on combined loading state
    const handleUnloadClick = () => {
        if (isAnyOperationActive || unloadMutation.isPending) return;
        unloadMutation.mutate();
    };
    const handleLoadClick = (modelName: string) => {
        if (isAnyOperationActive || setModelMutation.isPending) return;
        const contextSizeStr = contextSizes[modelName] || '';
        const contextSizeNum = contextSizeStr ? parseInt(contextSizeStr, 10) : null;
        const contextSizeToSend = (contextSizeNum !== null && !isNaN(contextSizeNum) && contextSizeNum > 0) ? contextSizeNum : null;
        if (contextSizeStr && contextSizeToSend === null) {
            setToast('⚠️ Invalid context size. Must be a positive number. Using default.');
        }
        setModelMutation.mutate({ modelName, contextSize: contextSizeToSend });
    };
    const handleContextSizeChange = (modelName: string, value: string) => {
        const sanitizedValue = value.replace(/[^0-9]/g, ''); // Allow only digits
        setContextSizes(prev => ({ ...prev, [modelName]: sanitizedValue }));
    };

    // Manual Close Handler (adjusted loading check)
    const handleManualClose = (open: boolean) => {
         // Prevent close if any operation is active *unless* it has failed
         const hasFailedJob = pullStatus?.status === 'failed' || !!pullStatusError;
         const isActiveJob = !!pullJobId && pullStatus?.status !== 'completed' && pullStatus?.status !== 'failed' && pullStatus?.status !== 'canceled';

         if (!open && (isAnyLoadingProcessActive || (isActiveJob && !hasFailedJob))) {
            console.log("Preventing modal close while operation is active.");
            // TODO: Maybe add a toast message here explaining why it didn't close?
            return;
         }
         onOpenChange(open); // Call the parent handler
         if (!open) { // Reset states only when actually closing
             setIsWaitingForUnload(false);
             setLoadingModelName(null);
             setModelToPull('');
             setContextSizes({});
             unloadMutation.reset();
             setModelMutation.reset();
             // Reset pull state fully, including removing the query data
             resetPullState(true);
         }
     };

    // --- Loading states ---
    const isUnloading = unloadMutation.isPending || isWaitingForUnload;
    const isLoadingSelectedModel = setModelMutation.isPending || loadingModelName !== null;
    // Determine if pulling based on jobId and poll status state
    const isPulling = !!pullJobId && pullStatus?.status !== 'completed' && pullStatus?.status !== 'failed' && pullStatus?.status !== 'canceled';
    const isCancelingPull = cancelPullMutation.isPending || pullStatus?.status === 'canceling';
    const isStartingPull = startPullMutation.isPending;

    // Combined loading/operation states for disabling UI elements
    const isAnyLoadingProcessActive = isUnloading || isLoadingSelectedModel; // Load/unload
    const isAnyPullProcessActive = isPulling || isCancelingPull || isStartingPull; // Pull start/active/cancel
    const isAnyOperationActive = isAnyLoadingProcessActive || isAnyPullProcessActive;

    // Determine overall error to display at the bottom
    const overallError = statusError?.message || availableError?.message || unloadMutation.error?.message || setModelMutation.error?.message || pullStatusError?.message || pullStatus?.error;

    // --- UI Display Values ---
    const activeModelName = ollamaStatus?.activeModel ?? 'N/A';
    const isAnyModelLoaded = ollamaStatus?.loaded ?? false;
    const loadedModelFullName = ollamaStatus?.details?.name;
    const activeConfiguredContextSize = ollamaStatus?.configuredContextSize;

    // Render list item function (adjusted disable logic)
    const renderModelListItem = (model: OllamaModelInfo) => {
        const isCurrentlyLoadingThis = isLoadingSelectedModel && loadingModelName === model.name;
        const isCurrentlyActiveAndLoaded = isAnyModelLoaded && activeModelName === model.name;
        // Disable load if *any* operation is active
        const canLoad = !isCurrentlyActiveAndLoaded && !isAnyOperationActive;
        const currentContextInput = contextSizes[model.name] || '';

        return (
            <Box key={model.digest} p="2" style={{ borderBottom: '1px solid var(--gray-a3)' }}>
                {/* Row 1: Name and Size */}
                <Flex justify="between" align="center" gap="2" mb="2">
                    <Text size="2" weight="medium" truncate title={model.name}>{model.name}</Text>
                    <Badge variant="soft" color="gray">{formatBytes(model.size)}</Badge>
                </Flex>
                {/* Row 2: Tags, Context Input, Action Button */}
                 <Flex justify="between" align="center" gap="2" mt="1" wrap="wrap">
                     {/* Left side: Tags */}
                     <Flex gap="2" wrap="wrap" align="center" style={{ flexGrow: 1, minWidth: '150px' }}>
                         {model.details?.family && <Badge variant="outline" color="gray" radius="full">{model.details.family}</Badge>}
                         {model.details?.parameter_size && <Badge variant="outline" color="gray" radius="full">{model.details.parameter_size}</Badge>}
                         {model.details?.quantization_level && <Badge variant="outline" color="gray" radius="full">{model.details.quantization_level}</Badge>}
                     </Flex>
                     {/* Right side: Context Input and Action Button */}
                     <Flex align="center" gap="2" flexShrink="0" style={{ marginLeft: 'auto' }}>
                         {/* Context Size Input (only show if not active) */}
                         {!isCurrentlyActiveAndLoaded && (
                            <TextField.Root
                                size="1" placeholder="Ctx (def)"
                                value={currentContextInput}
                                onChange={(e) => handleContextSizeChange(model.name, e.target.value)}
                                // Disable if cannot load
                                disabled={!canLoad}
                                style={{ width: '80px' }}
                                title="Optional: Override context window size (num_ctx)."
                                type="number" min="1" step="1" // Basic numeric input
                            >
                                <TextField.Slot> <LightningBoltIcon height="14" width="14" /> </TextField.Slot>
                            </TextField.Root>
                         )}
                         {/* Load/Loading/Loaded Button */}
                         {isCurrentlyLoadingThis ? (
                            // Show spinner while this specific model is being loaded
                            <Button size="1" variant="ghost" disabled style={{ minWidth: '95px', justifyContent: 'center' }}> <Spinner size="1"/> Loading... </Button>
                         ) : isCurrentlyActiveAndLoaded ? (
                            // Show Active badge if this model is the one loaded
                            <Badge color="green" variant='soft' size="1" style={{ minWidth: '95px', justifyContent: 'center', display: 'inline-flex' }}><CheckCircledIcon/> Active</Badge>
                         ) : (
                            // Show Set Active button otherwise
                            <Button
                                size="1" variant="outline"
                                onClick={() => handleLoadClick(model.name)}
                                disabled={!canLoad} // Use combined disable logic
                                title={canLoad ? `Set ${model.name} as Active` : (isAnyOperationActive ? 'Operation in progress...' : 'Model already active')}
                                style={{ minWidth: '95px' }}
                            > <DownloadIcon/> Set Active </Button>
                         )}
                     </Flex>
                 </Flex>
            </Box>
        );
    };

    // Determine pull progress display values from useQuery data
    // Fallback to 0 or 100 based on terminal states if progress not available
    const displayPullProgress = pullStatus?.progress ?? (pullStatus?.status === 'completed' ? 100 : (pullStatus?.status === 'failed' || pullStatus?.status === 'canceled' ? 0 : 0));
    const displayPullMessage = pullStatus?.message || (startPullMutation.isPending ? 'Starting download job...' : '');
    // Show the model name we intended to pull, or the one from the status if available
    const displayPullModelName = pullingModelName || pullStatus?.modelName || '';
    const displayPullError = pullStatusError?.message || pullStatus?.error; // Combine query error and job error


    return (
        <Dialog.Root open={isOpen} onOpenChange={handleManualClose}>
            <Dialog.Content style={{ maxWidth: 600 }}>
                <Dialog.Title>Manage Language Model</Dialog.Title>
                <Dialog.Description size="2" mb="4" color="gray">
                    View models, set the active model and context size, or download new models.
                </Dialog.Description>

                {/* Active Model Status */}
                <Box mb="4" p="3" style={{ backgroundColor: 'var(--gray-a2)', borderRadius: 'var(--radius-3)' }}>
                     <Text as="div" size="1" weight="medium" color="gray" mb="2">Active Model Status</Text>
                    <Flex align="center" justify="between" gap="3">
                        <Flex align="center" gap="2" style={{ minWidth: 0 }}>
                            {(isLoadingStatus && !ollamaStatus) || isWaitingForUnload ? <Spinner size="2" /> :
                             isAnyModelLoaded ? <CheckCircledIcon width="18" height="18" className="text-green-600" /> :
                             <SymbolIcon width="18" height="18" className="text-gray-500" />}
                            <Text size="3" weight="bold" truncate title={activeModelName}>{activeModelName}</Text>
                            <Tooltip content={`Configured Context Size (num_ctx)`}>
                                <Badge variant='soft' color={activeConfiguredContextSize ? "blue" : "gray"} size="1" className={cn(isLoadingStatus ? 'opacity-50' : '')} >
                                    <LightningBoltIcon style={{ marginRight: '2px' }}/>
                                    {isLoadingStatus ? '...' : (activeConfiguredContextSize ? activeConfiguredContextSize.toLocaleString() : 'Default')}
                                </Badge>
                            </Tooltip>
                            {isAnyModelLoaded && loadedModelFullName && loadedModelFullName !== activeModelName && (
                                <Tooltip content={`Loaded: ${loadedModelFullName}`}><InfoCircledIcon className='text-blue-500'/></Tooltip>
                            )}
                        </Flex>
                        <Button color="orange" variant="soft" size="1" onClick={handleUnloadClick} disabled={!isAnyModelLoaded || isAnyOperationActive} title={!isAnyModelLoaded ? "No model loaded" : "Unload active model"} >
                             {isUnloading ? ( <> <Spinner size="1"/> Unloading... </> ) : ( <> <ReloadIcon/> Unload </> )}
                        </Button>
                    </Flex>
                     {statusError && !isAnyLoadingProcessActive && ( <Callout.Root color="red" size="1" mt="2"><Callout.Icon><ExclamationTriangleIcon/></Callout.Icon><Callout.Text>Error checking status: {statusError.message}</Callout.Text></Callout.Root> )}
                </Box>

                {/* Available Models List */}
                <Box mb="4">
                     <Flex justify="between" align="center" mb="2">
                        <Text as="div" size="1" weight="medium" color="gray">Available Local Models</Text>
                        <Button variant="ghost" size="1" onClick={() => refetchAvailableModels()} disabled={isLoadingAvailable || isAnyOperationActive} title="Refresh list">
                             <ReloadIcon className={isLoadingAvailable ? 'animate-spin' : ''}/>
                         </Button>
                    </Flex>
                    <ScrollArea type="auto" scrollbars="vertical" style={{ maxHeight: '250px', border: '1px solid var(--gray-a6)', borderRadius: 'var(--radius-3)' }}>
                        {/* Add padding-right to prevent scrollbar overlap */}
                        <Box pr="2">
                            {isLoadingAvailable && ( <Flex align="center" justify="center" p="4"><Spinner size="2" /> <Text ml="2" color="gray" size="2">Loading available models...</Text></Flex> )}
                            {availableError && ( <Callout.Root color="red" size="1" m="2"><Callout.Icon><ExclamationTriangleIcon/></Callout.Icon><Callout.Text>Error loading available models: {availableError.message}</Callout.Text></Callout.Root> )}
                            {!isLoadingAvailable && !availableError && availableModelsData?.models.length === 0 && ( <Flex align="center" justify="center" p="4"><Text color="gray" size="2">No models found locally.</Text></Flex> )}
                            {!isLoadingAvailable && !availableError && availableModelsData && availableModelsData.models.length > 0 && ( <> {availableModelsData.models.sort((a, b) => a.name.localeCompare(b.name)).map(renderModelListItem)} </> )}
                        </Box>
                    </ScrollArea>
                </Box>

                {/* Download New Model Section (Polling Version) */}
                <Separator my="3" size="4" />
                <Box mb="4">
                    <Text as="div" size="1" weight="medium" color="gray" mb="2">Download New Model</Text>
                    {/* --- Pull Progress Display (reads from pullStatus query) --- */}
                    {/* Show if starting, pulling, canceling, or if there's final status data */}
                    {(isStartingPull || isPulling || isCancelingPull || pullStatus) && displayPullModelName && (
                         <Box mb="2">
                             <Text size="1" color="gray" mb="1">
                                Status for <Strong>{displayPullModelName}</Strong>:
                             </Text>
                             {/* Show progress bar only if status indicates active work */}
                             {(pullStatus?.status === 'downloading' || pullStatus?.status === 'verifying' || pullStatus?.status === 'parsing') && (
                                 <Progress value={displayPullProgress} size="2" mt="1" mb="1"/>
                             )}
                             {/* --- MODIFICATION: Hide status message text when completed or canceled/canceling --- */}
                             {pullStatus?.status !== 'completed' && pullStatus?.status !== 'canceled' && pullStatus?.status !== 'canceling' && (
                                 <Text size="1" color="gray" mt="1" align="center">{displayPullMessage}</Text>
                             )}
                             {/* --- END MODIFICATION --- */}
                         </Box>
                    )}
                    {/* --- Pull Error Display (reads from pullStatus query or error state) --- */}
                    {/* Show error only when *not* actively pulling/canceling/starting */}
                    {displayPullError && !isPulling && !isCancelingPull && !isStartingPull && (
                        <Callout.Root color="red" size="1" mt="0" mb="2">
                            <Callout.Icon><ExclamationTriangleIcon/></Callout.Icon>
                            <Callout.Text>{displayPullError}</Callout.Text>
                        </Callout.Root>
                    )}
                    {/* --- Input and Buttons --- */}
                    <Flex gap="2">
                        <TextField.Root
                            style={{ flexGrow: 1 }} size="2"
                            placeholder="Enter model name (e.g., llama3:latest, mistral:7b)"
                            value={modelToPull}
                            onChange={(e) => setModelToPull(e.target.value)}
                            // Disable if any operation is active (incl. starting pull)
                            disabled={isAnyOperationActive}
                         />
                         {/* Show Cancel button if actively pulling or canceling */}
                         {(isPulling || isCancelingPull) ? (
                             <Button
                                 color="red" variant="soft"
                                 onClick={handleCancelPullClick}
                                 // Disable if cancel already pending or no job ID, or if job is already terminal
                                 disabled={cancelPullMutation.isPending || !pullJobId || pullStatus?.status === 'canceling' || pullStatus?.status === 'canceled' || pullStatus?.status === 'completed' || pullStatus?.status === 'failed'}
                                 title="Cancel download"
                             >
                                 {cancelPullMutation.isPending || pullStatus?.status === 'canceling' ? ( <> <Spinner size="1"/> Canceling... </> ) : ( <><StopIcon/> Cancel</> )}
                             </Button>
                         ) : ( // Show Download button otherwise
                             <Button
                                onClick={handlePullClick}
                                // Disable if no text, any operation active, or start mutation pending
                                disabled={!modelToPull.trim() || isAnyOperationActive}
                                title={!modelToPull.trim() ? "Enter a model name" : "Download model"}
                             >
                                {startPullMutation.isPending ? ( <> <Spinner size="1"/> Starting... </> ) : ( <><MagnifyingGlassIcon/> Download</> )}
                            </Button>
                         )}
                    </Flex>
                </Box>

                {/* Display General Mutation Errors (not pull-related) */}
                {unloadMutation.isError && ( <Callout.Root color="red" size="1" mt="2"><Callout.Icon><ExclamationTriangleIcon/></Callout.Icon><Callout.Text>Error during unload: {unloadMutation.error.message}</Callout.Text></Callout.Root> )}
                {setModelMutation.isError && ( <Callout.Root color="red" size="1" mt="2"><Callout.Icon><ExclamationTriangleIcon/></Callout.Icon><Callout.Text>Error setting model: {setModelMutation.error.message}</Callout.Text></Callout.Root> )}
                 {/* Display overallError if it's not covered by specific pull error display */}
                 {overallError && !displayPullError && (
                     <Callout.Root color="red" size="1" mt="2"><Callout.Icon><ExclamationTriangleIcon/></Callout.Icon><Callout.Text>Error: {overallError}</Callout.Text></Callout.Root>
                 )}


                {/* Footer Buttons */}
                <Flex gap="3" mt="4" justify="end">
                     {/* Close button: Disable if any operation is active, UNLESS that operation has failed */}
                     <Button
                        type="button"
                        variant="soft"
                        color="gray"
                        onClick={() => handleManualClose(false)}
                        // Disable closing if any operation is active AND the pull job hasn't failed
                        disabled={isAnyOperationActive && !(pullStatus?.status === 'failed' || !!pullStatusError)}
                     >
                         <Cross2Icon /> Close
                     </Button>
                </Flex>
            </Dialog.Content>
        </Dialog.Root>
    );
}
