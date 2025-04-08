import React, { useRef, useEffect } from 'react';
  import { useAtomValue, useSetAtom } from 'jotai';
  import { useParams, useNavigate } from 'react-router-dom';
  import { ChatHeader, ChatInput, ChatMessages } from './'; // Corrected import order/presence
  import {
      activeSessionAtom,
      startNewChatAtom,
      chatErrorAtom,
      activeChatIdAtom,
      currentChatMessagesAtom, // Import message atom
      isChattingAtom // Import chatting status atom
    } from '../../store';
  import { ReloadIcon } from '@radix-ui/react-icons';
  import { cn } from '../../utils'; // Import cn

  export function ChatInterface() {
        const { chatId } = useParams<{ chatId?: string }>(); // Keep chatId param if needed elsewhere, but activeChatIdAtom is primary
        const navigate = useNavigate();
        const session = useAtomValue(activeSessionAtom);
        const startNewChatAction = useSetAtom(startNewChatAtom);
        const setChatError = useSetAtom(chatErrorAtom);
        const activeChatId = useAtomValue(activeChatIdAtom);
        const chatScrollRef = useRef<HTMLDivElement | null>(null);

        // Consume atoms needed for scrolling effect
        const chatMessages = useAtomValue(currentChatMessagesAtom);
        const isChatting = useAtomValue(isChattingAtom);
       const handleNewChatClick = async () => {
          const currentSessionId = session?.id;
          if (currentSessionId) {
              const result = await startNewChatAction({ sessionId: currentSessionId });
              if (result.success) {
                  navigate(`/sessions/${currentSessionId}/chats/${result.newChatId}`);
              } else {
                   setChatError(result.error);
              }
          } else {
              setChatError("Cannot start new chat: Session context is missing.");
          }
      };

      // Effect to scroll to bottom when messages change or AI starts/stops chatting
      useEffect(() => {
          if (chatScrollRef.current) {
              // Use smooth scrolling for better UX
              requestAnimationFrame(() => { // Ensure DOM update is complete
                 if (chatScrollRef.current) {
                    chatScrollRef.current.scrollTo({
                        top: chatScrollRef.current.scrollHeight,
                        behavior: 'smooth'
                    });
                 }
              });
          }
      }, [chatMessages, isChatting]); // Dependency: Run when messages or chatting status changes

      if (activeChatId === null) {
        return (
          <div className="flex flex-grow p-4 justify-center items-center">
            <ReloadIcon className="h-6 w-6 animate-spin text-gray-400 dark:text-gray-500" />
            <p className="ml-2 text-gray-500 dark:text-gray-400">Loading chat...</p>
          </div>
        );
      }

      return (
        <div className="flex flex-col flex-grow min-h-0 h-full">
          <ChatHeader activeChatId={activeChatId} onNewChatClick={handleNewChatClick} />
          <hr className="flex-shrink-0 my-0 border-gray-200 dark:border-gray-700" />
          {/* Chat Content - Scrollable Messages */}
          <div ref={chatScrollRef} className="flex-grow min-h-0 overflow-y-auto p-4"> {/* Assign ref here */}
            <ChatMessages activeChatId={activeChatId} /> {/* Remove chatScrollRef prop */}
          </div>
          {/* Fixed Input at Bottom */}
          <div className="sticky bottom-0 z-10 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 p-4">
            <ChatInput />
          </div>
        </div>
      );
  }
  