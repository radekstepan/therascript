// packages/ui/src/components/SessionView/Chat/ChatPanelHeader.tsx
import React from 'react';
import {
  Flex,
  Text,
  Badge,
  Spinner,
  Tooltip,
  Button,
  Box,
} from '@radix-ui/themes';
import {
  CheckCircledIcon,
  SymbolIcon,
  MixerVerticalIcon,
  LightningBoltIcon,
  ArchiveIcon,
  ExclamationTriangleIcon,
} from '@radix-ui/react-icons';
import type { Session, OllamaStatus } from '../../../types';
import { cn } from '../../../utils';
import prettyBytes from 'pretty-bytes';

interface ChatPanelHeaderProps {
  session: Session | null;
  activeChatId: number | null;
  ollamaStatus: OllamaStatus | undefined;
  isLoadingOllamaStatus: boolean;
  onOpenLlmModal: () => void;
  latestPromptTokens?: number | null;
  latestCompletionTokens?: number | null;
  transcriptTokenCount?: number | null;
  activeModelDefaultContextSize?: number | null;
}

export function ChatPanelHeader({
  session,
  activeChatId,
  ollamaStatus,
  isLoadingOllamaStatus,
  onOpenLlmModal,
  latestPromptTokens,
  latestCompletionTokens,
  transcriptTokenCount,
  activeModelDefaultContextSize,
}: ChatPanelHeaderProps) {
  const modelName = ollamaStatus?.activeModel ?? 'No Model Selected';
  const isLoaded = ollamaStatus?.loaded ?? false;
  const isActiveModelLoaded =
    isLoaded && ollamaStatus?.modelChecked === ollamaStatus?.activeModel;
  const configuredContextSize = ollamaStatus?.configuredContextSize;

  const totalTokens = (latestPromptTokens ?? 0) + (latestCompletionTokens ?? 0);

  // --- CONTEXT USAGE WARNING LOGIC ---
  const effectiveModelContextSize =
    configuredContextSize || activeModelDefaultContextSize;

  let contextUsagePercentage: number | null = null;
  if (transcriptTokenCount && effectiveModelContextSize) {
    contextUsagePercentage =
      (transcriptTokenCount / effectiveModelContextSize) * 100;
  }

  const showContextWarning =
    contextUsagePercentage !== null && contextUsagePercentage > 75;
  // --- END WARNING LOGIC ---

  let statusTooltipContent = 'Loading status...';
  if (!isLoadingOllamaStatus) {
    if (!ollamaStatus?.activeModel) {
      statusTooltipContent =
        'No AI model selected. Click "Configure Model" to choose one.';
    } else if (isActiveModelLoaded) {
      statusTooltipContent = `Active Model: ${modelName} (Loaded)`;
    } else {
      statusTooltipContent = `Active Model: ${modelName} (Not loaded or unavailable)`;
    }
  }

  const renderStatusBadge = () => {
    if (isLoadingOllamaStatus) return <Spinner size="1" />;
    if (!ollamaStatus?.activeModel)
      return <SymbolIcon className="text-yellow-500" width="14" height="14" />;
    if (isActiveModelLoaded)
      return (
        <CheckCircledIcon className="text-green-600" width="14" height="14" />
      );
    return <SymbolIcon className="text-gray-500" width="14" height="14" />;
  };

  return (
    <Box
      px="3"
      py="2"
      style={{
        borderBottom: '1px solid var(--gray-a6)',
        backgroundColor: 'var(--color-panel-solid)',
      }}
    >
      <Flex justify="between" align="center" gap="3">
        {/* Left Side: Status and Context Info */}
        <Flex align="center" gap="2" style={{ minWidth: 0 }}>
          <Tooltip content={statusTooltipContent}>
            <Flex align="center" gap="1">
              {renderStatusBadge()}
            </Flex>
          </Tooltip>

          {ollamaStatus?.activeModel && (
            <Tooltip
              content={
                `Configured Context: ${configuredContextSize ? configuredContextSize.toLocaleString() : 'Default'}` +
                (activeModelDefaultContextSize
                  ? ` (Model Max: ${activeModelDefaultContextSize.toLocaleString()})`
                  : '')
              }
            >
              <Badge
                variant="soft"
                color={configuredContextSize ? 'blue' : 'gray'}
                size="1"
                className={cn(isLoadingOllamaStatus ? 'opacity-50' : '')}
              >
                <LightningBoltIcon
                  width="14"
                  height="14"
                  style={{ marginRight: '2px' }}
                />
                {isLoadingOllamaStatus
                  ? '...'
                  : configuredContextSize
                    ? prettyBytes(configuredContextSize).replace(' ', '')
                    : 'Default'}
              </Badge>
            </Tooltip>
          )}

          {/* --- NEW WARNING ICON --- */}
          {showContextWarning && (
            <Tooltip
              content={`Transcript uses ~${Math.round(contextUsagePercentage!)}% of the model's context. Long conversations may lose earlier parts of the transcript context.`}
            >
              <ExclamationTriangleIcon
                className="text-[--amber-9]"
                width="14"
                height="14"
              />
            </Tooltip>
          )}

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
        </Flex>

        {/* Right Side: Configure Button */}
        <Button
          variant="soft"
          size="1"
          onClick={onOpenLlmModal}
          title="Configure AI Model"
          disabled={isLoadingOllamaStatus}
        >
          <MixerVerticalIcon width="14" height="14" />
        </Button>
      </Flex>
    </Box>
  );
}
