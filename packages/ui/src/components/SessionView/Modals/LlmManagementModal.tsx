/* packages/ui/src/components/SessionView/Modals/LlmManagementModal.tsx */
import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, Button, Flex, Text, Box, Spinner, Callout, ScrollArea, Badge, Tooltip, TextField, Separator } from '@radix-ui/themes';
import {
    InfoCircledIcon, Cross2Icon, CheckCircledIcon, SymbolIcon,
    ReloadIcon, ExclamationTriangleIcon, DownloadIcon,
    MagnifyingGlassIcon, LightningBoltIcon, // Added icon for context size
} from '@radix-ui/react-icons';
import {
    fetchOllamaStatus, fetchAvailableModels, unloadOllamaModel,
    setOllamaModel,
    pullOllamaModel
} from '../../../api/api';
import { toastMessageAtom } from '../../../store';
import { useSetAtom } from 'jotai';
import type { OllamaModelInfo, OllamaStatus } from '../../../types';
import { cn } from '../../../utils'; // Import cn

interface LlmManagementModalProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
}

// Helper to format model size (no change)
const formatBytes = (bytes: number, decimals = 2): string => { /* ... */
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


    // Queries and Mutations (no changes needed here)
    const { data: ollamaStatus, isLoading: isLoadingStatus, error: statusError } = useQuery({ /* ... */
        queryKey: ['ollamaStatus'],
        queryFn: () => fetchOllamaStatus(),
        enabled: isOpen, staleTime: 0, gcTime: 1000,
        refetchInterval: isOpen || isWaitingForUnload ? 2000 : false,
        refetchOnWindowFocus: false,
    });
    const { data: availableModelsData, isLoading: isLoadingAvailable, error: availableError, refetch: refetchAvailableModels } = useQuery({ /* ... */
        queryKey: ['availableOllamaModels'],
        queryFn: fetchAvailableModels,
        enabled: isOpen, staleTime: 10 * 1000, gcTime: 1 * 60 * 1000,
     });
    const unloadMutation = useMutation({ /* ... */
        mutationFn: unloadOllamaModel,
        onMutate: () => { setLoadingModelName(null); setIsWaitingForUnload(true); },
        onSuccess: (data) => { setToast(`✅ ${data.message}`); console.log("[LlmModal] Unload request accepted..."); queryClient.invalidateQueries({ queryKey: ['ollamaStatus'] }); },
        onError: (error: Error) => { console.error("Unload request failed:", error); setToast(`❌ Error: ${error.message || 'Failed to send unload request.'}`); setIsWaitingForUnload(false); },
    });
    const setModelMutation = useMutation({ /* ... */
        mutationFn: (variables: { modelName: string; contextSize?: number | null }) => { const { modelName, contextSize } = variables; setLoadingModelName(modelName); setIsWaitingForUnload(false); return setOllamaModel(modelName, contextSize); },
        onSuccess: (data, variables) => { setToast(`✅ ${data.message}`); console.log(`[LlmModal] Set model request successful for ${variables.modelName}. Waiting for status update...`); queryClient.invalidateQueries({ queryKey: ['ollamaStatus'] }); setContextSizes(prev => ({ ...prev, [variables.modelName]: '' })); },
        onError: (error: Error, variables) => { console.error(`Set model request failed for ${variables.modelName}:`, error); setToast(`❌ Error setting model ${variables.modelName}: ${error.message || 'Request failed.'}`); setLoadingModelName(null); },
    });
    const pullModelMutation = useMutation({ /* ... */
        mutationFn: (modelNameToPull: string) => { return pullOllamaModel(modelNameToPull); },
        onSuccess: (data, modelName) => { setToast(`✅ ${data.message}`); console.log(`[LlmModal] Pull initiated for ${modelName}.`); setModelToPull(''); setTimeout(() => { console.log("[LlmModal] Invalidating available models list after pull request..."); queryClient.invalidateQueries({ queryKey: ['availableOllamaModels'] }); refetchAvailableModels(); }, 3000); },
        onError: (error: Error, modelName) => { console.error(`Pull model request failed for ${modelName}:`, error); setToast(`❌ Error pulling model ${modelName}: ${error.message || 'Request failed.'}`); }
    });

    // Effects for unload/load confirmation (no change)
    useEffect(() => { /* ... unload confirmation ... */
        if (isWaitingForUnload && ollamaStatus) {
             if (ollamaStatus.modelChecked === ollamaStatus.activeModel && !ollamaStatus.loaded) {
                 console.log("[LlmModal] Unload confirmed by status query.");
                 setIsWaitingForUnload(false);
             }
        }
    }, [isWaitingForUnload, ollamaStatus]);
     useEffect(() => { /* ... load confirmation ... */
        if (loadingModelName && ollamaStatus) {
             if (ollamaStatus.activeModel === loadingModelName && ollamaStatus.loaded) {
                 console.log(`[LlmModal] Load for ${loadingModelName} confirmed via status query. Clearing spinner.`);
                 setLoadingModelName(null);
             }
         }
     }, [loadingModelName, ollamaStatus]);

    // Event Handlers (no changes needed here)
    const handleUnloadClick = () => { if (unloadMutation.isPending || isWaitingForUnload || setModelMutation.isPending || loadingModelName) return; unloadMutation.mutate(); };
    const handleLoadClick = (modelName: string) => { if (setModelMutation.isPending || isWaitingForUnload || loadingModelName) return; const contextSizeStr = contextSizes[modelName] || ''; const contextSizeNum = contextSizeStr ? parseInt(contextSizeStr, 10) : null; const contextSizeToSend = (contextSizeNum !== null && !isNaN(contextSizeNum) && contextSizeNum > 0) ? contextSizeNum : null; if (contextSizeStr && contextSizeToSend === null) { setToast('⚠️ Invalid context size. Must be a positive number. Using default.'); } setModelMutation.mutate({ modelName, contextSize: contextSizeToSend }); };
    const handlePullClick = () => { const modelName = modelToPull.trim(); if (!modelName || pullModelMutation.isPending || isAnyLoadingProcessActive) return; pullModelMutation.mutate(modelName); };
    const handleContextSizeChange = (modelName: string, value: string) => { const sanitizedValue = value.replace(/[^0-9]/g, ''); setContextSizes(prev => ({ ...prev, [modelName]: sanitizedValue })); };
    const handleManualClose = (open: boolean) => { /* ... */ if (!open && isAnyLoadingProcessActive) return; onOpenChange(open); if (!open) { setIsWaitingForUnload(false); setLoadingModelName(null); setModelToPull(''); setContextSizes({}); unloadMutation.reset(); setModelMutation.reset(); pullModelMutation.reset(); } };

    // Loading states (no change)
    const isUnloading = unloadMutation.isPending || isWaitingForUnload;
    const isLoadingSelectedModel = setModelMutation.isPending || loadingModelName !== null;
    const isPullingModel = pullModelMutation.isPending;
    const isAnyLoadingProcessActive = isUnloading || isLoadingSelectedModel || isPullingModel;

    const activeModelName = ollamaStatus?.activeModel ?? 'N/A';
    const isAnyModelLoaded = ollamaStatus?.loaded ?? false;
    const loadedModelFullName = ollamaStatus?.details?.name;
    const activeConfiguredContextSize = ollamaStatus?.configuredContextSize;
    const overallError = statusError || availableError || unloadMutation.error || setModelMutation.error || pullModelMutation.error;


    // Render list item function (no change)
    const renderModelListItem = (model: OllamaModelInfo) => {
        const isCurrentlyLoadingThis = isLoadingSelectedModel && loadingModelName === model.name;
        const isCurrentlyActiveAndLoaded = isAnyModelLoaded && activeModelName === model.name;
        const canLoad = !isCurrentlyActiveAndLoaded && !isAnyLoadingProcessActive;
        const currentContextInput = contextSizes[model.name] || '';

        return (
            <Box key={model.digest} p="2" style={{ borderBottom: '1px solid var(--gray-a3)' }}>
                {/* Row 1: Name and Size */}
                <Flex justify="between" align="center" gap="2" mb="2">
                    <Text size="2" weight="medium" truncate title={model.name}>{model.name}</Text>
                    <Badge variant="soft" color="gray">{formatBytes(model.size)}</Badge>
                </Flex>

                {/* Row 2: Tags, Context Input (optional), Action Button */}
                <Flex justify="between" align="center" gap="2" mt="1" wrap="wrap"> {/* Allow wrapping */}
                    {/* Left side: Tags */}
                    <Flex gap="2" wrap="wrap" align="center" style={{ flexGrow: 1, minWidth: '150px' }}> {/* Allow tags to take space */}
                        {model.details?.family && <Badge variant="outline" color="gray" radius="full">{model.details.family}</Badge>}
                        {model.details?.parameter_size && <Badge variant="outline" color="gray" radius="full">{model.details.parameter_size}</Badge>}
                        {model.details?.quantization_level && <Badge variant="outline" color="gray" radius="full">{model.details.quantization_level}</Badge>}
                    </Flex>

                    {/* Right side: Context Input and Action Button */}
                    <Flex align="center" gap="2" flexShrink="0" style={{ marginLeft: 'auto' }}> {/* Push to the right */}
                        {/* Context Size Input (only shown if not active/loaded) */}
                        {!isCurrentlyActiveAndLoaded && (
                            <TextField.Root
                                size="1" placeholder="Ctx (def)"
                                value={currentContextInput}
                                onChange={(e) => handleContextSizeChange(model.name, e.target.value)}
                                disabled={!canLoad}
                                style={{ width: '80px' }} // Fixed width for context input
                                title="Optional: Override context window size (num_ctx)."
                                type="number" min="1" step="1"
                            >
                                <TextField.Slot>
                                    <LightningBoltIcon height="14" width="14" />
                                </TextField.Slot>
                            </TextField.Root>
                        )}
                        {/* Load/Loading/Loaded Button */}
                        {isCurrentlyLoadingThis ? (
                            <Button size="1" variant="ghost" disabled style={{ minWidth: '95px', justifyContent: 'center' }}> <Spinner size="1"/> Loading... </Button>
                        ) : isCurrentlyActiveAndLoaded ? (
                            <Badge color="green" variant='soft' size="1" style={{ minWidth: '95px', justifyContent: 'center', display: 'inline-flex' }}><CheckCircledIcon/> Active</Badge>
                        ) : (
                            <Button
                                size="1" variant="outline"
                                onClick={() => handleLoadClick(model.name)}
                                disabled={!canLoad}
                                title={canLoad ? `Set ${model.name} as Active` : (isAnyLoadingProcessActive ? 'Operation in progress...' : 'Model already active')}
                                style={{ minWidth: '95px' }} // Ensure button has minimum width
                            > <DownloadIcon/> Set Active </Button>
                        )}
                    </Flex>
                </Flex>
            </Box>
        );
    };


    return (
        <Dialog.Root open={isOpen} onOpenChange={handleManualClose}>
            <Dialog.Content style={{ maxWidth: 600 }}>
                <Dialog.Title>Manage Language Model</Dialog.Title>
                <Dialog.Description size="2" mb="4" color="gray">
                    View models, set the active model and context size, or download new models.
                </Dialog.Description>

                {/* Active Model Status (no change) */}
                <Box mb="4" p="3" style={{ backgroundColor: 'var(--gray-a2)', borderRadius: 'var(--radius-3)' }}>
                    {/* ... active status content ... */}
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
                        <Button color="orange" variant="soft" size="1" onClick={handleUnloadClick} disabled={!isAnyModelLoaded || isAnyLoadingProcessActive} title={!isAnyModelLoaded ? "No model loaded" : "Unload active model"} >
                             {isUnloading ? ( <> <Spinner size="1"/> Unloading... </> ) : ( <> <ReloadIcon/> Unload </> )}
                        </Button>
                    </Flex>
                     {statusError && !isAnyLoadingProcessActive && ( <Callout.Root color="red" size="1" mt="2"><Callout.Icon><ExclamationTriangleIcon/></Callout.Icon><Callout.Text>Error checking status: {statusError.message}</Callout.Text></Callout.Root> )}
                </Box>

                {/* Available Models List */}
                <Box mb="4">
                    <Flex justify="between" align="center" mb="2">
                        <Text as="div" size="1" weight="medium" color="gray">Available Local Models</Text>
                        <Button variant="ghost" size="1" onClick={() => refetchAvailableModels()} disabled={isLoadingAvailable || isAnyLoadingProcessActive} title="Refresh list">
                             <ReloadIcon className={isLoadingAvailable ? 'animate-spin' : ''}/>
                         </Button>
                    </Flex>
                    <ScrollArea type="auto" scrollbars="vertical" style={{ maxHeight: '250px', border: '1px solid var(--gray-a6)', borderRadius: 'var(--radius-3)' }}>
                        {/* --- Add pr="2" (padding-right) to the inner Box --- */}
                        <Box pr="2">
                            {isLoadingAvailable && ( <Flex align="center" justify="center" p="4"><Spinner size="2" /> <Text ml="2" color="gray" size="2">Loading available models...</Text></Flex> )}
                            {availableError && ( <Callout.Root color="red" size="1" m="2"><Callout.Icon><ExclamationTriangleIcon/></Callout.Icon><Callout.Text>Error loading available models: {availableError.message}</Callout.Text></Callout.Root> )}
                            {!isLoadingAvailable && !availableError && availableModelsData?.models.length === 0 && ( <Flex align="center" justify="center" p="4"><Text color="gray" size="2">No models found in Ollama.</Text></Flex> )}
                            {!isLoadingAvailable && !availableError && availableModelsData && availableModelsData.models.length > 0 && ( <> {availableModelsData.models.sort((a, b) => a.name.localeCompare(b.name)).map(renderModelListItem)} </> )}
                        </Box>
                         {/* --- End Add Padding --- */}
                    </ScrollArea>
                </Box>

                {/* Download New Model Section (no change) */}
                <Separator my="3" size="4" />
                <Box mb="4">
                    {/* ... pull model input and button ... */}
                     <Text as="div" size="1" weight="medium" color="gray" mb="2">Download New Model</Text>
                    <Flex gap="2">
                         <TextField.Root style={{ flexGrow: 1 }} size="2" placeholder="Enter model name (e.g., llama3:latest, mistral:7b)" value={modelToPull} onChange={(e) => setModelToPull(e.target.value)} disabled={isPullingModel || isAnyLoadingProcessActive} />
                         <Button onClick={handlePullClick} disabled={!modelToPull.trim() || isPullingModel || isAnyLoadingProcessActive} title={!modelToPull.trim() ? "Enter a model name" : "Download model"} >
                             {isPullingModel ? ( <> <Spinner size="2"/> Downloading... </> ) : ( <> <MagnifyingGlassIcon/> Download </> )}
                         </Button>
                    </Flex>
                    {pullModelMutation.isError && ( /* ... pull error callout ... */
                         <Callout.Root color="red" size="1" mt="2"><Callout.Icon><ExclamationTriangleIcon/></Callout.Icon><Callout.Text>Error pulling model: {pullModelMutation.error.message}</Callout.Text></Callout.Root>
                    )}
                </Box>

                {/* Display Mutation Errors (no change) */}
                {unloadMutation.isError && ( /* ... unload error ... */
                     <Callout.Root color="red" size="1" mt="2"><Callout.Icon><ExclamationTriangleIcon/></Callout.Icon><Callout.Text>Error during unload: {unloadMutation.error.message}</Callout.Text></Callout.Root>
                )}
                 {setModelMutation.isError && ( /* ... set model error ... */
                     <Callout.Root color="red" size="1" mt="2"><Callout.Icon><ExclamationTriangleIcon/></Callout.Icon><Callout.Text>Error setting model: {setModelMutation.error.message}</Callout.Text></Callout.Root>
                 )}

                {/* Footer Buttons (no change) */}
                <Flex gap="3" mt="4" justify="end">
                    <Button type="button" variant="soft" color="gray" onClick={() => handleManualClose(false)} disabled={isAnyLoadingProcessActive}> <Cross2Icon /> Close </Button>
                </Flex>
            </Dialog.Content>
        </Dialog.Root>
    );
}
