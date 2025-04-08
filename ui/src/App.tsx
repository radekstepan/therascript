import React, { useEffect } from 'react'; // Import useEffect
import { useAtomValue, useAtom } from 'jotai'; // Import useAtom
import { Routes, Route, Navigate } from 'react-router-dom';

// Radix UI & Icons
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
    SunIcon,        // Light theme
    MoonIcon,       // Dark theme
    DesktopIcon,    // System theme
    ExitIcon,       // Sign out
    PersonIcon      // User/Menu Trigger
} from '@radix-ui/react-icons';

import { Button } from './components/ui/Button'; // Keep for other potential buttons
// Import Components
import { LandingPage } from './components/LandingPage';
import { SessionView } from './components/SessionView';
import { UploadModal } from './components/UploadModal';

// Import Atoms
import {
    isUploadModalOpenAtom,
    isTranscribingAtom,
    transcriptionErrorAtom,
    themeAtom, // Import the base theme atom
    effectiveThemeAtom, // Import the derived theme atom
    Theme // Import the Theme type itself if defined in store.ts, otherwise define it here
} from './store';
import { cn } from './utils'; // Import cn

// If Theme type is not exported from store.ts, define it here:
// type Theme = 'light' | 'dark' | 'system';

function App() {
    const isModalOpen = useAtomValue(isUploadModalOpenAtom);
    const isTranscribing = useAtomValue(isTranscribingAtom);
    const transcriptionError = useAtomValue(transcriptionErrorAtom);


    // --- Theme Handling ---
    const effectiveTheme = useAtomValue(effectiveThemeAtom); // Get the calculated theme

    useEffect(() => {
        const root = window.document.documentElement;
        root.classList.remove('light', 'dark'); // Remove previous theme classes
        root.classList.add(effectiveTheme); // Add the current effective theme class ('light' or 'dark')
        console.log("Applied theme:", effectiveTheme); // For debugging
    }, [effectiveTheme]); // Re-run only when the effective theme changes

    // Get setter and current value for the base theme atom
    const [theme, setTheme] = useAtom(themeAtom);

    // No need for toggleTheme function anymore

    // Handle Sign Out action (placeholder)
    const handleSignOut = () => {
        console.log("Sign Out clicked (Placeholder)");
        // Add actual sign-out logic here (e.g., clear tokens, redirect)
    };
    // --- End Theme Handling ---

    return (
        <div className="flex flex-col min-h-screen bg-gray-50 dark:bg-gray-950"> {/* Adjust background */}
            {/* Header */}
            <header className="p-4 sm:p-6 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 flex-shrink-0 flex items-center justify-between">
                {/* Logo/Title Area (Example) */}
                 <div className="w-24 md:w-32">
                     {/* <span className="font-semibold text-lg">Therapy Tool</span> */}
                       {/* Or add your logo/title */}
                 </div>

                 {/* Center Spacer */}
                 <div className="flex-grow"></div>

                 {/* User/Theme Dropdown Menu */}
                 <div className="flex items-center justify-end w-24 md:w-32">
                     <DropdownMenu.Root>
                         <DropdownMenu.Trigger asChild>
                             <Button
                                 variant="ghost"
                                 size="iconSm" // Slightly larger icon button
                                 className="rounded-full text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100"
                                 aria-label="User options"
                             >
                                 <PersonIcon className="h-5 w-5" />
                             </Button>
                         </DropdownMenu.Trigger>

                         <DropdownMenu.Portal>
                             <DropdownMenu.Content
                                 className="z-50 min-w-[10rem] overflow-hidden rounded-md border bg-white p-1 text-gray-900 shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-50"
                                 sideOffset={5}
                                 align="end" // Align to the end (right) of the trigger
                             >
                                 <DropdownMenu.Label className="px-2 py-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400">Theme</DropdownMenu.Label>
                                 {/* Theme Selection */}
                                 <DropdownMenu.RadioGroup
                                     value={theme}
                                     onValueChange={(value) => setTheme(value as Theme)} // Assert type here
                                 >
                                     <DropdownMenu.RadioItem
                                         value="light"
                                         className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 pl-8 text-sm outline-none transition-colors focus:bg-gray-100 focus:text-gray-900 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 dark:focus:bg-gray-800 dark:focus:text-gray-50 data-[state=checked]:bg-gray-100 dark:data-[state=checked]:bg-gray-800"
                                     >
                                         <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                                             <DropdownMenu.ItemIndicator>
                                                 <SunIcon className="h-4 w-4" />
                                             </DropdownMenu.ItemIndicator>
                                         </span>
                                         Light
                                     </DropdownMenu.RadioItem>
                                     <DropdownMenu.RadioItem
                                         value="dark"
                                         className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 pl-8 text-sm outline-none transition-colors focus:bg-gray-100 focus:text-gray-900 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 dark:focus:bg-gray-800 dark:focus:text-gray-50 data-[state=checked]:bg-gray-100 dark:data-[state=checked]:bg-gray-800"
                                     >
                                         <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                                             <DropdownMenu.ItemIndicator>
                                                 <MoonIcon className="h-4 w-4" />
                                             </DropdownMenu.ItemIndicator>
                                         </span>
                                         Dark
                                     </DropdownMenu.RadioItem>
                                     <DropdownMenu.RadioItem
                                         value="system"
                                         className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 pl-8 text-sm outline-none transition-colors focus:bg-gray-100 focus:text-gray-900 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 dark:focus:bg-gray-800 dark:focus:text-gray-50 data-[state=checked]:bg-gray-100 dark:data-[state=checked]:bg-gray-800"
                                     >
                                         <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                                             <DropdownMenu.ItemIndicator>
                                                 <DesktopIcon className="h-4 w-4" />
                                             </DropdownMenu.ItemIndicator>
                                         </span>
                                         System
                                     </DropdownMenu.RadioItem>
                                 </DropdownMenu.RadioGroup>

                                 <DropdownMenu.Separator className="-mx-1 my-1 h-px bg-gray-100 dark:bg-gray-800" />

                                 {/* Sign Out */}
                                 <DropdownMenu.Item
                                     className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm text-red-600 outline-none transition-colors focus:bg-red-50 focus:text-red-700 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 dark:text-red-500 dark:focus:bg-red-900/50 dark:focus:text-red-600"
                                     onSelect={handleSignOut} // Call sign out handler
                                 >
                                     <ExitIcon className="mr-2 h-4 w-4" />
                                     <span>Sign Out</span>
                                 </DropdownMenu.Item>
                             </DropdownMenu.Content>
                         </DropdownMenu.Portal>
                     </DropdownMenu.Root>
                 </div>
            </header>

            {/* Main Content Area */}
             {/* Ensure main takes up remaining height */}
            <main className="flex-grow flex flex-col overflow-y-auto"> {/* Keep overflow-y-auto here if App has fixed header */}
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
        </div>
    );
}

export default App;
