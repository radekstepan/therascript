// src/App.tsx
import React from 'react';
import { useAtomValue } from 'jotai';
import { Routes, Route, Navigate } from 'react-router-dom'; // No Outlet needed

import { Title } from '@tremor/react';
// Import Components
import { LandingPage } from './components/LandingPage';
import { SessionView } from './components/SessionView'; // Renders all sections
// Remove sub-component imports here
import { UploadModal } from './components/UploadModal';

// Import Atoms
import {
    isUploadModalOpenAtom,
    isTranscribingAtom,
    transcriptionErrorAtom
} from './store';

function App() {
    const isModalOpen = useAtomValue(isUploadModalOpenAtom);
    const isTranscribing = useAtomValue(isTranscribingAtom);
    const transcriptionError = useAtomValue(transcriptionErrorAtom);

    return (
        <div className="flex flex-col min-h-screen bg-gray-50">
            {/* Header */}
            <header className="p-4 sm:p-6 border-b border-gray-200 bg-white flex-shrink-0">
                <Title className="text-center text-xl sm:text-2xl font-bold text-gray-900">
                     Therapy Session Analyzer
                 </Title>
            </header>

            {/* Main Content Area */}
            <main className="flex-grow flex flex-col overflow-y-auto">
                <Routes>
                    <Route path="/" element={<LandingPage />} />

                    {/* Route for session, defaulting to latest chat (handled in SessionView) */}
                    <Route path="/sessions/:sessionId" element={<SessionView />} />
                    {/* Route for specific session and chat */}
                    <Route path="/sessions/:sessionId/chats/:chatId" element={<SessionView />} />

                    {/* Redirect any other unknown paths back to landing */}
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
