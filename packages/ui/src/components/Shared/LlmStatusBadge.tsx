// packages/ui/src/components/Shared/LlmStatusBadge.tsx
//
// Left-side model-state indicator shared by the session and standalone
// chat headers. Every settled state gets an explicit visual — in
// particular "Not loaded" renders a real badge instead of the previous
// nothing (a missing green check was the only signal, which read as
// "still connected" after an unload or remote eviction).
import React from 'react';
import { Badge, Flex, Spinner, Tooltip } from '@radix-ui/themes';
import {
  CheckCircledIcon,
  ExclamationTriangleIcon,
} from '@radix-ui/react-icons';
import type { LlmStatus } from '../../types';
import { useLlmModelState } from '../../hooks/useLlmModelState';

interface LlmStatusBadgeProps {
  llmStatus: LlmStatus | undefined;
  isLoadingLlmStatus: boolean;
  /** Appended to the loaded tooltip, e.g. " | VRAM: 4.5 GB (100% GPU)". */
  vramSuffix?: string;
}

export function LlmStatusBadge({
  llmStatus,
  isLoadingLlmStatus,
  vramSuffix = '',
}: LlmStatusBadgeProps) {
  const modelName = llmStatus?.activeModel ?? 'No Model Selected';
  const isLoaded = llmStatus?.loaded ?? false;
  const isActiveModelLoaded =
    isLoaded && llmStatus?.modelChecked === llmStatus?.activeModel;
  const {
    hasActiveModel,
    isModelLoading,
    loadFailed,
    loadError,
    isServerUnreachable,
    modelMismatch,
    actualLoadedModel,
    isSettledNotLoaded,
  } = useLlmModelState(llmStatus);

  let tooltipContent = 'Loading status...';
  if (!isLoadingLlmStatus) {
    if (!hasActiveModel) {
      tooltipContent =
        'No AI model selected. Click "Configure Model" to choose one.';
    } else if (isActiveModelLoaded) {
      tooltipContent = `Active Model: ${modelName} (Loaded)${vramSuffix}`;
    } else if (isServerUnreachable) {
      tooltipContent =
        `LLM server unreachable` +
        (llmStatus?.activeBaseUrl ? ` at ${llmStatus.activeBaseUrl}` : '') +
        `. Check that the server is running` +
        (llmStatus?.isRemoteBaseUrl ? ' and the remote URL is correct' : '') +
        '.';
    } else if (loadFailed) {
      tooltipContent = `Failed to load ${modelName}: ${loadError ?? 'unknown error'}`;
    } else if (isModelLoading) {
      tooltipContent = `Loading model: ${modelName}…`;
    } else if (modelMismatch) {
      tooltipContent =
        `Server has "${actualLoadedModel}" loaded, but "${modelName}" is ` +
        `configured. Open "Configure AI Model" and load "${modelName}" to switch.`;
    } else if (isSettledNotLoaded) {
      tooltipContent = `Active Model: ${modelName} (Not loaded). Open "Configure AI Model" to load it.`;
    } else {
      tooltipContent = `Active Model: ${modelName} (Not loaded or unavailable)`;
    }
  }

  const renderBadge = () => {
    if (isLoadingLlmStatus) return <Spinner size="1" />;
    if (isActiveModelLoaded) {
      return (
        <CheckCircledIcon className="text-green-600" width="14" height="14" />
      );
    }
    // Loading and failed states render on the right side of the header
    // (spinner + name / red "Load failed"), so the left slot stays empty.
    if (!hasActiveModel || isModelLoading || loadFailed) return null;
    if (isServerUnreachable) {
      return (
        <ExclamationTriangleIcon
          className="text-red-600"
          width="14"
          height="14"
          role="img"
          aria-label="LLM server unreachable"
        />
      );
    }
    if (modelMismatch) {
      return (
        <ExclamationTriangleIcon
          className="text-[--amber-9]"
          width="14"
          height="14"
          role="img"
          aria-label={`Server holds ${actualLoadedModel} instead of ${modelName}`}
        />
      );
    }
    if (isSettledNotLoaded) {
      return (
        <Badge variant="soft" color="gray" size="1">
          Not loaded
        </Badge>
      );
    }
    return null;
  };

  return (
    <Tooltip content={tooltipContent}>
      <Flex align="center" gap="1">
        {renderBadge()}
      </Flex>
    </Tooltip>
  );
}
