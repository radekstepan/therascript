// packages/ui/src/App.tsx
import React from 'react';
import { useAtomValue } from 'jotai';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Theme } from '@radix-ui/themes';
import * as Toast from '@radix-ui/react-toast';
import { useQueryClient } from '@tanstack/react-query';
import axios from 'axios';

import { LandingPage } from './components/LandingPage/LandingPage';
import { SessionView } from './components/SessionView/SessionView';
import { UploadModal } from './components/UploadModal/UploadModal';

import {
  isUploadModalOpenAtom,
  effectiveThemeAtom, // Keep UI atoms
} from './store';

// TODO: This should come from config/environment variables, not hardcoded.
// Setting up proper environment variable handling in Webpack requires
// additional configuration (e.g., DefinePlugin or dotenv-webpack).
// Using hardcoded default for now as `process.env` is not available in browser.
const API_BASE_URL = 'http://localhost:3001';
axios.defaults.baseURL = API_BASE_URL;
console.log(`[App] Axios base URL set to: ${axios.defaults.baseURL}`);

// TODO include an Error Boundary
function App() {
  const isModalOpen = useAtomValue(isUploadModalOpenAtom);
  const effectiveTheme = useAtomValue(effectiveThemeAtom);
  // Access queryClient if needed for global actions (though mutations handle most)
  // const queryClient = useQueryClient();

  // TODO wtf is 2147483647 (It's Radix's default high z-index for toasts)
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

          <UploadModal isOpen={isModalOpen} /> {/* Remove props handled by useMutation */}

          <Toast.Viewport className="fixed bottom-0 right-0 flex flex-col p-6 gap-3 w-[390px] max-w-[100vw] m-0 list-none z-[2147483647] outline-none" />
        </div>
      </Theme>
    </Toast.Provider>
  );
}

export default App;
