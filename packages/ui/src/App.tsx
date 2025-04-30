// Path: packages/ui/src/App.tsx
import React, { useEffect, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Theme, IconButton } from '@radix-ui/themes';
import * as Toast from '@radix-ui/react-toast';
import { Cross2Icon } from '@radix-ui/react-icons';
import axios from 'axios';

import { LandingPage } from './components/LandingPage/LandingPage';
import { SessionView } from './components/SessionView/SessionView';
import { StandaloneChatView } from './components/StandaloneChatView/StandaloneChatView'; // <-- Import updated view
import { UploadModal } from './components/UploadModal/UploadModal';

import {
  isUploadModalOpenAtom,
  effectiveThemeAtom,
  toastMessageAtom,
} from './store';

const API_BASE_URL = 'http://localhost:3001';
axios.defaults.baseURL = API_BASE_URL;
console.log(`[App] Axios base URL set to: ${axios.defaults.baseURL}`);

function App() {
  const isModalOpen = useAtomValue(isUploadModalOpenAtom);
  const effectiveTheme = useAtomValue(effectiveThemeAtom);
  const toastMessageContent = useAtomValue(toastMessageAtom);
  const setToastMessageAtom = useSetAtom(toastMessageAtom);
  const [isToastVisible, setIsToastVisible] = useState(false);

  useEffect(() => {
    setIsToastVisible(!!toastMessageContent);
  }, [toastMessageContent]);

  const handleToastOpenChange = (open: boolean) => {
    setIsToastVisible(open);
    if (!open) {
      setToastMessageAtom(null);
    }
  };

  return (
    <Toast.Provider swipeDirection="right">
      <Theme appearance={effectiveTheme} accentColor="teal" panelBackground="solid" radius="small" scaling="100%">
        {/* Ensure root div allows Flex layout */}
        <div className="flex flex-col min-h-screen">
          {/* Main content area should allow flex-grow */}
          <main className="flex-grow flex flex-col overflow-y-auto">
            <Routes>
              <Route path="/" element={<LandingPage />} />
              {/* Session Routes */}
              <Route path="/sessions/:sessionId" element={<SessionView />} />
              <Route path="/sessions/:sessionId/chats/:chatId" element={<SessionView />} />
              {/* Standalone Chat Routes */}
              {/* Use the new component for standalone chats */}
              <Route path="/chats/:chatId" element={<StandaloneChatView />} /> {/* <-- Use StandaloneChatView */}
              {/* Fallback Route */}
              <Route path="*" element={<Navigate replace to="/" />} />
            </Routes>
          </main>

          <UploadModal isOpen={isModalOpen} />

          <Toast.Root
                open={isToastVisible}
                onOpenChange={handleToastOpenChange}
                duration={5000}
                // Added border class 'rt-Toast-root-bordered'
                className="rt-Toast-root-bordered bg-[--color-panel-solid] rounded-md shadow-[hsl(206_22%_7%_/_35%)_0px_10px_38px_-10px,_hsl(206_22%_7%_/_20%)_0px_10px_20px_-15px] p-[15px] grid [grid-template-areas:_'title_action'_'description_action'] grid-cols-[auto_max-content] gap-x-[15px] items-center data-[state=open]:animate-slideIn data-[state=closed]:animate-hide data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=cancel]:translate-x-0 data-[swipe=cancel]:transition-[transform_200ms_ease-out] data-[swipe=end]:animate-swipeOut"
            >
                <Toast.Description className="[grid-area:_description] m-0 text-[--gray-a11] text-[13px] leading-[1.3]">
                    {toastMessageContent}
                </Toast.Description>
                <Toast.Close className="[grid-area:_action]" asChild>
                    <IconButton variant="ghost" color="gray" size="1" aria-label="Close">
                        <Cross2Icon />
                    </IconButton>
                </Toast.Close>
            </Toast.Root>

          <Toast.Viewport className="fixed bottom-0 right-0 flex flex-col p-6 gap-3 w-[390px] max-w-[100vw] m-0 list-none z-[2147483647] outline-none" />
        </div>
      </Theme>
    </Toast.Provider>
  );
}

export default App;

// TODO comments should not be removed
