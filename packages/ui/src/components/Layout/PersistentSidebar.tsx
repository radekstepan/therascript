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
  Container as ContainerIcon,
  Power,
  AlertTriangle,
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
import { DockerStatusModal } from '../User/DockerStatusModal';
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
  { id: 'chats', label: 'All Chats', icon: MessageSquare, page: '/chats-list' },
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

  const [isDockerModalOpen, setIsDockerModalOpen] = useState(false);
  const [isShutdownConfirmOpen, setIsShutdownConfirmOpen] = useState(false);

  const navigateTo = (pagePath: string) => {
    reactRouterNavigate(pagePath);
  };

  const isActive = (pagePath: string) => currentPage === pagePath;

  const handleDockerStatusClick = () => {
    setIsDockerModalOpen(true);
  };

  const shutdownMutation = useMutation({
    mutationFn: requestAppShutdown,
    onSuccess: (data) => {
      setToast(
        `? Shutdown initiated: ${data.message}. The application will now close.`
      );
    },
    onError: (error: Error) => {
      if (
        error.message.toLowerCase().includes('not reachable') ||
        error.message.toLowerCase().includes('network error')
      ) {
        setToast(
          `? Shutdown Error: Could not reach the shutdown service. Is the main script (run-dev/run-prod) running?`
        );
      } else {
        setToast(
          `? Shutdown Error: ${error.message}. Please check the console for details.`
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
          'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200',
          'border-r border-gray-200 dark:border-gray-700',
          isSidebarOpen ? 'w-64' : 'w-20'
        )}
        aria-label="Main sidebar"
      >
        {/* Top Section */}
        <div
          className={cn(
            'flex items-center h-16 p-4 border-b border-gray-200 dark:border-gray-700',
            isSidebarOpen ? 'justify-between' : 'justify-center'
          )}
        >
          {isSidebarOpen && (
            // MODIFIED: Changed "Therascript" brand text color from teal to gray
            <h1 className="text-xl font-semibold text-gray-700 dark:text-gray-300">
              Therascript
            </h1>
          )}
          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            // MODIFIED: Changed focus ring from teal to gray
            className="p-2 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500"
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
                    // MODIFIED: Hover states from teal to gray
                    'hover:bg-gray-200 dark:hover:bg-gray-600 hover:text-gray-800 dark:hover:text-gray-100',
                    // MODIFIED: Focus ring from teal to gray
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-500',
                    isSidebarOpen ? 'px-6' : 'px-0 justify-center',
                    isActive(item.page)
                      ? // MODIFIED: Active states from teal to gray
                        'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-50 border-r-4 border-gray-500 dark:border-gray-400'
                      : 'text-gray-700 dark:text-gray-200'
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
            'absolute bottom-0 w-full p-4 border-t border-gray-200 dark:border-gray-700',
            !isSidebarOpen && 'flex flex-col items-center space-y-2'
          )}
        >
          {isSidebarOpen ? (
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value as Theme)}
              // MODIFIED: Focus ring from teal to gray
              className="w-full p-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-500 focus:border-gray-500"
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
                    // MODIFIED: Focus ring from teal to gray
                    'p-2 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500',
                    // MODIFIED: Active theme icon color from teal to gray
                    effectiveTheme === 'light' &&
                      theme !== 'system' &&
                      'text-gray-600 dark:text-gray-400' // Using a general "active-looking" gray
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
                    // MODIFIED: Focus ring from teal to gray
                    'p-2 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500',
                    // MODIFIED: Active theme icon color from teal to gray
                    effectiveTheme === 'dark' &&
                      theme !== 'system' &&
                      'text-gray-600 dark:text-gray-400'
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
                    // MODIFIED: Focus ring from teal to gray
                    'p-2 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500',
                    // MODIFIED: Active theme icon color from teal to gray
                    theme === 'system' && 'text-gray-600 dark:text-gray-400'
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
            title="Docker Status"
            onClick={handleDockerStatusClick}
            className={cn(
              // MODIFIED: Focus ring from teal to gray
              'flex items-center mt-2 w-full py-2 text-left text-sm hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500',
              isSidebarOpen ? 'px-3' : 'justify-center px-0'
            )}
          >
            <ContainerIcon
              size={18}
              className={cn(isSidebarOpen ? 'mr-2' : 'mr-0')}
              aria-hidden="true"
            />
            {isSidebarOpen && 'Docker Status'}
          </button>

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

      <DockerStatusModal
        isOpen={isDockerModalOpen}
        onOpenChange={setIsDockerModalOpen}
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
