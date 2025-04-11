// src/App.tsx
import React from 'react';
import { useAtomValue } from 'jotai';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Theme } from '@radix-ui/themes';
import * as Toast from '@radix-ui/react-toast';
import axios from 'axios';

// Correct component import paths relative to src/
import { LandingPage } from './components/LandingPage';
import { SessionView } from './components/SessionView';
import { UploadModal } from './components/UploadModal';

import {
    // Import from main store index
    effectiveThemeAtom,
} from './store'; // Path should be relative to src/App.tsx

// Configure axios base URL
axios.defaults.baseURL = 'http://localhost:3001'; // Adjust based on your backend URL

function App() {
  const effectiveTheme = useAtomValue(effectiveThemeAtom);

  return (
    <Toast.Provider swipeDirection="right">
      <Theme appearance={effectiveTheme} accentColor="teal" panelBackground="solid" radius="small" scaling="100%">
        <div className="flex flex-col min-h-screen">
          <main className="flex-grow flex flex-col overflow-y-auto">
            <Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/sessions/:sessionId" element={<SessionView />} />
              <Route path="/sessions/:sessionId/chats/:chatId" element={<SessionView />} />
              <Route path="*" element={<Navigate replace to="/" />} />
            </Routes>
          </main>

          {/* Render UploadModal without props - hook manages its state */}
          <UploadModal />

          <Toast.Viewport className="fixed bottom-0 right-0 flex flex-col p-6 gap-3 w-[390px] max-w-[100vw] m-0 list-none z-[2147483647] outline-none" />
        </div>
      </Theme>
    </Toast.Provider>
  );
}

export default App;
