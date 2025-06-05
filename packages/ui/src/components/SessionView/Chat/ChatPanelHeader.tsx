// packages/ui/src/components/SessionView/Chat/ChatPanelHeader.tsx
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
  MixerVerticalIcon, // Kept for familiarity, but consider CogIcon or similar if "Configure"
  InfoCircledIcon,
  CheckCircledIcon,
  SymbolIcon,
  LightningBoltIcon,
  ArchiveIcon,
} from '@radix-ui/react-icons';
import type { OllamaStatus } from '../../../types';
import { cn } from '../../../utils';

interface ChatPanelHeaderProps {
  ollamaStatus: OllamaStatus | undefined;
  isLoadingStatus: boolean;
  latestPromptTokens: number | null;
  latestCompletionTokens: number | null;
  onOpenLlmModal: () => void; // This prop will now trigger SelectActiveModelModal
}

export function ChatPanelHeader({
  ollamaStatus,
  isLoadingStatus,
  latestPromptTokens,
  latestCompletionTokens,
  onOpenLlmModal, // Renamed for clarity if desired, but functionally it just opens a modal
}: ChatPanelHeaderProps) {
  const modelName = ollamaStatus?.activeModel ?? 'No Model Selected'; // Updated default
  const isLoaded = ollamaStatus?.loaded ?? false;
  // Ensure modelChecked is for the activeModel to confirm *it* is loaded
  const isActiveModelLoaded =
    isLoaded && ollamaStatus?.modelChecked === ollamaStatus?.activeModel;
  const configuredContextSize = ollamaStatus?.configuredContextSize;

  const renderStatusBadge = () => {
    if (isLoadingStatus) {
      return <Spinner size="1" />;
    }
    // Check if an active model is set first
    if (!ollamaStatus?.activeModel) {
      return <SymbolIcon className="text-yellow-500" width="14" height="14" />; // Icon for no model selected
    }
    if (isActiveModelLoaded) {
      return (
        <CheckCircledIcon className="text-green-600" width="14" height="14" />
      );
    }
    // Model selected but not loaded or status unknown for it
    return <SymbolIcon className="text-gray-500" width="14" height="14" />;
  };

  const totalTokens = (latestPromptTokens ?? 0) + (latestCompletionTokens ?? 0);

  let statusTooltipContent = 'Loading status...';
  if (!isLoadingStatus) {
    if (!ollamaStatus?.activeModel) {
      statusTooltipContent =
        'No AI model selected. Click "Configure Model" to choose one.';
    } else if (isActiveModelLoaded) {
      statusTooltipContent = `Active Model: ${modelName} (Loaded)`;
    } else {
      statusTooltipContent = `Active Model: ${modelName} (Not loaded or unavailable)`;
    }
  }

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
        <Tooltip content={statusTooltipContent}>
          <Flex align="center" gap="1">
            {renderStatusBadge()}
          </Flex>
        </Tooltip>
        <Text size="1" weight="medium" truncate title={modelName}>
          {modelName}
        </Text>
        {ollamaStatus?.activeModel && ( // Only show context if a model is active
          <Tooltip content={`Configured Context Size (num_ctx)`}>
            <Badge
              variant="soft"
              color={configuredContextSize ? 'blue' : 'gray'}
              size="1"
              className={cn(isLoadingStatus ? 'opacity-50' : '')}
            >
              <LightningBoltIcon
                width="14"
                height="14"
                style={{ marginRight: '2px' }}
              />
              {isLoadingStatus
                ? '...'
                : configuredContextSize
                  ? configuredContextSize.toLocaleString()
                  : 'Default'}
            </Badge>
          </Tooltip>
        )}
        {/* Info icon if a different model is loaded than active (less relevant with new flow but kept for now) */}
        {isLoaded &&
          ollamaStatus?.details?.name &&
          ollamaStatus.details.name !== ollamaStatus.activeModel && (
            <Tooltip
              content={`A different model (${ollamaStatus.details.name}) is currently in memory.`}
            >
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
        {(latestPromptTokens !== null || latestCompletionTokens !== null) && (
          <Tooltip
            content={`Last Interaction: ${latestPromptTokens?.toLocaleString() ?? '?'} Input + ${latestCompletionTokens?.toLocaleString() ?? '?'} Output Tokens`}
          >
            <Badge variant="soft" color="gray" highContrast>
              <ArchiveIcon
                width="14"
                height="14"
                style={{ marginRight: '4px', opacity: 0.8 }}
              />
              <Text size="1">{totalTokens.toLocaleString()} Tokens</Text>
            </Badge>
          </Tooltip>
        )}
        <Button
          variant="soft"
          size="1"
          onClick={onOpenLlmModal} // This will now open SelectActiveModelModal
          title="Configure AI Model"
          aria-label="Configure AI model"
        >
          <MixerVerticalIcon width="14" height="14" />
          {/* Updated Button Text */}
          <Text size="1" ml="1">
            Configure Model
          </Text>
        </Button>
      </Flex>
    </Flex>
  );
}
