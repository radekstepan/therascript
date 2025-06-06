// packages/ui/src/components/Layout/PersistentSidebar.tsx
import React, { useState } from 'react';
import { useAtom, useSetAtom, useAtomValue } from 'jotai';
import { useNavigate as useReactRouterNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import {
  LayoutDashboard,
  ListOrdered,
  MessageSquare,
  // Star, // Removed Star icon
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

// Updated navItems: "Starred Templates" removed
const navItems: NavItemType[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, page: '/' },
  {
    id: 'sessions',
    label: 'All Sessions',
    icon: ListOrdered,
    page: '/sessions-list',
  },
  { id: 'chats', label: 'All Chats', icon: MessageSquare, page: '/chats-list' },
  // { id: 'templates', label: 'Starred Templates', icon: Star, page: '/templates' }, // REMOVED
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
          'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200',
          'border-r border-slate-200 dark:border-slate-700',
          isSidebarOpen ? 'w-64' : 'w-20'
        )}
        aria-label="Main sidebar"
      >
        {/* Top Section */}
        <div
          className={cn(
            'flex items-center h-16 p-4 border-b border-slate-200 dark:border-slate-700',
            isSidebarOpen ? 'justify-between' : 'justify-center'
          )}
        >
          {isSidebarOpen && (
            <h1 className="text-xl font-semibold text-teal-600 dark:text-teal-400">
              Therascript
            </h1>
          )}
          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="p-2 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
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
                    'hover:bg-teal-100 dark:hover:bg-teal-700 hover:text-teal-600 dark:hover:text-teal-300',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-500',
                    isSidebarOpen ? 'px-6' : 'px-0 justify-center',
                    isActive(item.page)
                      ? 'bg-teal-50 dark:bg-teal-800 text-teal-600 dark:text-teal-300 border-r-4 border-teal-500'
                      : 'text-slate-700 dark:text-slate-200'
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
            'absolute bottom-0 w-full p-4 border-t border-slate-200 dark:border-slate-700',
            !isSidebarOpen && 'flex flex-col items-center space-y-2'
          )}
        >
          {isSidebarOpen ? (
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value as Theme)}
              className="w-full p-2 text-sm bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
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
                    'p-2 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500',
                    effectiveTheme === 'light' &&
                      theme !== 'system' &&
                      'text-teal-500'
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
                    'p-2 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500',
                    effectiveTheme === 'dark' &&
                      theme !== 'system' &&
                      'text-teal-500'
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
                    'p-2 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500',
                    theme === 'system' && 'text-teal-500'
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
              'flex items-center mt-2 w-full py-2 text-left text-sm hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500',
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
        className="absolute left-full ml-3 top-1/2 -translate-y-1/2 px-2 py-1 text-xs text-white bg-slate-900 dark:bg-slate-700 rounded-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50"
        role="tooltip"
      >
        {content}
      </div>
    </div>
  );
};
