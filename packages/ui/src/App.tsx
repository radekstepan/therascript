// packages/ui/src/App.tsx
import React, { useEffect, useState, useLayoutEffect } from 'react';
import { useAtom, useSetAtom, useAtomValue } from 'jotai';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Theme as RadixTheme, IconButton, Text } from '@radix-ui/themes';
import * as Toast from '@radix-ui/react-toast';
import { Cross2Icon } from '@radix-ui/react-icons';
import axios from 'axios';

// Page Components
import { LandingPage } from './components/LandingPage/LandingPage';
import { SessionView } from './components/SessionView/SessionView';
import { StandaloneChatView } from './components/StandaloneChatView/StandaloneChatView';
import { SettingsPage } from './components/SettingsPage';
import { StandaloneChatsPage } from './components/StandaloneChatsPage';
import { SessionsPage } from './components/SessionsPage';

// Layout and Modals
import { UploadModal } from './components/UploadModal/UploadModal';
import { PersistentSidebar } from './components/Layout/PersistentSidebar';
import { GeneratedBackground } from './components/Layout/GeneratedBackground';
import { TopToolbar } from './components/Layout/TopToolbar';

// Store
import {
  isUploadModalOpenAtom,
  effectiveThemeAtom,
  toastMessageAtom,
  themeAtom,
  accentColorAtom,
} from './store';
import { isPersistentSidebarOpenAtom } from './store/ui/isPersistentSidebarOpenAtom';
import { currentPageAtom } from './store/navigation/currentPageAtom';
import { cn } from './utils';

const API_BASE_URL = 'http://localhost:3001';
axios.defaults.baseURL = API_BASE_URL;

const PageContentManager: React.FC = () => {
  const location = useLocation();
  const setCurrentPageAtom = useSetAtom(currentPageAtom);

  useEffect(() => {
    let pageKey = location.pathname;
    if (location.pathname === '/') pageKey = '/';
    else if (location.pathname.startsWith('/sessions-list'))
      pageKey = '/sessions-list';
    else if (location.pathname.startsWith('/chats-list'))
      pageKey = '/chats-list';
    else if (location.pathname.startsWith('/settings')) pageKey = '/settings';
    else if (location.pathname.startsWith('/sessions/'))
      pageKey = '/sessions-list';
    else if (location.pathname.startsWith('/chats/')) pageKey = '/chats-list';

    setCurrentPageAtom(pageKey);
  }, [location, setCurrentPageAtom]);

  return (
    // This container needs to fill the space given by <main>
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/sessions/:sessionId" element={<SessionView />} />
        <Route
          path="/sessions/:sessionId/chats/:chatId"
          element={<SessionView />}
        />
        <Route path="/chats/:chatId" element={<StandaloneChatView />} />
        <Route path="/sessions-list" element={<SessionsPage />} />
        <Route path="/chats-list" element={<StandaloneChatsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate replace to="/" />} />
      </Routes>
    </div>
  );
};

function App() {
  const isModalOpen = useAtomValue(isUploadModalOpenAtom);
  const effectiveTheme = useAtomValue(effectiveThemeAtom);
  const [toastMessageContent, setToastMessageAtom] = useAtom(toastMessageAtom);
  const [isToastVisible, setIsToastVisible] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useAtom(
    isPersistentSidebarOpenAtom
  );
  const currentAccentColor = useAtomValue(accentColorAtom);

  useLayoutEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) {
        setIsSidebarOpen(false);
      }
    };
    if (window.innerWidth < 768) {
      setIsSidebarOpen(false);
    }
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [setIsSidebarOpen]);

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
      <RadixTheme
        appearance={effectiveTheme}
        accentColor={currentAccentColor}
        panelBackground="solid"
        radius="medium"
        scaling="100%"
      >
        <GeneratedBackground />
        {/* Root container ensures RadixTheme styles apply globally and takes full viewport height */}
        <div className="flex flex-col h-screen">
          {/* Main layout flex container: Sidebar + Content Area */}
          <div className="flex flex-grow overflow-hidden">
            {' '}
            {/* Prevents this div from scrolling */}
            <PersistentSidebar /> {/* Fixed width, managed internally */}
            {/* Content area that grows and handles its own internal layout */}
            <div
              className={cn(
                'flex flex-col flex-grow transition-all duration-300 ease-in-out overflow-hidden', // Added overflow-hidden
                isSidebarOpen ? 'ml-64' : 'ml-20'
              )}
            >
              <TopToolbar /> {/* App Header, fixed height */}
              {/* Main content rendering area */}
              <main
                className="flex-grow flex flex-col overflow-hidden" // Ensures <main> fills space and manages overflow
                id="main-content"
                style={{ backgroundColor: 'transparent', minHeight: 0 }} // minHeight: 0 is key for flex children
              >
                <PageContentManager />{' '}
                {/* Renders the current page, should fill <main> */}
              </main>
            </div>
          </div>

          <UploadModal isOpen={isModalOpen} />

          {/* Toast (Notifications) */}
          <Toast.Root
            open={isToastVisible}
            onOpenChange={handleToastOpenChange}
            duration={5000}
            className="rt-Toast-root-bordered bg-[var(--color-panel-solid)] rounded-md shadow-[hsl(206_22%_7%_/_35%)_0px_10px_38px_-10px,_hsl(206_22%_7%_/_20%)_0px_10px_20px_-15px] p-[15px] grid [grid-template-areas:_'title_action'_'description_action'] grid-cols-[auto_max-content] gap-x-[15px] items-center data-[state=open]:animate-slideIn data-[state=closed]:animate-hide data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=cancel]:translate-x-0 data-[swipe=cancel]:transition-[transform_200ms_ease-out] data-[swipe=end]:animate-swipeOut"
          >
            <Toast.Description className="[grid-area:_description] m-0 text-[var(--gray-11)] text-[13px] leading-[1.3]">
              {toastMessageContent}
            </Toast.Description>
            <Toast.Close className="[grid-area:_action]" asChild>
              <IconButton
                variant="ghost"
                color="gray"
                size="1"
                aria-label="Close"
              >
                <Cross2Icon />
              </IconButton>
            </Toast.Close>
          </Toast.Root>
          <Toast.Viewport className="fixed bottom-0 right-0 flex flex-col p-6 gap-3 w-[390px] max-w-[100vw] m-0 list-none z-[2147483647] outline-none" />
        </div>
      </RadixTheme>
    </Toast.Provider>
  );
}

export default App;
