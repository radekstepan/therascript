// packages/ui/src/components/Layout/PersistentSidebar.tsx
import React, { useState } from 'react';
import { useAtom, useSetAtom, useAtomValue } from 'jotai';
import { useNavigate as useReactRouterNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
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
  BrainCircuit,
} from 'lucide-react';
import {
  AlertDialog,
  Button as RadixButton,
  Flex,
  Spinner,
  Text,
  Badge,
  Select,
} from '@radix-ui/themes';
import { themeAtom, Theme } from '../../store/ui/themeAtom';
import { effectiveThemeAtom } from '../../store';
import { isPersistentSidebarOpenAtom } from '../../store/ui/isPersistentSidebarOpenAtom';
import { currentPageAtom } from '../../store/navigation/currentPageAtom';
import { cn } from '../../utils';
import { toastMessageAtom } from '../../store';
import { JobsQueueModal } from '../Jobs/JobsQueueModal';
import { requestAppShutdown, fetchActiveJobCount } from '../../api/api';
import { GpuStatusIndicator } from '../User/GpuStatusIndicator';
import type { ActiveJobCount } from '../../types';

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

  const { data: activeJobCountData } = useQuery<ActiveJobCount, Error>({
    queryKey: ['activeJobCount'],
    queryFn: fetchActiveJobCount,
    refetchInterval: 5000,
    staleTime: 4000,
  });
  const activeJobCount = activeJobCountData?.total ?? 0;

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
          'fixed top-0 left-0 h-full flex flex-col shadow-xl z-40 transition-all duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1.0)]',
          'bg-[var(--gray-1)] text-[var(--gray-11)]',
          'border-r border-[var(--gray-a4)]',
          isSidebarOpen ? 'w-64' : 'w-20'
        )}
        style={{
          backgroundColor: 'var(--color-panel-solid)',
        }}
        aria-label="Main sidebar"
      >
        {/* Top Section */}
        <div
          className={cn(
            'flex items-center h-16 p-4',
            isSidebarOpen ? 'justify-between' : 'justify-center'
          )}
        >
          {isSidebarOpen && (
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-[var(--accent-9)] rounded-md flex items-center justify-center">
                <BrainCircuit size={18} className="text-white" />
              </div>
              <h1 className="text-lg font-bold text-[var(--gray-12)] tracking-tight">
                Therascript
              </h1>
            </div>
          )}
          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="p-2 rounded-lg text-[var(--gray-11)] hover:bg-[var(--gray-a3)] hover:text-[var(--gray-12)] focus:outline-none transition-colors"
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
        <nav className="mt-6 flex-grow px-3" aria-label="Main navigation">
          <ul className="space-y-1">
            {navItems.map((item) => (
              <li key={item.id}>
                <button
                  onClick={() => navigateTo(item.page)}
                  title={!isSidebarOpen ? item.label : undefined}
                  className={cn(
                    'flex items-center w-full py-2.5 rounded-lg text-sm font-medium transition-all duration-200',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-8)]',
                    isSidebarOpen ? 'px-3' : 'px-0 justify-center',
                    isActive(item.page)
                      ? 'bg-[var(--accent-a3)] text-[var(--accent-11)]'
                      : 'text-[var(--gray-11)] hover:bg-[var(--gray-a3)] hover:text-[var(--gray-12)]'
                  )}
                  aria-current={isActive(item.page) ? 'page' : undefined}
                >
                  <item.icon
                    size={20}
                    className={cn(
                      isSidebarOpen ? 'mr-3' : 'mr-0',
                      isActive(item.page)
                        ? 'text-[var(--accent-11)]'
                        : 'text-[var(--gray-10)]'
                    )}
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
            'border-t border-[var(--gray-a4)] bg-[var(--gray-2)]/50',
            !isSidebarOpen && 'flex flex-col items-center space-y-2'
          )}
        >
          {isSidebarOpen ? (
            <div className="mb-2">
              <Text
                size="1"
                color="gray"
                className="mb-1 ml-1 block font-medium uppercase tracking-wider"
              >
                Theme
              </Text>
              <Select.Root
                value={theme}
                onValueChange={(value) => setTheme(value as Theme)}
                size="2"
              >
                <Select.Trigger
                  placeholder="Select theme..."
                  style={{ width: '100%' }}
                  aria-label="Select theme"
                />
                <Select.Content>
                  <Select.Item value="light">Light Mode</Select.Item>
                  <Select.Item value="dark">Dark Mode</Select.Item>
                  <Select.Item value="system">System</Select.Item>
                </Select.Content>
              </Select.Root>
            </div>
          ) : (
            <div
              className="flex flex-col space-y-2 mb-2"
              role="group"
              aria-label="Theme selection"
            >
              <TooltipWrapper content="Light Theme">
                <button
                  onClick={() => setTheme('light')}
                  className={cn(
                    'p-2 rounded-lg hover:bg-[var(--gray-a4)] transition-colors',
                    effectiveTheme === 'light' && theme !== 'system'
                      ? 'text-[var(--accent-9)] bg-[var(--accent-a3)]'
                      : 'text-[var(--gray-11)]'
                  )}
                  aria-label="Set light theme"
                >
                  <Sun size={18} aria-hidden="true" />
                </button>
              </TooltipWrapper>
              <TooltipWrapper content="Dark Theme">
                <button
                  onClick={() => setTheme('dark')}
                  className={cn(
                    'p-2 rounded-lg hover:bg-[var(--gray-a4)] transition-colors',
                    effectiveTheme === 'dark' && theme !== 'system'
                      ? 'text-[var(--accent-9)] bg-[var(--accent-a3)]'
                      : 'text-[var(--gray-11)]'
                  )}
                  aria-label="Set dark theme"
                >
                  <Moon size={18} aria-hidden="true" />
                </button>
              </TooltipWrapper>
              <TooltipWrapper content="System Theme">
                <button
                  onClick={() => setTheme('system')}
                  className={cn(
                    'p-2 rounded-lg hover:bg-[var(--gray-a4)] transition-colors',
                    theme === 'system'
                      ? 'text-[var(--accent-9)] bg-[var(--accent-a3)]'
                      : 'text-[var(--gray-11)]'
                  )}
                  aria-label="Set system theme"
                >
                  <Laptop size={18} aria-hidden="true" />
                </button>
              </TooltipWrapper>
            </div>
          )}

          <button
            title="Active Jobs"
            onClick={handleJobsQueueClick}
            className={cn(
              'flex items-center w-full py-2 text-left text-sm hover:bg-[var(--gray-a3)] rounded-md transition-colors',
              isSidebarOpen ? 'px-3' : 'justify-center px-0'
            )}
          >
            <Timer
              size={18}
              className={cn(
                'text-[var(--gray-11)]',
                isSidebarOpen ? 'mr-2' : 'mr-0'
              )}
              aria-hidden="true"
            />
            {isSidebarOpen && (
              <Flex align="center" justify="between" width="100%">
                <span className="text-[var(--gray-12)]">Active Jobs</span>
                {activeJobCount > 0 && (
                  <Badge color="blue" variant="solid" radius="full" size="1">
                    {activeJobCount}
                  </Badge>
                )}
              </Flex>
            )}
          </button>

          <GpuStatusIndicator isSidebarOpen={isSidebarOpen} />

          <button
            title="Shutdown App"
            onClick={handleShutdownAppClick}
            className={cn(
              'flex items-center w-full py-2 text-left text-sm text-[var(--gray-11)] hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-md transition-colors',
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
        className="absolute left-full ml-3 top-1/2 -translate-y-1/2 px-2 py-1 text-xs text-white bg-gray-900 dark:bg-gray-700 rounded-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50 shadow-md"
        role="tooltip"
      >
        {content}
      </div>
    </div>
  );
};
