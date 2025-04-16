// packages/ui/src/components/User/UserThemeDropdown.tsx
import React, { useState } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button, DropdownMenu, Text, Spinner } from '@radix-ui/themes';
import {
    SunIcon, MoonIcon, DesktopIcon, ExitIcon, PersonIcon,
    ReloadIcon // Example icon for unload/reload
} from '@radix-ui/react-icons';
import { themeAtom, Theme as ThemeType, toastMessageAtom } from '../../store';
import { unloadOllamaModel, fetchOllamaStatus } from '../../api/api';

export function UserThemeDropdown() {
    const [theme, setTheme] = useAtom(themeAtom);
    const setToast = useSetAtom(toastMessageAtom);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);

    // Fetch Ollama status only when dropdown is open
    const { data: ollamaStatus, isLoading: isStatusLoading } = useQuery({
        queryKey: ['ollamaStatus'],
        queryFn: fetchOllamaStatus,
        enabled: isDropdownOpen, // Only fetch when dropdown is open
        staleTime: 30 * 1000, // Cache for 30 seconds
        retry: false,
    });

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
        },
        onError: (error: Error) => {
            console.error("Unload request failed:", error);
            setToast(`❌ Error: ${error.message || 'Failed to send unload request.'}`);
        }
    });

    const handleUnloadClick = (event: Event) => {
        event.preventDefault();
        if (unloadMutation.isPending) return;
        unloadMutation.mutate();
    };

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
                {isStatusLoading ? (
                    <DropdownMenu.Item disabled>
                        <Spinner size="1" style={{ marginRight: 'var(--space-2)' }}/>
                        Checking model status...
                    </DropdownMenu.Item>
                ) : ollamaStatus?.loaded ? (
                    <DropdownMenu.Item
                        onSelect={handleUnloadClick}
                        disabled={unloadMutation.isPending}
                        color="orange"
                        style={{ cursor: unloadMutation.isPending ? 'not-allowed' : 'pointer' }}
                    >
                        {unloadMutation.isPending ? (
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
