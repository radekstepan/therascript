// src/components/SessionView.tsx
import React from 'react';
import { Flex, Box } from '@radix-ui/themes';
import { useSessionView } from '../hooks/useSessionView';
import { SessionSidebar } from './SessionView/SessionSidebar';
import { SessionContent } from './SessionView/SessionContent'; // Correct import path
import { EditDetailsModal } from './SessionView/EditDetailsModal';
import { SessionViewHeader } from './SessionView/SessionViewHeader';
import { SessionLoadingError } from './SessionView/SessionLoadingError';
import { SessionResizer } from './SessionView/SessionResizer';

export function SessionView() {
    const {
        isLoadingSession, isLoadingChat, activeSession, activeChatId,
        isEditingMetadata, sidebarWidth, currentError, displayTitle, hasChats, sidebarRef,
        handleNavigateBack, handleOpenEditMetadataModal, handleCloseEditMetadataModal,
        handleSaveMetadata, handleSaveTranscriptParagraph, handleStartFirstChat, handleMouseDown,
        setActiveChatId, // Keep if needed by children like PastChatsList
    } = useSessionView();

    if (isLoadingSession || (!activeSession && !isLoadingSession)) {
        return (<SessionLoadingError isLoading={isLoadingSession} error={currentError} onNavigateBack={handleNavigateBack} />);
    }
     if (!activeSession) {
         return (<SessionLoadingError isLoading={false} error={currentError || "Session not found or failed to load."} onNavigateBack={handleNavigateBack} />);
     }

    return (
        <Flex flexGrow="1" style={{ height: '100vh', overflow: 'hidden' }}>
            <Box ref={sidebarRef} className="relative flex-shrink-0 hidden lg:flex flex-col" style={{ width: `${sidebarWidth}px`, backgroundColor: 'var(--color-panel-solid)' }}>
                <SessionSidebar/>
            </Box>
            <SessionResizer onMouseDown={handleMouseDown} />
            <Flex direction="column" flexGrow="1" style={{ minWidth: 0, height: '100vh', overflow: 'hidden' }}>
                <SessionViewHeader displayTitle={displayTitle} onNavigateBack={handleNavigateBack} />
                <Box flexGrow="1" style={{ minHeight: 0, overflow: 'hidden' }}>
                    {/* Correct Props Passed to SessionContent */}
                    <SessionContent
                        session={activeSession}
                        onEditDetailsClick={handleOpenEditMetadataModal}
                        onSaveTranscriptParagraph={handleSaveTranscriptParagraph}
                        activeChatId={activeChatId}
                        hasChats={hasChats}
                        onStartFirstChat={handleStartFirstChat}
                        isLoadingChat={isLoadingChat}
                        // Props removed: editTranscriptContent, onTranscriptContentChange
                    />
                </Box>
            </Flex>
            <EditDetailsModal isOpen={isEditingMetadata} onOpenChange={handleCloseEditMetadataModal} session={activeSession} onSaveSuccess={handleSaveMetadata} />
        </Flex>
    );
}
