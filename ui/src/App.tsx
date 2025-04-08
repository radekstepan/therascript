import React, { useEffect } from 'react'; // Import useEffect
import { useAtomValue, useAtom } from 'jotai'; // Import useAtom
import { Routes, Route, Navigate } from 'react-router-dom';

import { Button } from './components/ui/Button'; // Import Button
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
effectiveThemeAtom // Import the derived theme atom
} from './store';
import { cn } from './utils'; // Import cn

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

// Get setter for the base theme atom
const [theme, setTheme] = useAtom(themeAtom);

const toggleTheme = () => {
    // Simple toggle: light -> dark -> system -> light
    if (theme === 'light') setTheme('dark');
    else if (theme === 'dark') setTheme('system');
    else setTheme('light');
};
// --- End Theme Handling ---

return (
    <div className="flex flex-col min-h-screen bg-gray-50 dark:bg-gray-950"> {/* Adjust background */}
        {/* Header */}
        <header className="p-4 sm:p-6 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 flex-shrink-0 flex items-center justify-between">
             {/* Left Spacer */}
             {/* Adjust width based on your button/layout needs */}
             <div className="w-24 md:w-32"></div>

             {/* Theme Toggle Button */}
             {/* Adjust width based on your button/layout needs */}
             <div className="w-24 md:w-32 flex justify-end">
                <Button onClick={toggleTheme} variant="ghost" size="sm" className="capitalize text-xs sm:text-sm">
                    {/* Display current preference */}
                    Theme: {theme}
                </Button>
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
