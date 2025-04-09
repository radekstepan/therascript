import React, { useEffect } from 'react';
import { useAtomValue, useAtom } from 'jotai';
import { Routes, Route, Navigate } from 'react-router-dom';

// Radix Themes & Icons
import { Theme, Button, DropdownMenu, Flex, Text, Box, Container } from '@radix-ui/themes'; // Import Themes components
import * as Toast from '@radix-ui/react-toast'; // Keep Radix Toast primitives
import {
    SunIcon, MoonIcon, DesktopIcon, ExitIcon, PersonIcon
} from '@radix-ui/react-icons';

// App Components
import { LandingPage } from './components/LandingPage';
import { SessionView } from './components/SessionView';
import { UploadModal } from './components/UploadModal';

// Store & Utils
import {
    isUploadModalOpenAtom,
    isTranscribingAtom,
    transcriptionErrorAtom,
    themeAtom,
    effectiveThemeAtom,
    Theme as ThemeType // Renamed Theme type from store to avoid conflict
} from './store';
import { cn } from './utils';

function App() {
    const isModalOpen = useAtomValue(isUploadModalOpenAtom);
    const isTranscribing = useAtomValue(isTranscribingAtom);
    const transcriptionError = useAtomValue(transcriptionErrorAtom);
    const effectiveTheme = useAtomValue(effectiveThemeAtom);
    const [theme, setTheme] = useAtom(themeAtom);

    // Effect for theme is no longer needed here, Theme component handles it

    // Handle Sign Out (placeholder)
    const handleSignOut = () => {
        console.log("Sign Out clicked (Placeholder)");
        // Add actual sign-out logic here
    };

    return (
        // Wrap the entire app (or relevant part) with Toast.Provider
        <Toast.Provider swipeDirection="right">
             {/* Add Radix Themes Provider */}
            <Theme appearance={effectiveTheme} accentColor="teal" panelBackground="solid" radius="small" scaling="90%">
                <div className="flex flex-col min-h-screen"> {/* Use Tailwind for base layout */}
                    {/* Header */}
                     {/* Use Flex from Themes for layout inside header */}
                     {/* Use `className="border-b"` for border with Tailwind, or Themes Box with border */}
                    <Box className="border-b" style={{ backgroundColor: 'var(--color-panel-solid)'}}>
                        <Container size="4"> {/* Optional: Use Container for max-width */}
                            <Flex align="center" justify="between" py={{ initial: '3', sm: '4' }} px={{ initial: '3', sm: '0' }}>
                                {/* Logo/Spacer (Can use Themes Box or keep div) */}
                                 <Box className="w-24 md:w-32 flex-shrink-0"> {/* Keep spacer */} </Box>

                                {/* User/Theme Dropdown Menu */}
                                <Box className="w-24 md:w-32 flex-shrink-0" > {/* Keep outer div for width constraint */}
                                    <Flex justify="end">
                                        <DropdownMenu.Root>
                                            <DropdownMenu.Trigger>
                                                <Button variant="soft" size="2" highContrast aria-label="User options"> {/* Use Themes Button */}
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
                                    </Flex>
                                </Box>
                            </Flex>
                        </Container>
                    </Box>

                    {/* Main Content Area */}
                    {/* Use Tailwind for flex-grow and overflow */}
                    <main className="flex-grow flex flex-col overflow-y-auto">
                        {/* Use Container to constrain width */}
                         <Container size="4" className="flex-grow flex flex-col">
                            <Routes>
                                <Route path="/" element={<LandingPage />} />
                                <Route path="/sessions/:sessionId" element={<SessionView />} />
                                <Route path="/sessions/:sessionId/chats/:chatId" element={<SessionView />} />
                                <Route path="*" element={<Navigate replace to="/" />} />
                            </Routes>
                        </Container>
                    </main>

                    <UploadModal
                        isOpen={isModalOpen}
                        isTranscribing={isTranscribing}
                        transcriptionError={transcriptionError}
                    />

                    {/* Toast Viewport - Positioned fixed at bottom right (Keep using Radix Toast) */}
                     <Toast.Viewport className="fixed bottom-0 right-0 flex flex-col p-6 gap-3 w-[390px] max-w-[100vw] m-0 list-none z-[2147483647] outline-none" />
                </div>
             </Theme>
        </Toast.Provider>
    );
}

export default App;
