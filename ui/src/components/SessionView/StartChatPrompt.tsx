// src/components/SessionView/StartChatPrompt.tsx
import React from 'react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { ChatBubbleIcon } from '@radix-ui/react-icons';

interface StartChatPromptProps {
    onStartFirstChat: () => void;
}

export function StartChatPrompt({ onStartFirstChat }: StartChatPromptProps) {
    return (
        <Card className="flex flex-col flex-grow items-center justify-center text-center h-full p-6 bg-gray-50 dark:bg-gray-900 border border-dashed border-gray-300 dark:border-gray-700 rounded-lg">
            <ChatBubbleIcon className="w-12 h-12 text-gray-300 dark:text-gray-600 mb-4" />
            <p className="text-gray-600 dark:text-gray-400 mb-6">
                No chats have been started for this session yet.
            </p>
            <Button
                onClick={onStartFirstChat}
                variant="secondary"
                size="sm"
                icon={ChatBubbleIcon}
            >
                Start New Chat
            </Button>
        </Card>
    );
}
