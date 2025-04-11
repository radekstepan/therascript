import React from 'react';
import { Flex, Text, Spinner, Button } from '@radix-ui/themes';
import { ArrowLeftIcon } from '@radix-ui/react-icons';

interface SessionLoadingErrorProps {
    isLoading: boolean;
    error: string | null;
    onNavigateBack: () => void;
}

export function SessionLoadingError({ isLoading, error, onNavigateBack }: SessionLoadingErrorProps) {
    if (isLoading) {
        return (
            <Flex justify="center" align="center" style={{ height: '100vh', backgroundColor: 'var(--color-panel-solid)' }}>
                <Spinner size="3" />
                <Text ml="2" color="gray">Loading session data...</Text>
            </Flex>
        );
    }

    if (error) {
        return (
             <Flex direction="column" justify="center" align="center" style={{ height: '100vh', backgroundColor: 'var(--color-panel-solid)' }}>
                <Text color="red" mb="4">{error || "Session data could not be loaded."}</Text>
                <Button onClick={onNavigateBack} variant="soft" color="gray">
                    <ArrowLeftIcon /> Go back to Sessions
                </Button>
            </Flex>
        );
    }

    return null; // Render nothing if not loading and no error
}
