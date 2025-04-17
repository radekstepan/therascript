/* packages/ui/src/components/User/UserThemeDropdown.tsx */
import React from 'react';
import { useAtom } from 'jotai';
import { Button, DropdownMenu, Text, Flex, Switch } from '@radix-ui/themes'; // Import Flex and Switch
import {
    SunIcon, MoonIcon, DesktopIcon, ExitIcon, PersonIcon,
    ChatBubbleIcon, // Optional: Use a different icon for markdown setting
} from '@radix-ui/react-icons';
import { themeAtom, renderMarkdownAtom, Theme as ThemeType } from '../../store'; // Import renderMarkdownAtom

export function UserThemeDropdown() {
    const [theme, setTheme] = useAtom(themeAtom);
    const [renderMarkdown, setRenderMarkdown] = useAtom(renderMarkdownAtom); // Use the atom

    const handleSignOut = () => {
        console.log("Sign Out clicked (Placeholder)");
        // TODO Add actual sign-out logic here
    };

    // Prevent dropdown from closing when clicking the switch
    const handleMarkdownSwitchClick = (e: React.MouseEvent) => {
        e.preventDefault();
        setRenderMarkdown(!renderMarkdown);
    };

    return (
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
                    {/* --- Remove align="center" from Flex --- */}
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
                     {/* --- End Change --- */}
                </DropdownMenu.Item>

                <DropdownMenu.Separator />

                {/* Sign Out */}
                <DropdownMenu.Item color="red" onSelect={handleSignOut}>
                    <ExitIcon width="16" height="16" style={{ marginRight: 'var(--space-2)' }}/> Sign Out
                </DropdownMenu.Item>
            </DropdownMenu.Content>
        </DropdownMenu.Root>
    );
}
