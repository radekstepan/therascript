// packages/ui/src/components/User/UserThemeDropdown.tsx
import React, { useState } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import { useMutation } from '@tanstack/react-query';
import {
  Button as RadixButton, // Alias Radix Button to avoid conflicts
  DropdownMenu,
  Text,
  Flex,
  Switch,
  AlertDialog,
  Spinner,
} from '@radix-ui/themes';
import {
  SunIcon,
  MoonIcon,
  DesktopIcon,
  ExitIcon,
  PersonIcon,
  ChatBubbleIcon,
  CubeIcon,
} from '@radix-ui/react-icons';
import {
  themeAtom,
  renderMarkdownAtom,
  Theme as ThemeType,
  toastMessageAtom,
} from '../../store';
import { DockerStatusModal } from './DockerStatusModal';
import { requestAppShutdown } from '../../api/api'; // Import the new shutdown API call

export function UserThemeDropdown() {
  const [theme, setTheme] = useAtom(themeAtom);
  const [renderMarkdown, setRenderMarkdown] = useAtom(renderMarkdownAtom);
  const [isDockerModalOpen, setIsDockerModalOpen] = useState(false);
  const setToast = useSetAtom(toastMessageAtom);

  // State for shutdown confirmation dialog
  const [isShutdownConfirmOpen, setIsShutdownConfirmOpen] = useState(false);

  // Mutation for app shutdown
  const shutdownMutation = useMutation({
    mutationFn: requestAppShutdown,
    onSuccess: (data) => {
      // This means the request to port 9999 was successful and it responded.
      console.log(
        '[UserThemeDropdown] Shutdown mutation succeeded via API call:',
        data
      );
      setToast(
        `✅ Shutdown initiated: ${data.message}. The application will now close.`
      );
      // The app itself will shut down; the UI will become unresponsive or error out.
      // No need to close the dialog, as the page will cease functioning.
      // Visually disable the button immediately after successful initiation
      // This is more of a UX hint as the app will vanish.
      // We can't truly disable it if the component unmounts.
    },
    onError: (error: Error) => {
      // This path means the request to port 9999 itself failed.
      console.error('[UserThemeDropdown] Shutdown mutation errored:', error);
      if (
        error.message.toLowerCase().includes('not reachable') ||
        error.message.toLowerCase().includes('network error')
      ) {
        setToast(
          `❌ Shutdown Error: Could not reach the shutdown service. Is the main script (run-dev/run-prod) running?`
        );
      } else {
        setToast(
          `❌ Shutdown Error: ${error.message}. Please check the console for details.`
        );
      }
      setIsShutdownConfirmOpen(false); // Allow retry if it was a genuine failure to contact port 9999
    },
  });

  const handleShutdownClick = () => {
    setIsShutdownConfirmOpen(true);
  };

  const handleConfirmShutdown = () => {
    // `isPending` will be true once mutate() is called.
    // The button in the dialog is already disabled by `shutdownMutation.isPending`
    shutdownMutation.mutate();
  };

  const handleMarkdownSwitchClick = (e: React.MouseEvent) => {
    e.preventDefault();
    setRenderMarkdown(!renderMarkdown);
  };

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          <RadixButton // Use aliased RadixButton
            variant="soft"
            size="2"
            highContrast
            aria-label="User options"
          >
            <PersonIcon />
          </RadixButton>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end">
          {/* Theme Options */}
          <DropdownMenu.Label>
            <Text size="1">Theme</Text>
          </DropdownMenu.Label>
          <DropdownMenu.RadioGroup
            value={theme}
            onValueChange={(value) => setTheme(value as ThemeType)}
          >
            <DropdownMenu.RadioItem value="light">
              <SunIcon
                width="16"
                height="16"
                style={{ marginRight: 'var(--space-2)' }}
              />{' '}
              Light
            </DropdownMenu.RadioItem>
            <DropdownMenu.RadioItem value="dark">
              <MoonIcon
                width="16"
                height="16"
                style={{ marginRight: 'var(--space-2)' }}
              />{' '}
              Dark
            </DropdownMenu.RadioItem>
            <DropdownMenu.RadioItem value="system">
              <DesktopIcon
                width="16"
                height="16"
                style={{ marginRight: 'var(--space-2)' }}
              />{' '}
              System
            </DropdownMenu.RadioItem>
          </DropdownMenu.RadioGroup>
          <DropdownMenu.Separator />

          {/* Render Markdown Toggle */}
          <DropdownMenu.Item
            onSelect={(e) => e.preventDefault()}
            className="cursor-default"
          >
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
            <CubeIcon
              width="16"
              height="16"
              style={{ marginRight: 'var(--space-2)' }}
            />{' '}
            Docker Status
          </DropdownMenu.Item>

          <DropdownMenu.Separator />

          {/* Shutdown Application Item */}
          <DropdownMenu.Item
            color="red"
            onSelect={(event) => {
              event.preventDefault(); // Prevent menu closing immediately
              handleShutdownClick();
            }}
            disabled={shutdownMutation.isPending}
          >
            <ExitIcon
              width="16"
              height="16"
              style={{ marginRight: 'var(--space-2)' }}
            />{' '}
            Shutdown
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>

      <DockerStatusModal
        isOpen={isDockerModalOpen}
        onOpenChange={setIsDockerModalOpen}
      />

      {/* Shutdown Confirmation Dialog */}
      <AlertDialog.Root
        open={isShutdownConfirmOpen}
        onOpenChange={setIsShutdownConfirmOpen}
      >
        <AlertDialog.Content style={{ maxWidth: 450 }}>
          <AlertDialog.Title>Confirm Shutdown</AlertDialog.Title>
          <AlertDialog.Description size="2">
            Are you sure you want to shut down all application services? This
            will close the backend and associated Docker containers.
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <RadixButton // Use aliased RadixButton
                variant="soft"
                color="gray"
                onClick={() => setIsShutdownConfirmOpen(false)} // Ensure dialog closes on cancel
                disabled={shutdownMutation.isPending}
              >
                Cancel
              </RadixButton>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <RadixButton // Use aliased RadixButton
                color="red"
                onClick={handleConfirmShutdown}
                disabled={shutdownMutation.isPending}
              >
                {shutdownMutation.isPending && <Spinner size="1" />}
                {shutdownMutation.isPending ? 'Shutting Down...' : 'Shutdown'}
              </RadixButton>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </>
  );
}
