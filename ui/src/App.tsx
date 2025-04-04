import React from 'react';
import { useAtomValue } from 'jotai';
import { Routes, Route, Navigate } from 'react-router-dom'; // Import routing components

// Import Components
import { LandingPage } from './components/LandingPage';
import { SessionView } from './components/SessionView';
import { UploadModal } from './components/UploadModal';

// Import Atoms (only those needed by App itself, like modal state)
import {
    // viewAtom, // No longer needed for routing
    // activeSessionIdAtom, // SessionView will handle this via params
    isUploadModalOpenAtom,
    isTranscribingAtom,
    transcriptionErrorAtom
} from './store';

function App() {
    // Read state needed directly by App (like modal state)
    const isModalOpen = useAtomValue(isUploadModalOpenAtom);
    const isTranscribing = useAtomValue(isTranscribingAtom);
    const transcriptionError = useAtomValue(transcriptionErrorAtom);

    // Logic previously handled by viewAtom is now managed by Routes

    return (
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', backgroundColor: '#f8fafc' }}>
            {/* Header */}
            <header style={{ padding: '1rem 1.5rem', borderBottom: '1px solid #e5e7eb', backgroundColor: '#ffffff', flexShrink: 0 }}>
                <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', textAlign: 'center', color: '#111827' }}>
                     Therapy Session Analyzer
                 </h1>
            </header>

            {/* Main Content Area using Routes */}
            <main style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', padding: '1.5rem', overflowY: 'auto' }}>
                <Routes>
                    {/* Route for the landing page */}
                    <Route path="/" element={<LandingPage />} />

                    {/* Route for a specific session (defaults to latest chat or no chat if none exist) */}
                    <Route path="/sessions/:sessionId" element={<SessionView />} />

                    {/* Route for a specific session AND a specific chat */}
                    <Route path="/sessions/:sessionId/chats/:chatId" element={<SessionView />} />

                    {/* Optional: Redirect any unknown paths back to landing */}
                    <Route path="*" element={<Navigate replace to="/" />} />
                </Routes>
            </main>

            {/* Upload Modal - state managed by atoms, rendered conditionally */}
            {/* Pass props needed for display */}
            <UploadModal
                isOpen={isModalOpen}
                isTranscribing={isTranscribing}
                transcriptionError={transcriptionError}
            />
        </div>
    );
}

export default App;
