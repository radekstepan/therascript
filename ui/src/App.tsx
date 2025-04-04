// src/App.tsx
import React from 'react';
import { useAtomValue } from 'jotai';
import { Routes, Route, Navigate } from 'react-router-dom'; // No Outlet needed

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
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', backgroundColor: '#f8fafc' }}>
            {/* Header */}
            <header style={{ padding: '1rem 1.5rem', borderBottom: '1px solid #e5e7eb', backgroundColor: '#ffffff', flexShrink: 0 }}>
                <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', textAlign: 'center', color: '#111827' }}>
                     Therapy Session Analyzer
                 </h1>
            </header>

            {/* Main Content Area */}
            <main style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
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
