import React, { useState, useEffect } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, DropdownMenu, Text, Spinner } from '@radix-ui/themes';
import {
    SunIcon, MoonIcon, DesktopIcon, ExitIcon, PersonIcon,
    ReloadIcon
} from '@radix-ui/react-icons';
import { themeAtom, Theme as ThemeType, toastMessageAtom } from '../../store';
import { unloadOllamaModel, fetchOllamaStatus } from '../../api/api';

export function UserThemeDropdown() {
    const [theme, setTheme] = useAtom(themeAtom);
    const setToast = useSetAtom(toastMessageAtom);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const queryClient = useQueryClient();

    // *** New state: Track if we are waiting for unload confirmation ***
    const [isWaitingForUnload, setIsWaitingForUnload] = useState(false);

    // Fetch Ollama status
    const { data: ollamaStatus, isLoading: isStatusLoading } = useQuery({
        queryKey: ['ollamaStatus'],
        queryFn: fetchOllamaStatus,
        enabled: isDropdownOpen, // Fetch when dropdown opens OR when waiting for unload
        staleTime: 0,
        gcTime: 0,
        // *** Refetch configuration for polling ***
        refetchInterval: isWaitingForUnload ? 1500 : false, // Poll every 1.5s only when waiting
        refetchOnMount: true,
        refetchOnWindowFocus: false,
        retry: false,
    });

    // *** Effect to stop polling when unload is confirmed ***
    useEffect(() => {
        // If we are waiting and the status comes back as NOT loaded, stop waiting/polling.
        if (isWaitingForUnload && ollamaStatus && !ollamaStatus.loaded) {
            console.log("[UserThemeDropdown] Unload confirmed by status query.");
            setIsWaitingForUnload(false);
        }
    }, [isWaitingForUnload, ollamaStatus]);


    const handleSignOut = () => {
        console.log("Sign Out clicked (Placeholder)");
        // TODO Add actual sign-out logic here
    };

    // Mutation hook for the unload action
    const unloadMutation = useMutation({
        mutationFn: unloadOllamaModel,
        onSuccess: (data) => {
            console.log("Unload request successful:", data.message);
            setToast(`✅ ${data.message}`);
            // *** Start waiting/polling ***
            console.log("[UserThemeDropdown] Starting polling for unload confirmation...");
            setIsWaitingForUnload(true);
            // Optionally trigger an immediate refetch after starting to wait
            queryClient.refetchQueries({ queryKey: ['ollamaStatus'] });
            // Invalidation might not be needed now, as polling handles updates
            // queryClient.invalidateQueries({ queryKey: ['ollamaStatus'] });
        },
        onError: (error: Error) => {
            console.error("Unload request failed:", error);
            setToast(`❌ Error: ${error.message || 'Failed to send unload request.'}`);
            setIsWaitingForUnload(false); // Stop waiting on error
        }
    });

    const handleUnloadClick = (event: Event) => {
        event.preventDefault();
        if (unloadMutation.isPending || isWaitingForUnload) return; // Prevent triggering while already unloading/waiting
        unloadMutation.mutate();
    };

    const isUnloadingProcessActive = unloadMutation.isPending || isWaitingForUnload;

    return (
        <DropdownMenu.Root
            open={isDropdownOpen}
            onOpenChange={setIsDropdownOpen}
        >
            <DropdownMenu.Trigger>
                <Button variant="soft" size="2" highContrast aria-label="User options">
                    <PersonIcon />
                </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end">
                {/* Theme Options */}
                <DropdownMenu.Label>
                    <Text size="1">Theme</Text>
                </DropdownMenu.Label>
                <DropdownMenu.RadioGroup value={theme} onValueChange={(value) => setTheme(value as ThemeType)}>
                    <DropdownMenu.RadioItem value="light">
                        <SunIcon width="16" height="16" style={{ marginRight: 'var(--space-2)' }}/> Light
                    </DropdownMenu.RadioItem>
                    <DropdownMenu.RadioItem value="dark">
                        <MoonIcon width="16" height="16" style={{ marginRight: 'var(--space-2)' }}/> Dark
                    </DropdownMenu.RadioItem>
                    <DropdownMenu.RadioItem value="system">
                        <DesktopIcon width="16" height="16" style={{ marginRight: 'var(--space-2)' }}/> System
                    </DropdownMenu.RadioItem>
                </DropdownMenu.RadioGroup>
                <DropdownMenu.Separator />

                {/* Ollama Action */}
                {isStatusLoading && !isWaitingForUnload ? ( // Show initial loading only
                    <DropdownMenu.Item disabled>
                        <Spinner size="1" style={{ marginRight: 'var(--space-2)' }}/>
                        Checking status...
                    </DropdownMenu.Item>
                ) : ollamaStatus?.loaded ? (
                    <DropdownMenu.Item
                        onSelect={handleUnloadClick}
                        disabled={isUnloadingProcessActive} // Disable if mutation pending OR waiting for confirmation
                        color="orange"
                        style={{ cursor: isUnloadingProcessActive ? 'not-allowed' : 'pointer' }}
                    >
                        {isUnloadingProcessActive ? (
                            <>
                                <Spinner size="1" style={{ marginRight: 'var(--space-2)' }}/>
                                Unloading...
                            </>
                        ) : (
                            <>
                                <ReloadIcon width="16" height="16" style={{ marginRight: 'var(--space-2)' }} />
                                Unload AI Model {ollamaStatus.model ? `(${ollamaStatus.model})` : ''}
                            </>
                        )}
                    </DropdownMenu.Item>
                ) : (
                    // If not loading and not loaded
                    <DropdownMenu.Item disabled>
                        <Text size="2" color="gray">No AI model loaded</Text>
                    </DropdownMenu.Item>
                )}

                <DropdownMenu.Separator />

                {/* Sign Out */}
                <DropdownMenu.Item color="red" onSelect={handleSignOut}>
                    <ExitIcon width="16" height="16" style={{ marginRight: 'var(--space-2)' }}/> Sign Out
                </DropdownMenu.Item>
            </DropdownMenu.Content>
        </DropdownMenu.Root>
    );
}
