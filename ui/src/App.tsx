import React from 'react';
import { useAtomValue } from 'jotai';

// Import Components
import { LandingPage } from './components/LandingPage';
import { SessionView } from './components/SessionView';
import { UploadModal } from './components/UploadModal';

// Import Atoms
import {
    viewAtom,
    activeSessionIdAtom,
    isUploadModalOpenAtom,
    isTranscribingAtom,
    transcriptionErrorAtom
} from './store'; // Adjust path if needed

function App() {
    // Read state directly from atoms
    const view = useAtomValue(viewAtom);
    const activeSessionId = useAtomValue(activeSessionIdAtom);
    const isModalOpen = useAtomValue(isUploadModalOpenAtom);
    const isTranscribing = useAtomValue(isTranscribingAtom);
    const transcriptionError = useAtomValue(transcriptionErrorAtom);

    // Removed all useState hooks and callback definitions (navigateBack, navigateToSession, etc.)
    // Logic is now encapsulated within the write atoms in store.ts

    return (
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', backgroundColor: '#f8fafc' }}>
            {/* Header */}
            <header style={{ padding: '1rem 1.5rem', borderBottom: '1px solid #e5e7eb', backgroundColor: '#ffffff', flexShrink: 0 }}>
                <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', textAlign: 'center', color: '#111827' }}>
                     Therapy Session Analyzer
                 </h1>
            </header>

            {/* Main Content Area */}
            <main style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', padding: '1.5rem', overflowY: 'auto' }}>
                {view === 'landing' && <LandingPage />}
                {/* Conditionally render SessionView based on view and activeSessionId */}
                {view === 'session' && activeSessionId !== null && (
                    <SessionView key={activeSessionId} /> // Pass key for re-mounting on session change
                )}
                 {/* Handle case where view is 'session' but ID is null (shouldn't normally happen with atom logic) */}
                 {view === 'session' && activeSessionId === null && (
                     // This state should ideally be prevented by the navigation atoms logic
                    <div className="text-center text-red-500 p-10">Error: Session view active but no session ID. This indicates a state inconsistency.</div>
                 )}
            </main>

            {/* Upload Modal - Reads its state directly from atoms */}
            <UploadModal
                isOpen={isModalOpen}
                isTranscribing={isTranscribing}
                transcriptionError={transcriptionError}
            />
        </div>
    );
}

export default App;
