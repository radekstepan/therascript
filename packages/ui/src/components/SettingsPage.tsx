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
  Grid,
  Tooltip,
  Badge,
} from '@radix-ui/themes';
import { renderMarkdownAtom } from '../store/ui/renderMarkdownAtom';
import { LlmManagementModal } from './SessionView/Modals/LlmManagementModal';
import {
  MixerVerticalIcon,
  LayoutIcon as RadixLayoutIcon,
  CheckIcon,
  ColorWheelIcon, // <-- REPLACED PaintBrushIcon with ColorWheelIcon
} from '@radix-ui/react-icons';
import {
  accentColorAtom,
  RADIX_ACCENT_COLORS,
  type RadixAccentColor,
  type AccentColorValue, // <-- Import AccentColorValue for explicit typing
} from '../store'; // <-- CORRECTED PATH

export function SettingsPage() {
  const [renderMarkdown, setRenderMarkdown] = useAtom(renderMarkdownAtom);
  const [isLlmModalOpen, setIsLlmModalOpen] = useState(false);
  const [currentAccent, setCurrentAccent] = useAtom(accentColorAtom);

  const handleMarkdownToggle = () => {
    setRenderMarkdown(!renderMarkdown);
  };

  const handleAccentColorSelect = (color: RadixAccentColor) => {
    setCurrentAccent(color as AccentColorValue); // Cast to AccentColorValue
  };

  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  return (
    <>
      <Container size="3" px="4" py="6">
        <Heading
          as="h1"
          size="7"
          mb="6"
          className="text-gray-900 dark:text-gray-100"
        >
          Application Settings
        </Heading>

        <Card>
          <Box p="4">
            <Heading
              as="h2"
              size="5"
              mb="4"
              className="text-gray-800 dark:text-gray-200"
            >
              Appearance
            </Heading>
            <Flex align="center" justify="between" mb="4">
              <Flex align="center" gap="2">
                <RadixLayoutIcon
                  width="20"
                  height="20"
                  className="text-gray-600 dark:text-gray-400"
                />
                <Text size="3" className="text-gray-700 dark:text-gray-300">
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

            {/* Accent Color Selector Section */}
            <Separator my="5" size="4" />
            <Flex align="center" gap="2" mb="3">
              <ColorWheelIcon // <-- USING ColorWheelIcon
                width="20"
                height="20"
                className="text-gray-600 dark:text-gray-400"
              />
              <Text size="3" className="text-gray-700 dark:text-gray-300">
                Accent Color
              </Text>
            </Flex>
            <Grid columns={{ initial: '4', xs: '5', sm: '6', md: '8' }} gap="2">
              {RADIX_ACCENT_COLORS.map(
                (
                  color: RadixAccentColor // <-- EXPLICITLY TYPE color
                ) => (
                  <Tooltip key={color} content={capitalize(color)}>
                    <Button
                      variant={currentAccent === color ? 'solid' : 'outline'}
                      color={
                        color as React.ComponentProps<typeof Button>['color'] // Cast for Radix Button color prop
                      }
                      onClick={() => handleAccentColorSelect(color)}
                      style={{
                        width: '100%',
                        height: '36px',
                        padding: '0',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color:
                          currentAccent === color &&
                          [
                            'ruby',
                            'crimson',
                            'plum',
                            'purple',
                            'violet',
                            'iris',
                            'indigo',
                            'blue',
                            'sky',
                            'cyan',
                            'teal',
                            'jade',
                            'green',
                            'grass',
                            'brown',
                            'gray',
                          ].includes(color)
                            ? 'white'
                            : 'var(--gray-12)',
                      }}
                      title={`Set accent to ${capitalize(color)}`}
                      aria-pressed={currentAccent === color}
                    >
                      {currentAccent === color ? (
                        <CheckIcon width="18" height="18" />
                      ) : (
                        <Box
                          style={{
                            width: '14px',
                            height: '14px',
                            borderRadius: '50%',
                            backgroundColor: `var(--${color}-9)`,
                          }}
                        />
                      )}
                    </Button>
                  </Tooltip>
                )
              )}
            </Grid>
            <Text size="2" color="gray" mt="3">
              Select an accent color for the application theme. Changes will
              apply immediately. Your preference is saved locally.
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
              className="text-gray-800 dark:text-gray-200"
            >
              Language Model Management
            </Heading>
            <Flex align="center" justify="between">
              <Flex align="center" gap="2">
                <MixerVerticalIcon
                  width="20"
                  height="20"
                  className="text-gray-600 dark:text-gray-400"
                />
                <Text size="3" className="text-gray-700 dark:text-gray-300">
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

      <LlmManagementModal
        isOpen={isLlmModalOpen}
        onOpenChange={setIsLlmModalOpen}
      />
    </>
  );
}
