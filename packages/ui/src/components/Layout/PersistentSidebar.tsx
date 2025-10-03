// packages/ui/src/components/Layout/PersistentSidebar.tsx
import React, { useState } from 'react';
import { useAtom, useSetAtom, useAtomValue } from 'jotai';
import { useNavigate as useReactRouterNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import {
  LayoutDashboard,
  ListOrdered,
  MessageSquare,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  Moon,
  Laptop,
  Timer,
  Power,
  AlertTriangle,
  Star,
  BarChart,
} from 'lucide-react';
import {
  AlertDialog,
  Button as RadixButton,
  Flex,
  Spinner,
  Text,
} from '@radix-ui/themes';
import { themeAtom, Theme } from '../../store/ui/themeAtom';
import { effectiveThemeAtom } from '../../store';
import { isPersistentSidebarOpenAtom } from '../../store/ui/isPersistentSidebarOpenAtom';
import { currentPageAtom } from '../../store/navigation/currentPageAtom';
import { cn } from '../../utils';
import { toastMessageAtom } from '../../store';
import { JobsQueueModal } from '../Jobs/JobsQueueModal';
import { requestAppShutdown } from '../../api/api';

interface NavItemType {
  id: string;
  label: string;
  icon: React.ElementType;
  page: string;
}

const navItems: NavItemType[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, page: '/' },
  {
    id: 'sessions',
    label: 'All Sessions',
    icon: ListOrdered,
    page: '/sessions-list',
  },
  { id: 'analysis', label: 'Analysis', icon: BarChart, page: '/analysis-jobs' },
  { id: 'chats', label: 'All Chats', icon: MessageSquare, page: '/chats-list' },
  { id: 'templates', label: 'Templates', icon: Star, page: '/templates' },
  { id: 'settings', label: 'Settings', icon: Settings, page: '/settings' },
];

export function PersistentSidebar() {
  const [isSidebarOpen, setIsSidebarOpen] = useAtom(
    isPersistentSidebarOpenAtom
  );
  const currentPage = useAtomValue(currentPageAtom);
  const [theme, setTheme] = useAtom(themeAtom);
  const effectiveTheme = useAtomValue(effectiveThemeAtom);
  const setToast = useSetAtom(toastMessageAtom);
  const reactRouterNavigate = useReactRouterNavigate();

  const [isJobsModalOpen, setIsJobsModalOpen] = useState(false);
  const [isShutdownConfirmOpen, setIsShutdownConfirmOpen] = useState(false);

  const navigateTo = (pagePath: string) => {
    reactRouterNavigate(pagePath);
  };

  const isActive = (pagePath: string) => currentPage === pagePath;

  const handleJobsQueueClick = () => {
    setIsJobsModalOpen(true);
  };

  const shutdownMutation = useMutation({
    mutationFn: requestAppShutdown,
    onSuccess: (data) => {
      setToast(
        `✅ Shutdown initiated: ${data.message}. The application will now close.`
      );
    },
    onError: (error: Error) => {
      if (
        error.message.toLowerCase().includes('not reachable') ||
        error.message.toLowerCase().includes('network error')
      ) {
        setToast(
          `❌ Shutdown Error: Could not reach the shutdown service. Is the main script (run-dev/run-prod) running?`
        );
      } else {
        setToast(
          `❌ Shutdown Error: ${error.message}. Please check the console for details.`
        );
      }
      setIsShutdownConfirmOpen(false);
    },
  });

  const handleShutdownAppClick = () => {
    setIsShutdownConfirmOpen(true);
  };

  const handleConfirmShutdown = () => {
    shutdownMutation.mutate();
  };

  return (
    <>
      <div
        className={cn(
          'fixed top-0 left-0 h-full flex flex-col shadow-lg z-40 transition-all duration-300 ease-in-out',
          // MODIFIED: Use Radix accent variables for background, text, and border
          'bg-[var(--accent-2)] text-[var(--accent-11)]',
          'border-r border-[var(--accent-6)]',
          isSidebarOpen ? 'w-64' : 'w-20'
        )}
        aria-label="Main sidebar"
      >
        {/* Top Section */}
        <div
          className={cn(
            'flex items-center h-16 p-4',
            // MODIFIED: Use Radix accent variable for border
            'border-b border-[var(--accent-6)]',
            isSidebarOpen ? 'justify-between' : 'justify-center'
          )}
        >
          {isSidebarOpen && (
            // MODIFIED: Use Radix accent variable for brand text color
            <h1 className="text-xl font-semibold text-[var(--accent-12)]">
              Therascript
            </h1>
          )}
          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            // MODIFIED: Use Radix accent variables for hover and focus ring
            className="p-2 rounded-md hover:bg-[var(--accent-a4)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-8)]"
            aria-label={isSidebarOpen ? 'Close sidebar' : 'Open sidebar'}
            aria-expanded={isSidebarOpen}
          >
            {isSidebarOpen ? (
              <PanelLeftClose size={20} aria-hidden="true" />
            ) : (
              <PanelLeftOpen size={20} aria-hidden="true" />
            )}
          </button>
        </div>

        {/* Navigation Section */}
        <nav className="mt-4 flex-grow" aria-label="Main navigation">
          <ul>
            {navItems.map((item) => (
              <li key={item.id}>
                <button
                  onClick={() => navigateTo(item.page)}
                  title={item.label}
                  className={cn(
                    'flex items-center w-full py-3 text-left transition-colors duration-150 ease-in-out',
                    // MODIFIED: Use Radix accent variables for hover, focus, active states
                    !isActive(item.page) &&
                      'hover:bg-[var(--accent-a3)] hover:text-[var(--accent-12)]',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent-8)]',
                    isSidebarOpen ? 'px-6' : 'px-0 justify-center',
                    isActive(item.page)
                      ? 'bg-[var(--accent-4)] text-[var(--accent-12)] border-r-4 border-[var(--accent-9)] font-medium'
                      : 'text-[var(--accent-11)]'
                  )}
                  aria-current={isActive(item.page) ? 'page' : undefined}
                >
                  <item.icon
                    size={20}
                    className={cn(isSidebarOpen ? 'mr-3' : 'mr-0')}
                    aria-hidden="true"
                  />
                  {isSidebarOpen && <span>{item.label}</span>}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {/* Bottom Section */}
        <div
          className={cn(
            'absolute bottom-0 w-full p-4',
            // MODIFIED: Use Radix accent variable for border
            'border-t border-[var(--accent-6)]',
            !isSidebarOpen && 'flex flex-col items-center space-y-2'
          )}
        >
          {isSidebarOpen ? (
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value as Theme)}
              // MODIFIED: Use Radix accent variables for theme select styling
              className="w-full p-2 text-sm bg-[var(--accent-3)] border border-[var(--accent-7)] text-[var(--accent-12)] rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--accent-8)] focus:border-[var(--accent-8)]"
              aria-label="Select theme"
            >
              <option value="light">Light Mode</option>
              <option value="dark">Dark Mode</option>
              <option value="system">System</option>
            </select>
          ) : (
            <div
              className="flex flex-col space-y-1"
              role="group"
              aria-label="Theme selection"
            >
              <TooltipWrapper content="Light Theme">
                <button
                  onClick={() => setTheme('light')}
                  className={cn(
                    // MODIFIED: Use Radix accent variables for theme buttons
                    'p-2 rounded-md hover:bg-[var(--accent-a4)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-8)]',
                    effectiveTheme === 'light' &&
                      theme !== 'system' &&
                      'text-[var(--accent-9)]' // Active theme icon color
                  )}
                  aria-label="Set light theme"
                  aria-pressed={
                    effectiveTheme === 'light' && theme !== 'system'
                  }
                >
                  <Sun size={20} aria-hidden="true" />
                </button>
              </TooltipWrapper>
              <TooltipWrapper content="Dark Theme">
                <button
                  onClick={() => setTheme('dark')}
                  className={cn(
                    // MODIFIED: Use Radix accent variables
                    'p-2 rounded-md hover:bg-[var(--accent-a4)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-8)]',
                    effectiveTheme === 'dark' &&
                      theme !== 'system' &&
                      'text-[var(--accent-9)]' // Active theme icon color
                  )}
                  aria-label="Set dark theme"
                  aria-pressed={effectiveTheme === 'dark' && theme !== 'system'}
                >
                  <Moon size={20} aria-hidden="true" />
                </button>
              </TooltipWrapper>
              <TooltipWrapper content="System Theme">
                <button
                  onClick={() => setTheme('system')}
                  className={cn(
                    // MODIFIED: Use Radix accent variables
                    'p-2 rounded-md hover:bg-[var(--accent-a4)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-8)]',
                    theme === 'system' && 'text-[var(--accent-9)]' // Active theme icon color
                  )}
                  aria-label="Set system theme"
                  aria-pressed={theme === 'system'}
                >
                  <Laptop size={20} aria-hidden="true" />
                </button>
              </TooltipWrapper>
            </div>
          )}

          <button
            title="Active Jobs"
            onClick={handleJobsQueueClick}
            className={cn(
              'flex items-center mt-2 w-full py-2 text-left text-sm hover:bg-[var(--accent-a3)] rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-8)]',
              isSidebarOpen ? 'px-3' : 'justify-center px-0'
            )}
          >
            <Timer
              size={18}
              className={cn(isSidebarOpen ? 'mr-2' : 'mr-0')}
              aria-hidden="true"
            />
            {isSidebarOpen && 'Active Jobs'}
          </button>

          {/* Shutdown button - kept red styling for destructive action */}
          <button
            title="Shutdown App"
            onClick={handleShutdownAppClick}
            className={cn(
              'flex items-center mt-2 w-full py-2 text-left text-sm text-red-500 hover:bg-red-100 dark:hover:bg-red-700 dark:text-red-400 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500',
              isSidebarOpen ? 'px-3' : 'justify-center px-0'
            )}
            disabled={shutdownMutation.isPending}
          >
            {shutdownMutation.isPending ? (
              <Spinner size="1" className={cn(isSidebarOpen ? 'mr-2' : '')} />
            ) : (
              <Power
                size={18}
                className={cn(isSidebarOpen ? 'mr-2' : 'mr-0')}
                aria-hidden="true"
              />
            )}
            {isSidebarOpen &&
              (shutdownMutation.isPending
                ? 'Shutting down...'
                : 'Shutdown App')}
          </button>
        </div>
      </div>

      <JobsQueueModal
        isOpen={isJobsModalOpen}
        onOpenChange={setIsJobsModalOpen}
      />

      <AlertDialog.Root
        open={isShutdownConfirmOpen}
        onOpenChange={setIsShutdownConfirmOpen}
      >
        <AlertDialog.Content style={{ maxWidth: 450 }}>
          <AlertDialog.Title>
            <Flex align="center" gap="2">
              <AlertTriangle className="text-red-500" /> Confirm Shutdown
            </Flex>
          </AlertDialog.Title>
          <AlertDialog.Description size="2">
            Are you sure you want to shut down all application services? This
            will close the backend and associated Docker containers.
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <RadixButton
                variant="soft"
                color="gray"
                onClick={() => setIsShutdownConfirmOpen(false)}
                disabled={shutdownMutation.isPending}
              >
                Cancel
              </RadixButton>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <RadixButton
                color="red"
                onClick={handleConfirmShutdown}
                disabled={shutdownMutation.isPending}
              >
                {shutdownMutation.isPending && <Spinner size="1" />}
                <Text ml={shutdownMutation.isPending ? '2' : '0'}>
                  {shutdownMutation.isPending ? 'Shutting Down...' : 'Shutdown'}
                </Text>
              </RadixButton>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </>
  );
}

const TooltipWrapper: React.FC<{
  content: string;
  children: React.ReactNode;
}> = ({ content, children }) => {
  return (
    <div className="relative group">
      {children}
      <div
        className="absolute left-full ml-3 top-1/2 -translate-y-1/2 px-2 py-1 text-xs text-white bg-gray-900 dark:bg-gray-700 rounded-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50"
        role="tooltip"
      >
        {content}
      </div>
    </div>
  );
};
