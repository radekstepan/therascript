// packages/ui/src/components/SettingsPage.tsx
import React, { useState } from 'react';
import { useAtom } from 'jotai';
import {
  Box,
  Heading,
  Text,
  Flex,
  Switch,
  Button,
  Card,
  Separator,
  Container,
} from '@radix-ui/themes';
import { renderMarkdownAtom } from '../store/ui/renderMarkdownAtom';
import { LlmManagementModal } from './SessionView/Modals/LlmManagementModal';
// Correct import for MixerVerticalIcon and add LayoutIcon (or similar)
import {
  MixerVerticalIcon,
  LayoutIcon as RadixLayoutIcon,
} from '@radix-ui/react-icons'; // Using Radix's LayoutIcon for consistency

export function SettingsPage() {
  const [renderMarkdown, setRenderMarkdown] = useAtom(renderMarkdownAtom);
  const [isLlmModalOpen, setIsLlmModalOpen] = useState(false);

  const handleMarkdownToggle = () => {
    setRenderMarkdown(!renderMarkdown);
  };

  return (
    <>
      <Container size="3" px="4" py="6">
        <Heading
          as="h1"
          size="7"
          mb="6"
          className="text-gray-900 dark:text-gray-100" // MODIFIED: slate to gray
        >
          Application Settings
        </Heading>

        <Card>
          <Box p="4">
            <Heading
              as="h2"
              size="5"
              mb="4"
              className="text-gray-800 dark:text-gray-200" // MODIFIED: slate to gray
            >
              Appearance
            </Heading>
            <Flex align="center" justify="between" mb="4">
              <Flex align="center" gap="2">
                <RadixLayoutIcon // Using Radix icon
                  width="20"
                  height="20"
                  className="text-gray-600 dark:text-gray-400" // MODIFIED: slate to gray
                />
                <Text size="3" className="text-gray-700 dark:text-gray-300">
                  {' '}
                  {/* MODIFIED: slate to gray */}
                  Render AI messages as Markdown
                </Text>
              </Flex>
              <Switch
                checked={renderMarkdown}
                onCheckedChange={handleMarkdownToggle}
                aria-label="Toggle Markdown rendering for AI responses"
              />
            </Flex>
            <Text size="2" color="gray">
              When enabled, AI responses in chat interfaces will be formatted
              using Markdown. Disable for plain text.
            </Text>
          </Box>
        </Card>

        <Separator my="6" size="4" />

        <Card>
          <Box p="4">
            <Heading
              as="h2"
              size="5"
              mb="4"
              className="text-gray-800 dark:text-gray-200" // MODIFIED: slate to gray
            >
              Language Model Management
            </Heading>
            <Flex align="center" justify="between">
              <Flex align="center" gap="2">
                <MixerVerticalIcon // Corrected: from @radix-ui/react-icons
                  width="20"
                  height="20"
                  className="text-gray-600 dark:text-gray-400" // MODIFIED: slate to gray
                />
                <Text size="3" className="text-gray-700 dark:text-gray-300">
                  {' '}
                  {/* MODIFIED: slate to gray */}
                  Manage AI Models
                </Text>
              </Flex>
              <Button variant="soft" onClick={() => setIsLlmModalOpen(true)}>
                Open Model Manager
              </Button>
            </Flex>
            <Text size="2" color="gray" mt="2">
              View available models, download new ones, or set the active model
              for analysis.
            </Text>
          </Box>
        </Card>
      </Container>

      {/* LLM Management Modal */}
      <LlmManagementModal
        isOpen={isLlmModalOpen}
        onOpenChange={setIsLlmModalOpen}
      />
    </>
  );
}
