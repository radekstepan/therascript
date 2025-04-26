// packages/ui/src/components/User/UserThemeDropdown.tsx
import React, { useState } from 'react';
import { useAtom } from 'jotai';
import { Button, DropdownMenu, Text, Flex, Switch, AlertDialog, Spinner } from '@radix-ui/themes'; // Import AlertDialog, Spinner
import {
    SunIcon, MoonIcon, DesktopIcon, ExitIcon, PersonIcon,
    ChatBubbleIcon, // Optional: Use a different icon for markdown setting
    CubeIcon, // <-- Added icon for Docker status
    ExclamationTriangleIcon, // For delete warning
} from '@radix-ui/react-icons';
import { themeAtom, renderMarkdownAtom, Theme as ThemeType, toastMessageAtom } from '../../store'; // Import renderMarkdownAtom, toastMessageAtom
import { DockerStatusModal } from './DockerStatusModal';
import { triggerShutdown } from '../../api/api'; // Import the new API call
import { useSetAtom } from 'jotai'; // Import useSetAtom for toast

export function UserThemeDropdown() {
    const [theme, setTheme] = useAtom(themeAtom);
    const [renderMarkdown, setRenderMarkdown] = useAtom(renderMarkdownAtom);
    const [isDockerModalOpen, setIsDockerModalOpen] = useState(false);
    const [isShutdownConfirmOpen, setIsShutdownConfirmOpen] = useState(false); // State for shutdown confirm
    const [isShuttingDown, setIsShuttingDown] = useState(false); // Loading state for shutdown
    const setToast = useSetAtom(toastMessageAtom);

    const handleShutdownRequest = () => {
        setIsShutdownConfirmOpen(true); // Open confirmation dialog
    };

    const handleConfirmShutdown = async () => {
        setIsShuttingDown(true);
        try {
            const result = await triggerShutdown();
            setToast(result.message || "Shutdown initiated.");
            // Optionally disable UI further or show a persistent "Shutting down..." message
            // The system should shut down shortly after this.
            setIsShutdownConfirmOpen(false); // Close confirm dialog
            // No need to setIsShuttingDown(false) as the app/system will likely terminate
        } catch (error: any) {
            setToast(`Error: ${error.message || 'Failed to initiate shutdown.'}`);
            setIsShuttingDown(false); // Allow retry if it failed
            setIsShutdownConfirmOpen(false);
        }
    };

    // Prevent dropdown from closing when clicking the switch
    const handleMarkdownSwitchClick = (e: React.MouseEvent) => {
        e.preventDefault();
        setRenderMarkdown(!renderMarkdown);
    };

    return (
        <> {/* Fragment to hold dropdown and modals */}
            <DropdownMenu.Root>
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

                    {/* Render Markdown Toggle */}
                    <DropdownMenu.Item onSelect={(e) => e.preventDefault()} className="cursor-default">
                        <Flex justify="between" width="100%" gap="2">
                            <ChatBubbleIcon width="16" height="16" />
                            <Text size="2" style={{ flexGrow: 1 }}>
                                Render Markdown
                            </Text>
                            <Switch
                                size="1"
                                checked={renderMarkdown}
                                onClick={handleMarkdownSwitchClick}
                                aria-label="Toggle Markdown rendering for AI responses"
                             />
                        </Flex>
                    </DropdownMenu.Item>

                    {/* Docker Status Item */}
                    <DropdownMenu.Separator />
                    <DropdownMenu.Item onSelect={() => setIsDockerModalOpen(true)}>
                        <CubeIcon width="16" height="16" style={{ marginRight: 'var(--space-2)' }} /> Docker Status
                    </DropdownMenu.Item>

                    <DropdownMenu.Separator />

                    {/* Shutdown PC */}
                    <DropdownMenu.Item color="red" onSelect={handleShutdownRequest}>
                        <ExitIcon width="16" height="16" style={{ marginRight: 'var(--space-2)' }}/> Shutdown PC...
                    </DropdownMenu.Item>
                </DropdownMenu.Content>
            </DropdownMenu.Root>

            {/* Docker Status Modal */}
            <DockerStatusModal
                isOpen={isDockerModalOpen}
                onOpenChange={setIsDockerModalOpen}
            />

            {/* Shutdown Confirmation Modal */}
            <AlertDialog.Root open={isShutdownConfirmOpen} onOpenChange={setIsShutdownConfirmOpen}>
                <AlertDialog.Content style={{ maxWidth: 450 }}>
                    <AlertDialog.Title>Confirm Shutdown</AlertDialog.Title>
                    <AlertDialog.Description size="2">
                        Are you sure you want to shut down the entire computer?
                        <br/><br/>
                        <Text weight="bold" color="red">
                           <ExclamationTriangleIcon style={{ verticalAlign: 'middle', marginRight: '4px' }}/> Unsaved work in other applications will be lost.
                        </Text>
                    </AlertDialog.Description>
                    <Flex gap="3" mt="4" justify="end">
                        <Button variant="soft" color="gray" onClick={() => setIsShutdownConfirmOpen(false)} disabled={isShuttingDown}>
                            Cancel
                        </Button>
                        <Button color="red" onClick={handleConfirmShutdown} disabled={isShuttingDown}>
                            {isShuttingDown ? <Spinner size="1"/> : <ExitIcon />}
                            <Text ml="1">{isShuttingDown ? 'Shutting Down...' : 'Shutdown Now'}</Text>
                        </Button>
                    </Flex>
                </AlertDialog.Content>
            </AlertDialog.Root>
        </>
    );
}
