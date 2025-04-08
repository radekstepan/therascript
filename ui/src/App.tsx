import React, { useEffect } from 'react';
import { useAtomValue, useAtom } from 'jotai';
import { Routes, Route, Navigate } from 'react-router-dom';

// Radix UI & Icons
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Toast from '@radix-ui/react-toast'; // Import Toast
import {
    SunIcon, MoonIcon, DesktopIcon, ExitIcon, PersonIcon
} from '@radix-ui/react-icons';

import { Button } from './components/ui/Button';
import { LandingPage } from './components/LandingPage';
import { SessionView } from './components/SessionView';
import { UploadModal } from './components/UploadModal';

import {
    isUploadModalOpenAtom,
    isTranscribingAtom,
    transcriptionErrorAtom,
    themeAtom,
    effectiveThemeAtom,
    Theme
} from './store';
import { cn } from './utils';

function App() {
    const isModalOpen = useAtomValue(isUploadModalOpenAtom);
    const isTranscribing = useAtomValue(isTranscribingAtom);
    const transcriptionError = useAtomValue(transcriptionErrorAtom);
    const effectiveTheme = useAtomValue(effectiveThemeAtom);
    const [theme, setTheme] = useAtom(themeAtom);

    // Apply theme effect
    useEffect(() => {
        const root = window.document.documentElement;
        root.classList.remove('light', 'dark');
        root.classList.add(effectiveTheme);
    }, [effectiveTheme]);

    // Handle Sign Out (placeholder)
    const handleSignOut = () => {
        console.log("Sign Out clicked (Placeholder)");
    };

    return (
        // Wrap the entire app (or relevant part) with Toast.Provider
        <Toast.Provider swipeDirection="right">
            <div className="flex flex-col min-h-screen bg-gray-50 dark:bg-gray-950">
                {/* Header */}
                <header className="p-4 sm:p-6 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 flex-shrink-0 flex items-center justify-between">
                    {/* Logo/Spacer */}
                     <div className="w-24 md:w-32"> </div>
                     <div className="flex-grow"></div>

                     {/* User/Theme Dropdown Menu */}
                     <div className="flex items-center justify-end w-24 md:w-32">
                         <DropdownMenu.Root>
                             <DropdownMenu.Trigger asChild>
                                 <Button variant="ghost" size="iconSm" className="rounded-full text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100" aria-label="User options">
                                     <PersonIcon className="h-5 w-5" />
                                 </Button>
                             </DropdownMenu.Trigger>
                             <DropdownMenu.Portal>
                                 <DropdownMenu.Content
                                     className="z-50 min-w-[10rem] overflow-hidden rounded-md border bg-white p-1 text-gray-900 shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-50"
                                     sideOffset={5} align="end"
                                 >
                                     <DropdownMenu.Label className="px-2 py-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400">Theme</DropdownMenu.Label>
                                     <DropdownMenu.RadioGroup value={theme} onValueChange={(value) => setTheme(value as Theme)}>
                                         {/* Light */}
                                         <DropdownMenu.RadioItem value="light" className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 pl-8 text-sm outline-none transition-colors focus:bg-gray-100 focus:text-gray-900 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 dark:focus:bg-gray-800 dark:focus:text-gray-50 data-[state=checked]:bg-gray-100 dark:data-[state=checked]:bg-gray-800">
                                             <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center"><DropdownMenu.ItemIndicator><SunIcon className="h-4 w-4" /></DropdownMenu.ItemIndicator></span> Light
                                         </DropdownMenu.RadioItem>
                                         {/* Dark */}
                                         <DropdownMenu.RadioItem value="dark" className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 pl-8 text-sm outline-none transition-colors focus:bg-gray-100 focus:text-gray-900 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 dark:focus:bg-gray-800 dark:focus:text-gray-50 data-[state=checked]:bg-gray-100 dark:data-[state=checked]:bg-gray-800">
                                              <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center"><DropdownMenu.ItemIndicator><MoonIcon className="h-4 w-4" /></DropdownMenu.ItemIndicator></span> Dark
                                         </DropdownMenu.RadioItem>
                                         {/* System */}
                                          <DropdownMenu.RadioItem value="system" className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 pl-8 text-sm outline-none transition-colors focus:bg-gray-100 focus:text-gray-900 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 dark:focus:bg-gray-800 dark:focus:text-gray-50 data-[state=checked]:bg-gray-100 dark:data-[state=checked]:bg-gray-800">
                                              <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center"><DropdownMenu.ItemIndicator><DesktopIcon className="h-4 w-4" /></DropdownMenu.ItemIndicator></span> System
                                         </DropdownMenu.RadioItem>
                                     </DropdownMenu.RadioGroup>
                                     <DropdownMenu.Separator className="-mx-1 my-1 h-px bg-gray-100 dark:bg-gray-800" />
                                     {/* Sign Out */}
                                     <DropdownMenu.Item className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm text-red-600 outline-none transition-colors focus:bg-red-50 focus:text-red-700 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 dark:text-red-500 dark:focus:bg-red-900/50 dark:focus:text-red-600" onSelect={handleSignOut}>
                                         <ExitIcon className="mr-2 h-4 w-4" /><span>Sign Out</span>
                                     </DropdownMenu.Item>
                                 </DropdownMenu.Content>
                             </DropdownMenu.Portal>
                         </DropdownMenu.Root>
                     </div>
                </header>

                {/* Main Content Area */}
                <main className="flex-grow flex flex-col overflow-y-auto">
                    <Routes>
                        <Route path="/" element={<LandingPage />} />
                        <Route path="/sessions/:sessionId" element={<SessionView />} />
                        <Route path="/sessions/:sessionId/chats/:chatId" element={<SessionView />} />
                        <Route path="*" element={<Navigate replace to="/" />} />
                    </Routes>
                </main>

                <UploadModal
                    isOpen={isModalOpen}
                    isTranscribing={isTranscribing}
                    transcriptionError={transcriptionError}
                />

                {/* Toast Viewport - Positioned fixed at bottom right */}
                 <Toast.Viewport className="fixed bottom-0 right-0 flex flex-col p-6 gap-3 w-[390px] max-w-[100vw] m-0 list-none z-[2147483647] outline-none" />
            </div>
        </Toast.Provider>
    );
}

export default App;
