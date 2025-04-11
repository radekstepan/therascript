// src/components/UserThemeDropdown.tsx
import React from 'react';
import { useAtom } from 'jotai';
import { Button, DropdownMenu, Text } from '@radix-ui/themes';
import {
    SunIcon, MoonIcon, DesktopIcon, ExitIcon, PersonIcon
} from '@radix-ui/react-icons';
import { themeAtom, Theme as ThemeType } from '../../store'; // Import from store

export function UserThemeDropdown() {
    const [theme, setTheme] = useAtom(themeAtom);

    // Handle Sign Out (placeholder)
    const handleSignOut = () => {
        console.log("Sign Out clicked (Placeholder)");
        // Add actual sign-out logic here
    };

    return (
        <DropdownMenu.Root>
            <DropdownMenu.Trigger>
                {/* Added highContrast for better visibility on some backgrounds */}
                <Button variant="soft" size="2" highContrast aria-label="User options">
                    <PersonIcon />
                </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end">
                <DropdownMenu.Label>
                    <Text size="1">Theme</Text>
                </DropdownMenu.Label>
                <DropdownMenu.RadioGroup value={theme} onValueChange={(value) => setTheme(value as ThemeType)}>
                    {/* Light */}
                    <DropdownMenu.RadioItem value="light">
                        <SunIcon width="16" height="16" style={{ marginRight: 'var(--space-2)' }}/> Light
                    </DropdownMenu.RadioItem>
                    {/* Dark */}
                    <DropdownMenu.RadioItem value="dark">
                        <MoonIcon width="16" height="16" style={{ marginRight: 'var(--space-2)' }}/> Dark
                    </DropdownMenu.RadioItem>
                    {/* System */}
                    <DropdownMenu.RadioItem value="system">
                        <DesktopIcon width="16" height="16" style={{ marginRight: 'var(--space-2)' }}/> System
                    </DropdownMenu.RadioItem>
                </DropdownMenu.RadioGroup>
                <DropdownMenu.Separator />
                {/* Sign Out */}
                <DropdownMenu.Item color="red" onSelect={handleSignOut}>
                    <ExitIcon width="16" height="16" style={{ marginRight: 'var(--space-2)' }}/> Sign Out
                </DropdownMenu.Item>
            </DropdownMenu.Content>
        </DropdownMenu.Root>
    );
}
