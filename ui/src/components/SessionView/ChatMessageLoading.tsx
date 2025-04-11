import React from 'react';
import { Flex, Spinner, Text } from '@radix-ui/themes';

export function ChatMessagesLoading() {
    return (
        <Flex align="center" justify="center" py="4">
            <Spinner size="2" />
            <Text ml="2" color="gray" size="2">Loading messages...</Text>
        </Flex>
    );
}
