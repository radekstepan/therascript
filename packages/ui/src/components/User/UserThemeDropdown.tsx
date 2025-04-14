import React from 'react';
import { useAtom } from 'jotai';
import { Button, DropdownMenu, Text } from '@radix-ui/themes';
import {
    SunIcon, MoonIcon, DesktopIcon, ExitIcon, PersonIcon
} from '@radix-ui/react-icons';
import { themeAtom, Theme as ThemeType } from '../../store';

export function UserThemeDropdown() {
    const [theme, setTheme] = useAtom(themeAtom);

    const handleSignOut = () => {
        console.log("Sign Out clicked (Placeholder)");
        // TODO Add actual sign-out logic here
    };

    return (
        <DropdownMenu.Root>
            <DropdownMenu.Trigger>
                <Button variant="soft" size="2" highContrast aria-label="User options">
                    <PersonIcon />
                </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end">
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
                <DropdownMenu.Item color="red" onSelect={handleSignOut}>
                    <ExitIcon width="16" height="16" style={{ marginRight: 'var(--space-2)' }}/> Sign Out
                </DropdownMenu.Item>
            </DropdownMenu.Content>
        </DropdownMenu.Root>
    );
}
