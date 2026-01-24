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
  Progress,
} from '@radix-ui/themes';
import {
  CheckCircledIcon,
  SymbolIcon,
  MixerVerticalIcon,
  LightningBoltIcon,
  ArchiveIcon,
  ExclamationTriangleIcon,
} from '@radix-ui/react-icons';
import type {
  Session,
  OllamaStatus,
  UIContextUsageResponse,
} from '../../../types';
import { cn } from '../../../utils';
import prettyBytes from 'pretty-bytes';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchSessionContextUsage } from '../../../api/chat';

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

  // --- CALCULATE VRAM USAGE STRING ---
  let vramUsageString = '';
  if (isActiveModelLoaded && ollamaStatus?.details) {
    const sizeVram = ollamaStatus.details.size_vram || 0;
    vramUsageString = ` | VRAM: ${prettyBytes(sizeVram)}`;
    const totalSize = ollamaStatus.details.size;
    if (totalSize > 0) {
      const pct = Math.round((sizeVram / totalSize) * 100);
      if (pct < 100) {
        vramUsageString += ` (${pct}% GPU)`;
      } else {
        vramUsageString += ` (100% GPU)`;
      }
    }
  }
  // --- END VRAM USAGE STRING ---

  // --- FETCH CONTEXT USAGE (session chats) ---
  const sessionId = session?.id ?? null;
  const { data: contextUsage, isLoading: isLoadingUsage } = useQuery<
    UIContextUsageResponse | undefined,
    Error
  >({
    queryKey: ['contextUsage', 'session', sessionId, activeChatId],
    queryFn: () => {
      if (!sessionId || !activeChatId) return Promise.resolve(undefined);
      return fetchSessionContextUsage(sessionId, activeChatId);
    },
    enabled: !!sessionId && !!activeChatId,
    staleTime: 15 * 1000,
    refetchOnWindowFocus: true,
  });

  // --- CONTEXT USAGE WARNING LOGIC ---
  const effectiveModelContextSize =
    contextUsage?.model.effectiveContextSize ||
    configuredContextSize ||
    activeModelDefaultContextSize;

  let contextUsagePercentage: number | null = null;
  if (
    contextUsage?.totals.percentUsed !== null &&
    contextUsage?.totals.percentUsed !== undefined
  ) {
    contextUsagePercentage = Math.round(
      (contextUsage.totals.percentUsed || 0) * 100
    );
  } else if (transcriptTokenCount && effectiveModelContextSize) {
    // fallback (rough)
    contextUsagePercentage = Math.round(
      (transcriptTokenCount / effectiveModelContextSize) * 100
    );
  }

  // Fallback: compute prompt tokens locally if percentUsed is null
  const fallbackPromptTokens: number | null = (() => {
    if (!contextUsage) return null;
    const parts: Array<number> = [];
    if (typeof contextUsage.breakdown.systemTokens === 'number')
      parts.push(contextUsage.breakdown.systemTokens);
    if (typeof contextUsage.breakdown.transcriptTokens === 'number')
      parts.push(contextUsage.breakdown.transcriptTokens);
    if (typeof contextUsage.breakdown.chatHistoryTokens === 'number')
      parts.push(contextUsage.breakdown.chatHistoryTokens);
    if (typeof contextUsage.breakdown.inputDraftTokens === 'number')
      parts.push(contextUsage.breakdown.inputDraftTokens);
    if (parts.length === 0) return null;
    return parts.reduce((a, b) => a + b, 0);
  })();

  if (
    contextUsagePercentage === null &&
    fallbackPromptTokens !== null &&
    typeof effectiveModelContextSize === 'number' &&
    effectiveModelContextSize > 0
  ) {
    contextUsagePercentage = Math.min(
      100,
      Math.round((fallbackPromptTokens / effectiveModelContextSize) * 100)
    );
  }

  // Warn when over thresholds or when projected (prompt + reserved) exceeds effective context
  const showContextWarning = (() => {
    const overPct =
      contextUsagePercentage !== null && contextUsagePercentage > 75;
    if (!contextUsage) return overPct;
    const prompt =
      contextUsage.totals.promptTokens ?? fallbackPromptTokens ?? null;
    const reserved = contextUsage.reserved.outputTokens;
    const eff =
      typeof effectiveModelContextSize === 'number'
        ? effectiveModelContextSize
        : null;
    const projected = prompt != null && eff != null ? prompt + reserved : null;
    const willOverflow =
      projected != null && eff != null ? projected > eff : false;
    return overPct || willOverflow;
  })();

  // Clamp progress value to [0, 100] and allow null for indeterminate
  const progressValue: number | null = (() => {
    if (
      typeof contextUsagePercentage !== 'number' ||
      !Number.isFinite(contextUsagePercentage)
    )
      return null;
    return Math.max(0, Math.min(100, contextUsagePercentage));
  })();
  // --- END WARNING LOGIC ---

  let statusTooltipContent = 'Loading status...';
  if (!isLoadingOllamaStatus) {
    if (!ollamaStatus?.activeModel) {
      statusTooltipContent =
        'No AI model selected. Click "Configure Model" to choose one.';
    } else if (isActiveModelLoaded) {
      statusTooltipContent = `Active Model: ${modelName} (Loaded)${vramUsageString}`;
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
      className="bg-white/70 dark:bg-slate-950/70 backdrop-blur-md border-b border-slate-200 dark:border-slate-800"
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
                (contextUsage?.model.defaultContextSize
                  ? ` (Model Max: ${contextUsage.model.defaultContextSize.toLocaleString()})`
                  : activeModelDefaultContextSize
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
                    ? configuredContextSize.toLocaleString()
                    : 'Default'}
              </Badge>
            </Tooltip>
          )}

          {/* --- CONTEXT METER --- */}
          {effectiveModelContextSize && (
            <Tooltip
              content={
                contextUsage
                  ? (() => {
                      const prompt =
                        contextUsage.totals.promptTokens ??
                        fallbackPromptTokens ??
                        '?';
                      const eff = effectiveModelContextSize ?? '?';
                      const reserved = contextUsage.reserved.outputTokens;
                      const projected =
                        typeof prompt === 'number' && typeof eff === 'number'
                          ? prompt + reserved
                          : '?';
                      const overflow =
                        typeof projected === 'number' &&
                        typeof eff === 'number' &&
                        projected > eff;
                      return (
                        `Prompt: ${prompt} / ${eff} tokens` +
                        `\nReserved Output: ${reserved}` +
                        `\nProjected: ${projected} / ${eff}${overflow ? ' (will exceed)' : ''}` +
                        `\nBreakdown — System: ${contextUsage.breakdown.systemTokens ?? '?'}, Transcript: ${contextUsage.breakdown.transcriptTokens ?? '?'}, Chat: ${contextUsage.breakdown.chatHistoryTokens ?? '?'}, Input: ${contextUsage.breakdown.inputDraftTokens ?? 0}`
                      );
                    })()
                  : 'Estimating context usage...'
              }
            >
              <Box style={{ minWidth: 140 }}>
                <Progress
                  size="1"
                  value={progressValue}
                  max={100}
                  variant={
                    progressValue !== null && contextUsage
                      ? progressValue >= contextUsage.thresholds.dangerAt * 100
                        ? 'surface'
                        : progressValue >= contextUsage.thresholds.warnAt * 100
                          ? 'classic'
                          : 'soft'
                      : 'soft'
                  }
                />
              </Box>
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
