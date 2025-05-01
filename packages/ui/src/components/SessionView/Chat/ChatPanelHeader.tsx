import React from 'react';
import {
  Flex,
  Text,
  Badge,
  Button,
  Tooltip,
  Box,
  Spinner,
} from '@radix-ui/themes';
import {
  MixerVerticalIcon,
  InfoCircledIcon,
  CheckCircledIcon,
  SymbolIcon,
  LightningBoltIcon,
  ArchiveIcon, // <-- Import ArchiveIcon
} from '@radix-ui/react-icons';
import type { OllamaStatus } from '../../../types';
import { cn } from '../../../utils'; // Import cn

interface ChatPanelHeaderProps {
  ollamaStatus: OllamaStatus | undefined;
  isLoadingStatus: boolean;
  latestPromptTokens: number | null;
  latestCompletionTokens: number | null;
  onOpenLlmModal: () => void; // Function to open the modal
}

export function ChatPanelHeader({
  ollamaStatus,
  isLoadingStatus,
  latestPromptTokens,
  latestCompletionTokens,
  onOpenLlmModal,
}: ChatPanelHeaderProps) {
  const modelName = ollamaStatus?.activeModel ?? 'Unknown Model';
  const isLoaded = ollamaStatus?.loaded ?? false;
  const isActiveModelLoaded =
    isLoaded && ollamaStatus?.modelChecked === modelName;
  // --- Get configured context size ---
  const configuredContextSize = ollamaStatus?.configuredContextSize;
  // --- End ---

  const renderStatusBadge = () => {
    if (isLoadingStatus) {
      return <Spinner size="1" />;
    }
    if (isActiveModelLoaded) {
      return (
        <CheckCircledIcon className="text-green-600" width="14" height="14" />
      );
    }
    return <SymbolIcon className="text-gray-500" width="14" height="14" />;
  };

  const totalTokens = (latestPromptTokens ?? 0) + (latestCompletionTokens ?? 0);

  return (
    <Flex
      align="center"
      justify="between"
      py="2"
      px="3"
      gap="3"
      style={{
        borderBottom: '1px solid var(--gray-a6)',
        backgroundColor: 'var(--color-panel-solid)',
        flexShrink: 0,
      }}
    >
      {/* Left Side: Model Info & Context Size */}
      <Flex align="center" gap="2" style={{ minWidth: 0 }}>
        <Tooltip
          content={`Active Model Status: ${isLoadingStatus ? 'Loading...' : isActiveModelLoaded ? 'Loaded' : 'Not Loaded/Available'}`}
        >
          <Flex align="center" gap="1">
            {renderStatusBadge()}
          </Flex>
        </Tooltip>
        <Text size="1" weight="medium" truncate title={modelName}>
          {modelName}
        </Text>
        {/* --- Display Configured Context Size --- */}
        <Tooltip content={`Configured Context Size (num_ctx)`}>
          <Badge
            variant="soft"
            color={configuredContextSize ? 'blue' : 'gray'}
            size="1"
            className={cn(isLoadingStatus ? 'opacity-50' : '')} // Dim if status is loading
          >
            <LightningBoltIcon
              width="14"
              height="14"
              style={{ marginRight: '2px' }}
            />{' '}
            {/* Keep Lightning Bolt for context size */}
            {isLoadingStatus
              ? '...'
              : configuredContextSize
                ? configuredContextSize.toLocaleString()
                : 'Default'}
          </Badge>
        </Tooltip>
        {/* --- End Context Size --- */}
        {ollamaStatus?.loaded && ollamaStatus.details?.name !== modelName && (
          <Tooltip content={`Loaded in memory: ${ollamaStatus.details?.name}`}>
            <InfoCircledIcon
              className="text-blue-500 flex-shrink-0"
              width="14"
              height="14"
            />
          </Tooltip>
        )}
      </Flex>

      {/* Right Side: Tokens & Manage Button */}
      <Flex align="center" gap="3" flexShrink="0">
        {/* --- Updated Token Badge --- */}
        {(latestPromptTokens !== null || latestCompletionTokens !== null) && (
          <Tooltip
            content={`Last Interaction: ${latestPromptTokens?.toLocaleString() ?? '?'} Input + ${latestCompletionTokens?.toLocaleString() ?? '?'} Output Tokens`}
          >
            <Badge variant="soft" color="gray" highContrast>
              {/* Add ArchiveIcon */}
              <ArchiveIcon
                width="14"
                height="14"
                style={{ marginRight: '4px', opacity: 0.8 }}
              />
              {/* Use toLocaleString for formatting */}
              <Text size="1">{totalTokens.toLocaleString()} Tokens</Text>
            </Badge>
          </Tooltip>
        )}
        {/* --- End Updated Token Badge --- */}
        <Button
          variant="soft"
          size="1"
          onClick={onOpenLlmModal}
          title="Manage LLM"
          aria-label="Manage large language model"
        >
          <MixerVerticalIcon width="14" height="14" />
          <Text size="1" ml="1">
            Manage
          </Text>
        </Button>
      </Flex>
    </Flex>
  );
}
