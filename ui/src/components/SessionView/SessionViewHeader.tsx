import React from 'react';
import { Flex, Box, Button, Text } from '@radix-ui/themes';
import { ArrowLeftIcon } from '@radix-ui/react-icons';
import { UserThemeDropdown } from '../UserThemeDropdown';

interface SessionViewHeaderProps {
    displayTitle: string;
    onNavigateBack: () => void;
}

export function SessionViewHeader({ displayTitle, onNavigateBack }: SessionViewHeaderProps) {
    return (
        <Box
            px={{ initial: '5', md: '7', lg: '8' }}
            py="3"
            flexShrink="0"
            style={{ backgroundColor: 'var(--color-panel-solid)', borderBottom: '1px solid var(--gray-a6)' }}
        >
            <Flex justify="between" align="center">
                <Flex align="center" gap="2" style={{ minWidth: 0 }}>
                    <Button onClick={onNavigateBack} variant="ghost" color="gray" size="2" style={{ flexShrink: 0 }}>
                        <ArrowLeftIcon /> Sessions
                    </Button>
                    <Text color="gray" size="2" style={{ flexShrink: 0 }}> / </Text>
                    <Text size="2" weight="medium" truncate title={displayTitle} style={{ flexShrink: 1 }}>
                        {displayTitle}
                    </Text>
                </Flex>
                <UserThemeDropdown />
            </Flex>
        </Box>
    );
}
