// packages/ui/src/components/TemplatesPage.tsx
import React from 'react';
import { Container, Heading, Text, Card, Box } from '@radix-ui/themes';

export function TemplatesPage() {
  return (
    <Container size="3" px="4" py="6">
      <Heading
        as="h1"
        size="7"
        mb="6"
        className="text-slate-900 dark:text-slate-100"
      >
        Starred Templates
      </Heading>
      <Card>
        <Box p="4">
          <Text className="text-slate-700 dark:text-slate-300">
            This page will display your starred messages/templates.
            Functionality to manage them here (view, edit, delete) can be added.
          </Text>
        </Box>
      </Card>
    </Container>
  );
}
