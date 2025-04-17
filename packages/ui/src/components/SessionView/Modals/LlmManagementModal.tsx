// packages/ui/src/components/SessionView/Modals/LlmManagementModal.tsx
import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, Button, Flex, Text, Box, Spinner, Callout, ScrollArea, Badge, Tooltip } from '@radix-ui/themes';
import {
    InfoCircledIcon, Cross2Icon, CheckCircledIcon, SymbolIcon,
    ReloadIcon, ExclamationTriangleIcon, DownloadIcon
} from '@radix-ui/react-icons';
import {
    fetchOllamaStatus, fetchAvailableModels, unloadOllamaModel,
    setOllamaModel // Use the new API call
} from '../../../api/api';
import { toastMessageAtom } from '../../../store';
import { useSetAtom } from 'jotai';
import type { OllamaModelInfo, OllamaStatus } from '../../../types';

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

export function LlmManagementModal({ isOpen, onOpenChange }: LlmManagementModalProps) {
    const queryClient = useQueryClient();
    const setToast = useSetAtom(toastMessageAtom);
    const [isWaitingForUnload, setIsWaitingForUnload] = useState(false);
    const [loadingModelName, setLoadingModelName] = useState<string | null>(null);
    // Removed polling state and refs


    // Ollama status query - Polls while modal is open to catch load/unload completion
    const { data: ollamaStatus, isLoading: isLoadingStatus, error: statusError } = useQuery({
        queryKey: ['ollamaStatus'],
        queryFn: () => fetchOllamaStatus(), // Fetch default/active status
        enabled: isOpen,
        staleTime: 0,
        gcTime: 1000,
        // Poll status reasonably fast while modal is open OR waiting for unload
        refetchInterval: isOpen || isWaitingForUnload ? 2000 : false,
        refetchOnWindowFocus: false,
    });

    // Available models query
    const { data: availableModelsData, isLoading: isLoadingAvailable, error: availableError } = useQuery({
        queryKey: ['availableOllamaModels'],
        queryFn: fetchAvailableModels,
        enabled: isOpen,
        staleTime: 5 * 60 * 1000,
        gcTime: 10 * 60 * 1000,
     });

    // Unload Mutation
    const unloadMutation = useMutation({
        mutationFn: unloadOllamaModel,
        onMutate: () => {
            setLoadingModelName(null); // Clear any load spinner
            setIsWaitingForUnload(true);
        },
        onSuccess: (data) => {
            setToast(`✅ ${data.message}`);
            console.log("[LlmModal] Unload request accepted. Waiting for status update via polling...");
            // Invalidate immediately to hopefully speed up the poll
            queryClient.invalidateQueries({ queryKey: ['ollamaStatus'] });
        },
        onError: (error: Error) => {
            console.error("Unload request failed:", error);
            setToast(`❌ Error: ${error.message || 'Failed to send unload request.'}`);
            setIsWaitingForUnload(false);
        },
        // onSettled: () => { // Let polling handle final state
        //     setIsWaitingForUnload(false);
        // }
    });


    // Set Model Mutation
    const setModelMutation = useMutation({
        mutationFn: (modelName: string) => {
            setLoadingModelName(modelName); // Set loading state for this specific model
            setIsWaitingForUnload(false); // Stop unload polling if setting a new model
            return setOllamaModel(modelName); // Call the new API
        },
        onSuccess: (data, modelName) => {
            setToast(`✅ ${data.message}`);
            console.log(`[LlmModal] Set model request successful for ${modelName}. Waiting for status update...`);
            // Invalidate the main status query - the refetchInterval should pick up the loading state
            queryClient.invalidateQueries({ queryKey: ['ollamaStatus'] });
            // We don't need manual polling anymore
        },
        onError: (error: Error, modelName) => {
            console.error(`Set model request failed for ${modelName}:`, error);
            setToast(`❌ Error setting model ${modelName}: ${error.message || 'Request failed.'}`);
            setLoadingModelName(null); // Clear loading spinner on error
        },
        // onSettled: Let the status query confirm the load state naturally
    });


    // Effect to stop *unload* waiting state when confirmed by status query
    useEffect(() => {
        if (isWaitingForUnload && ollamaStatus) {
             // If the status check was for the active model and it's now unloaded
             if (ollamaStatus.modelChecked === ollamaStatus.activeModel && !ollamaStatus.loaded) {
                 console.log("[LlmModal] Unload confirmed by status query.");
                 setIsWaitingForUnload(false);
             }
        }
     }, [isWaitingForUnload, ollamaStatus]);

    // Effect to clear loading spinner once the target model IS reported as loaded
     useEffect(() => {
         if (loadingModelName && ollamaStatus) {
             // If the status query confirms the model we tried to load is now the active *and* loaded one
             if (ollamaStatus.activeModel === loadingModelName && ollamaStatus.loaded) {
                 console.log(`[LlmModal] Load for ${loadingModelName} confirmed via status query. Clearing spinner.`);
                 setLoadingModelName(null);
             }
             // Add a timeout failsafe? If still loading after X seconds, clear spinner?
         }
     }, [loadingModelName, ollamaStatus]);


    const handleUnloadClick = () => { if (unloadMutation.isPending || isWaitingForUnload || setModelMutation.isPending || loadingModelName) return; unloadMutation.mutate(); };
    // Update Load Click handler to use setModelMutation
    const handleLoadClick = (modelName: string) => { if (setModelMutation.isPending || isWaitingForUnload || loadingModelName) return; setModelMutation.mutate(modelName); };


    // Is *any* operation (unload or set/load) actively being processed?
    const isUnloading = unloadMutation.isPending || isWaitingForUnload;
    const isLoadingSelectedModel = setModelMutation.isPending || loadingModelName !== null;
    const isAnyLoadingProcessActive = isUnloading || isLoadingSelectedModel;


    const activeModelName = ollamaStatus?.activeModel ?? 'N/A'; // Use activeModel from status response
    const isAnyModelLoaded = ollamaStatus?.loaded ?? false; // Status of the *checked* model (usually active)
    const loadedModelFullName = ollamaStatus?.details?.name;
    const overallError = statusError || availableError || unloadMutation.error || setModelMutation.error;


    const handleManualClose = (open: boolean) => {
        if (!open && isAnyLoadingProcessActive) return;
        onOpenChange(open);
        if (!open) {
            setIsWaitingForUnload(false);
            setLoadingModelName(null);
            unloadMutation.reset();
            setModelMutation.reset();
        }
    };

    const renderModelListItem = (model: OllamaModelInfo) => {
        const isCurrentlyLoadingThis = isLoadingSelectedModel && loadingModelName === model.name;
        // Is this model the currently active *and* loaded one?
        const isCurrentlyActiveAndLoaded = isAnyModelLoaded && activeModelName === model.name;
        const canLoad = !isCurrentlyActiveAndLoaded && !isAnyLoadingProcessActive;

        return (
            <Box key={model.digest} p="2" style={{ borderBottom: '1px solid var(--gray-a3)' }}>
                <Flex justify="between" align="center" gap="2">
                    <Text size="2" weight="medium" truncate title={model.name}>{model.name}</Text>
                    <Flex align="center" gap="2">
                         <Badge variant="soft" color="gray">{formatBytes(model.size)}</Badge>
                         {/* Load/Loading/Loaded Button */}
                         {isCurrentlyLoadingThis ? (
                             <Button size="1" variant="ghost" disabled>
                                 <Spinner size="1"/> Loading...
                             </Button>
                         ) : isCurrentlyActiveAndLoaded ? (
                             <Badge color="green" variant='soft' size="1"><CheckCircledIcon/> Active</Badge>
                         ) : (
                             <Button
                                 size="1"
                                 variant="outline"
                                 onClick={() => handleLoadClick(model.name)} // Calls setModelMutation now
                                 disabled={!canLoad}
                                 title={canLoad ? `Set ${model.name} as Active` : (isAnyLoadingProcessActive ? 'Operation in progress...' : 'Model already active')}
                             >
                                 <DownloadIcon/> Set Active
                             </Button>
                         )}
                    </Flex>
                </Flex>
                <Flex gap="2" mt="1" wrap="wrap">
                     {model.details?.family && <Badge variant="outline" color="gray" radius="full">{model.details.family}</Badge>}
                     {model.details?.parameter_size && <Badge variant="outline" color="gray" radius="full">{model.details.parameter_size}</Badge>}
                     {model.details?.quantization_level && <Badge variant="outline" color="gray" radius="full">{model.details.quantization_level}</Badge>}
                </Flex>
            </Box>
        );
    };


    return (
        <Dialog.Root open={isOpen} onOpenChange={handleManualClose}>
            <Dialog.Content style={{ maxWidth: 600 }}>
                <Dialog.Title>Manage Language Model</Dialog.Title>
                <Dialog.Description size="2" mb="4" color="gray">
                    View available models and set the active model for chatting. The active model is loaded into memory.
                    {/* TODO: Add ability to choose context size here */}
                </Dialog.Description>

                {/* Active Model Status */}
                <Box mb="4" p="3" style={{ backgroundColor: 'var(--gray-a2)', borderRadius: 'var(--radius-3)' }}>
                    <Text as="div" size="1" weight="medium" color="gray" mb="2">Active Model Status</Text>
                    <Flex align="center" justify="between">
                        <Flex align="center" gap="2">
                            {/* Show spinner if initial status is loading OR if polling unload */}
                            {(isLoadingStatus && !ollamaStatus) || isWaitingForUnload ? <Spinner size="2" /> :
                             isAnyModelLoaded ? <CheckCircledIcon width="18" height="18" className="text-green-600" /> :
                             <SymbolIcon width="18" height="18" className="text-gray-500" />}
                            <Text size="3" weight="bold">{activeModelName}</Text>
                             {/* Tooltip showing exact loaded model if different from active */}
                             {isAnyModelLoaded && loadedModelFullName && loadedModelFullName !== activeModelName && (
                                 <Tooltip content={`Loaded: ${loadedModelFullName}`}>
                                     <InfoCircledIcon className='text-blue-500'/>
                                 </Tooltip>
                            )}
                        </Flex>
                        <Button
                            color="orange"
                            variant="soft"
                            size="1"
                            onClick={handleUnloadClick}
                            disabled={!isAnyModelLoaded || isAnyLoadingProcessActive}
                            title={!isAnyModelLoaded ? "No model loaded" : "Unload active model"}
                        >
                             {isUnloading ? (
                                 <> <Spinner size="1"/> Unloading... </>
                             ) : (
                                 <> <ReloadIcon/> Unload Model </>
                             )}
                        </Button>
                    </Flex>
                     {statusError && !isAnyLoadingProcessActive && (
                         <Callout.Root color="red" size="1" mt="2">
                            <Callout.Icon><ExclamationTriangleIcon/></Callout.Icon>
                            <Callout.Text>Error checking status: {statusError.message}</Callout.Text>
                         </Callout.Root>
                     )}
                </Box>

                {/* Available Models List */}
                <Box mb="4">
                    <Text as="div" size="1" weight="medium" color="gray" mb="2">Available Models in Ollama</Text>
                    <ScrollArea type="auto" scrollbars="vertical" style={{ maxHeight: '200px', border: '1px solid var(--gray-a6)', borderRadius: 'var(--radius-3)' }}>
                        <Box>
                            {isLoadingAvailable && ( <Flex align="center" justify="center" p="4"><Spinner size="2" /> <Text ml="2" color="gray" size="2">Loading available models...</Text></Flex> )}
                            {availableError && ( <Callout.Root color="red" size="1" m="2"><Callout.Icon><ExclamationTriangleIcon/></Callout.Icon><Callout.Text>Error loading available models: {availableError.message}</Callout.Text></Callout.Root> )}
                            {!isLoadingAvailable && !availableError && availableModelsData?.models.length === 0 && ( <Flex align="center" justify="center" p="4"><Text color="gray" size="2">No models found in Ollama.</Text></Flex> )}
                            {!isLoadingAvailable && !availableError && availableModelsData && availableModelsData.models.length > 0 && ( <> {availableModelsData.models.sort((a, b) => a.name.localeCompare(b.name)).map(renderModelListItem)} </> )}
                        </Box>
                    </ScrollArea>
                </Box>

                {/* Display Errors from mutations */}
                {unloadMutation.isError && (
                     <Callout.Root color="red" size="1" mt="2">
                        <Callout.Icon><ExclamationTriangleIcon/></Callout.Icon>
                        <Callout.Text>Error during unload: {unloadMutation.error.message}</Callout.Text>
                     </Callout.Root>
                )}
                 {setModelMutation.isError && ( // Show set model error
                     <Callout.Root color="red" size="1" mt="2">
                        <Callout.Icon><ExclamationTriangleIcon/></Callout.Icon>
                        <Callout.Text>Error setting model: {setModelMutation.error.message}</Callout.Text>
                     </Callout.Root>
                 )}


                <Flex gap="3" mt="4" justify="end">
                    <Button type="button" variant="soft" color="gray" onClick={() => handleManualClose(false)} disabled={isAnyLoadingProcessActive}>
                        <Cross2Icon /> Close
                    </Button>
                </Flex>
            </Dialog.Content>
        </Dialog.Root>
    );
}
