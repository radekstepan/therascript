// packages/ui/src/components/Layout/TopToolbar.tsx
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { useSetAtom, useAtomValue, useAtom } from 'jotai';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Box,
  Flex,
  TextField,
  IconButton,
  Button as RadixButton,
  Spinner,
  Text,
} from '@radix-ui/themes';
import {
  MagnifyingGlassIcon,
  Cross1Icon,
  ChatBubbleIcon,
  PlusCircledIcon,
  GearIcon,
} from '@radix-ui/react-icons';
import {
  openUploadModalAtom,
  toastMessageAtom,
  isSystemReadyAtom,
} from '../../store';
import { isRunConfigSidebarOpenAtom } from '../../store/ui/runConfigSidebarAtom';
import { createStandaloneChat as createStandaloneChatApi } from '../../api/api';
import type { StandaloneChatListItem } from '../../types';
import { cn } from '../../utils';

export function TopToolbar() {
  const openUploadModal = useSetAtom(openUploadModalAtom);
  const setToast = useSetAtom(toastMessageAtom);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const isSystemReady = useAtomValue(isSystemReadyAtom);
  const [isRunConfigSidebarOpen, setIsRunConfigSidebarOpen] = useAtom(
    isRunConfigSidebarOpenAtom
  );

  const initialSearchQuery = searchParams.get('q') || '';
  const [searchInput, setSearchInput] = useState(initialSearchQuery);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [isFetchingSearch, setIsFetchingSearch] = useState(false);

  useEffect(() => {
    setSearchInput(searchParams.get('q') || '');
  }, [searchParams]);

  const createStandaloneChatMutation = useMutation<
    StandaloneChatListItem,
    Error
  >({
    mutationFn: createStandaloneChatApi,
    onSuccess: (newChat) => {
      setToast('New standalone chat created.');
      queryClient.invalidateQueries({ queryKey: ['standaloneChats'] });
      navigate(`/chats/${newChat.id}`);
    },
    onError: (e) => {
      setToast(`Error creating chat: ${e.message}`);
    },
  });

  const handleSearchInputChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    setSearchInput(event.target.value);
  };

  const handleSearchSubmit = (
    event?:
      | React.FormEvent<HTMLFormElement>
      | React.KeyboardEvent<HTMLInputElement>
  ) => {
    if (event) event.preventDefault();
    const trimmedQuery = searchInput.trim();
    setIsFetchingSearch(true);

    if (trimmedQuery) {
      setSearchParams(
        { q: trimmedQuery },
        { replace: location.pathname === '/' }
      );
      if (location.pathname !== '/') {
        navigate(`/?q=${encodeURIComponent(trimmedQuery)}`);
      }
    } else {
      searchParams.delete('q');
      setSearchParams(searchParams, { replace: location.pathname === '/' });
      if (location.pathname !== '/') {
        navigate(`/`);
      }
    }
    setTimeout(() => setIsFetchingSearch(false), 500);
    requestAnimationFrame(() => searchInputRef.current?.focus());
  };

  const handleClearSearch = useCallback(() => {
    setSearchInput('');
    searchParams.delete('q');
    setSearchParams(searchParams, { replace: location.pathname === '/' });
    if (location.pathname !== '/') {
      navigate(`/`);
    }
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }, [searchParams, setSearchParams, location.pathname, navigate]);

  const handleSearchKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>
  ) => {
    if (event.key === 'Enter') {
      handleSearchSubmit(event);
    } else if (event.key === 'Escape') {
      if (searchInput) {
        handleClearSearch();
      }
    }
  };

  const handleNewStandaloneChat = () => {
    if (!isSystemReady) {
      setToast('System is not ready, please wait.');
      return;
    }
    createStandaloneChatMutation.mutate();
  };

  const handleOpenUploadModal = () => {
    if (!isSystemReady) {
      setToast('System is not ready, please wait.');
      return;
    }
    openUploadModal();
  };

  const handleToggleRunConfigSidebar = () => {
    setIsRunConfigSidebarOpen(!isRunConfigSidebarOpen);
  };

  return (
    <Box
      className={cn(
        'sticky top-0 z-30 flex items-center',
        // Modern glass effect
        'bg-white/70 dark:bg-gray-900/70 backdrop-blur-md',
        'border-b border-gray-200 dark:border-gray-800',
        'px-4 md:px-6 lg:px-8',
        'py-3'
      )}
      style={{ width: '100%' }}
    >
      <Flex justify="between" align="center" gap="4" width="100%">
        {/* Search Form - takes up available space */}
        <form
          onSubmit={handleSearchSubmit}
          style={{ flexGrow: 1, maxWidth: '600px' }}
        >
          <TextField.Root
            ref={searchInputRef}
            size="2"
            placeholder="Search all messages and transcripts..."
            value={searchInput}
            onChange={handleSearchInputChange}
            onKeyDown={handleSearchKeyDown}
            disabled={
              isFetchingSearch || createStandaloneChatMutation.isPending
            }
            name="q"
            variant="surface"
            radius="full" // More modern pill shape
            className="bg-gray-100 dark:bg-gray-800 border-transparent focus-within:border-[var(--accent-8)] focus-within:ring-1 focus-within:ring-[var(--accent-8)] shadow-sm"
          >
            <TextField.Slot>
              <MagnifyingGlassIcon
                height="16"
                width="16"
                className="text-gray-500"
              />
            </TextField.Slot>
            {isFetchingSearch && (
              <TextField.Slot>
                <Spinner size="1" />
              </TextField.Slot>
            )}
            {searchInput && !isFetchingSearch && (
              <TextField.Slot pr="2">
                <IconButton
                  size="1"
                  variant="ghost"
                  color="gray"
                  onClick={handleClearSearch}
                  aria-label="Clear search"
                  title="Clear search (Esc)"
                  type="button"
                  className="rounded-full hover:bg-gray-200 dark:hover:bg-gray-700"
                >
                  <Cross1Icon />
                </IconButton>
              </TextField.Slot>
            )}
          </TextField.Root>
        </form>

        {/* Action Buttons - aligned to the right */}
        <Flex gap="3" align="center" flexShrink="0">
          <IconButton
            size="2"
            variant="ghost"
            color="gray"
            onClick={handleToggleRunConfigSidebar}
            title={
              isRunConfigSidebarOpen
                ? 'Close Configuration'
                : 'Open Configuration'
            }
            className="border border-gray-200 dark:border-gray-700"
          >
            <GearIcon width="16" height="16" />
          </IconButton>
          <RadixButton
            variant="surface"
            size="2"
            color="gray"
            className="hidden sm:flex shadow-sm border border-gray-200 dark:border-gray-700 transition-colors"
            style={{
              backgroundColor: 'var(--gray-a4)',
            }}
            onClick={handleNewStandaloneChat}
            disabled={createStandaloneChatMutation.isPending || !isSystemReady}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--gray-a5)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--gray-a4)';
            }}
          >
            <ChatBubbleIcon width="16" height="16" />
            <Text ml="2">New Chat</Text>
          </RadixButton>
          <RadixButton
            variant="solid"
            size="2"
            onClick={handleOpenUploadModal}
            disabled={!isSystemReady}
            className="shadow-md transition-all"
            onMouseEnter={(e) => {
              e.currentTarget.style.filter = 'brightness(1.1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.filter = 'brightness(1)';
            }}
          >
            <PlusCircledIcon width="16" height="16" />
            <Text ml="2">New Session</Text>
          </RadixButton>
        </Flex>
      </Flex>
    </Box>
  );
}
