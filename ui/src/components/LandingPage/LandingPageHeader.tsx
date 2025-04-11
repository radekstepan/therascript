import React from 'react';
import { Box, Flex } from '@radix-ui/themes';
import { UserThemeDropdown } from '../UserThemeDropdown';

export function LandingPageHeader() {
    return (
        <Box
            py="2"
            px={{ initial: '4', md: '6', lg: '8' }}
            flexShrink="0"
            style={{ backgroundColor: 'var(--color-panel-solid)', borderBottom: '1px solid var(--gray-a6)' }}
        >
            <Flex justify="end">
                <UserThemeDropdown />
            </Flex>
        </Box>
    );
}
