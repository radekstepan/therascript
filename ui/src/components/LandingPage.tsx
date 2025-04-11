// src/components/LandingPage.tsx
import React from 'react';
import { Box } from '@radix-ui/themes';
import { LandingPageHeader } from './LandingPage/LandingPageHeader';
import { LandingPageContent } from './LandingPage/LandingPageContent';
import { useLandingPage } from '../hooks/useLandingPage'; // Import the hook

export function LandingPage() {
    // Use the custom hook to get state and handlers
    const {
        isLoading,
        error,
        sortedSessions,
        currentSortCriteria,
        currentSortDirection,
        handleSort,
        openUploadModal,
    } = useLandingPage();

    return (
        <Box className="w-full flex-grow flex flex-col h-screen overflow-hidden"> {/* Ensure full height */}
            <LandingPageHeader />
            <LandingPageContent
                isLoading={isLoading}
                error={error}
                sortedSessions={sortedSessions}
                currentSortCriteria={currentSortCriteria}
                currentSortDirection={currentSortDirection}
                handleSort={handleSort}
                openUploadModal={openUploadModal}
            />
        </Box>
    );
}
