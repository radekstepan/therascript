// packages/ui/src/components/User/UserThemeDropdown.tsx
import React, { useState } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import { Button, DropdownMenu, Text, Flex, Switch } from '@radix-ui/themes';
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

export function UserThemeDropdown() {
  const [theme, setTheme] = useAtom(themeAtom);
  const [renderMarkdown, setRenderMarkdown] = useAtom(renderMarkdownAtom);
  const [isDockerModalOpen, setIsDockerModalOpen] = useState(false);
  const setToast = useSetAtom(toastMessageAtom);

  const handleNewShutdownLinkClick = () => {
    setToast('Waiting for app ports to all close...');
    // For now, this link does nothing else.
    console.log('[UI] "Shutdown" link clicked. Showing placeholder message.');
  };

  const handleMarkdownSwitchClick = (e: React.MouseEvent) => {
    e.preventDefault();
    setRenderMarkdown(!renderMarkdown);
  };

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          <Button
            variant="soft"
            size="2"
            highContrast
            aria-label="User options"
          >
            <PersonIcon />
          </Button>
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

          {/* New Shutdown Link */}
          <DropdownMenu.Item
            color="orange"
            onSelect={handleNewShutdownLinkClick}
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
    </>
  );
}
