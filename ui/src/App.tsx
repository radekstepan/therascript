import React from 'react';
import { useAtomValue } from 'jotai';
import { Routes, Route, Navigate } from 'react-router-dom';

// Import Components
import { LandingPage } from './components/LandingPage';
import { SessionView } from './components/SessionView';
import { UploadModal } from './components/UploadModal';

// Import Atoms
import {
    isUploadModalOpenAtom,
    isTranscribingAtom,
    transcriptionErrorAtom
} from './store';
import { cn } from './utils'; // Import cn

function App() {
    const isModalOpen = useAtomValue(isUploadModalOpenAtom);
    const isTranscribing = useAtomValue(isTranscribingAtom);
    const transcriptionError = useAtomValue(transcriptionErrorAtom);

    return (
        <div className="flex flex-col min-h-screen bg-gray-50 dark:bg-gray-950"> {/* Adjust background */}
            {/* Header */}
            <header className="p-4 sm:p-6 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 flex-shrink-0">
                {/* Use standard h1 */}
                <h1 className={cn(
                    "text-center text-xl sm:text-2xl font-bold",
                    "text-gray-900 dark:text-gray-100" // Apply foreground color
                )}>
                     Therapy Session Analyzer
                 </h1>
            </header>

            {/* Main Content Area */}
             {/* Ensure main takes up remaining height */}
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
        </div>
    );
}

export default App;
