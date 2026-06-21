// packages/ui/src/components/Shared/LlmEndpointModelPicker.tsx
//
// Shared Local/Remote LLM endpoint picker + model select. Used by:
//   - SelectActiveModelModal (Configure AI Model dialog) — to set the chat's
//     active model and endpoint.
//   - CreateAnalysisJobModal (Analyze Multiple Sessions dialog) — to choose
//     which model + endpoint a one-off analysis job should use.
//
// Both consumers persist the entered remote URL through `remoteBaseUrlAtom`
// (localStorage) so the field is pre-filled the next time the user opens
// either modal.
import React, { useMemo } from 'react';
import { useAtom } from 'jotai';
import { useQuery } from '@tanstack/react-query';
import {
  Box,
  Flex,
  Text,
  Select,
  TextField,
  SegmentedControl,
  Badge,
  Spinner,
  Tooltip,
} from '@radix-ui/themes';
import { GlobeIcon, LightningBoltIcon } from '@radix-ui/react-icons';
import prettyBytes from 'pretty-bytes';
import { fetchAvailableModels } from '../../api/api';
import { useDebounce } from '../../hooks/useDebounce';
import { remoteBaseUrlAtom } from '../../store';
import type { LlmModelInfo } from '../../types';

const EMPTY_MODELS: readonly LlmModelInfo[] = [];

export interface LlmEndpointModelPickerProps {
  /** Current model selection. */
  selectedModel: string;
  /** Update the model selection. */
  onSelectedModelChange: (model: string) => void;
  /** Whether the user picked the Remote endpoint. */
  isRemote: boolean;
  setIsRemote: (isRemote: boolean) => void;
  /** Current remote URL string (controlled). */
  remoteUrl: string;
  setRemoteUrl: (url: string) => void;
  /** Disables both the toggle, the URL field, and the model select. */
  disabled?: boolean;
  /**
   * When `false`, the model query does not run. Pass `isOpen` from the parent
   * dialog so the picker only fetches while the dialog is visible.
   */
  enabled: boolean;
  /** Placeholder for the model `Select.Trigger`. */
  placeholder?: string;
  /**
   * Called whenever the fetched model list changes. The parent uses this to
   * look up `selectedModelDetails` (e.g. for default context size, VRAM).
   */
  onModelsChange?: (models: LlmModelInfo[]) => void;
}

const isValidHttpUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

export const LlmEndpointModelPicker: React.FC<LlmEndpointModelPickerProps> = ({
  selectedModel,
  onSelectedModelChange,
  isRemote,
  setIsRemote,
  remoteUrl,
  setRemoteUrl,
  disabled = false,
  enabled,
  placeholder = 'Select a model...',
  onModelsChange,
}) => {
  const [persistedRemoteUrl, setPersistedRemoteUrl] =
    useAtom(remoteBaseUrlAtom);

  const debouncedRemoteUrl = useDebounce(remoteUrl, 500);
  const modelsBaseUrl = isRemote ? debouncedRemoteUrl.trim() : null;
  const canFetchRemoteModels = !isRemote || isValidHttpUrl(debouncedRemoteUrl);

  const {
    data: availableModelsData,
    isLoading: isLoadingModels,
    isError: isErrorAvailableModels,
    refetch: refetchAvailableModels,
  } = useQuery({
    queryKey: ['availableLlmModels', isRemote ? modelsBaseUrl : 'local'],
    queryFn: () => fetchAvailableModels(modelsBaseUrl),
    enabled: enabled && (!isRemote || !!canFetchRemoteModels),
    // Always treat the list as stale so React Query refetches on every mount
    // and every Local<->Remote toggle. The list of available models can
    // change at any time (new pull, new remote) and we never want to show a
    // cached snapshot from a previous endpoint or a stale local cache.
    staleTime: 0,
    retry: false,
  });

  const models = useMemo<LlmModelInfo[]>(
    () =>
      (availableModelsData?.models as LlmModelInfo[] | undefined) ??
      (EMPTY_MODELS as LlmModelInfo[]),
    [availableModelsData]
  );

  // Slot content for the model-selection area (remote only):
  //   - no/valid URL: nothing (nothing to fetch, nothing to pick)
  //   - valid URL + loading: small loading line
  //   - valid URL + errored: nothing (the amber "Could not load models" block
  //     above already explains it; an empty disabled select adds no value)
  //   - valid URL + fetched 0 models: small empty line
  //   - valid URL + fetched N models: the "Select Model" + Select.Root
  // For local, we always render the select (the local fetch is fast and
  // there is no remote-only edge case to guard against here).
  const hasValidRemoteUrl =
    isRemote && debouncedRemoteUrl.trim().length > 0
      ? isValidHttpUrl(debouncedRemoteUrl)
      : false;
  const showEmptyMessage =
    isRemote &&
    hasValidRemoteUrl &&
    !isLoadingModels &&
    !isErrorAvailableModels &&
    models.length === 0;
  const showLoadingLine = isRemote && hasValidRemoteUrl && isLoadingModels;
  const showSelect =
    !isRemote ||
    (hasValidRemoteUrl &&
      !isLoadingModels &&
      !isErrorAvailableModels &&
      models.length > 0);

  // Surface the fetched models to the parent so it can compute derived values
  // (selectedModelDetails, recommendedContextSize, etc.) without re-fetching.
  React.useEffect(() => {
    onModelsChange?.(models);
  }, [models, onModelsChange]);

  // Toggling to Remote should pre-fill the input from localStorage so the user
  // doesn't have to retype their last remote URL. Toggling to Local clears
  // the input (we don't want stale text behind a Local toggle).
  const handleRemoteToggle = (next: 'local' | 'remote') => {
    const goingRemote = next === 'remote';
    // Clicking the already-selected segment isn't a real toggle; don't
    // blow away the current model (or re-pre-fill the URL) in that case.
    if (goingRemote === isRemote) return;
    setIsRemote(goingRemote);
    // The picked model is endpoint-specific (a name from the local LM
    // Studio may not exist on the remote one and vice versa), so clear
    // it on the Local<->Remote boundary. The "Select Model" select and
    // the "Context Size" input stay gated on `selectedModelDetails` and
    // reappear once the user picks a model for the new endpoint.
    onSelectedModelChange('');
    if (goingRemote) {
      // Only pre-fill if the user hasn't already typed something.
      if (!remoteUrl || remoteUrl.trim().length === 0) {
        setRemoteUrl(persistedRemoteUrl || '');
      }
    } else {
      setRemoteUrl('');
    }
    // No manual refetch here: state updates are async, so a direct
    // `refetchAvailableModels()` call would fire on the observer that
    // still holds the *old* queryKey. The `queryKey` change itself
    // (driven by `setIsRemote` + `setRemoteUrl`) creates a new observer
    // that refetches automatically, and `staleTime: 0` guarantees the
    // new endpoint's list comes back from the server.
  };

  // Whenever the user finishes typing a remote URL, mirror it to localStorage
  // so the next dialog (chat or analysis) opens with the same value.
  const handleRemoteUrlChange = (next: string) => {
    setRemoteUrl(next);
    if (next.trim().length > 0) {
      setPersistedRemoteUrl(next.trim());
    }
  };

  return (
    <Flex direction="column" gap="3">
      <Box>
        <Text as="div" size="2" mb="1" weight="medium">
          LLM Endpoint
        </Text>
        <SegmentedControl.Root
          value={isRemote ? 'remote' : 'local'}
          onValueChange={handleRemoteToggle}
          size="2"
          disabled={disabled}
        >
          <SegmentedControl.Item value="local">
            Local Machine
          </SegmentedControl.Item>
          <SegmentedControl.Item value="remote">
            <Flex align="center" gap="1">
              <GlobeIcon /> Remote Machine
            </Flex>
          </SegmentedControl.Item>
        </SegmentedControl.Root>
      </Box>

      {isRemote && (
        <label>
          <Text as="div" size="2" mb="1" weight="medium">
            Remote LM Studio URL
          </Text>
          <TextField.Root
            placeholder="http://192.168.1.100:1234"
            value={remoteUrl}
            onChange={(e) => handleRemoteUrlChange(e.target.value)}
            disabled={disabled}
            size="2"
          />
          {remoteUrl.trim().length > 0 && !isValidHttpUrl(remoteUrl) && (
            <Text size="1" color="red" mt="1">
              Please enter a valid http:// or https:// URL.
            </Text>
          )}
        </label>
      )}

      {isErrorAvailableModels && (
        <Text size="1" color="amber">
          Could not reach the{' '}
          {isRemote
            ? `remote LLM server at ${modelsBaseUrl}`
            : 'local LLM server'}
          . Check that LM Studio is running and the URL is correct.{' '}
          <Text
            as="span"
            size="1"
            color="blue"
            style={{ cursor: 'pointer', textDecoration: 'underline' }}
            onClick={() => refetchAvailableModels()}
          >
            Retry
          </Text>
        </Text>
      )}

      <label>
        <Text as="div" size="2" mb="1" weight="medium">
          Select Model
        </Text>
        {showLoadingLine && (
          <Flex align="center" gap="2" mt="1">
            <Spinner size="1" />
            <Text size="1" color="gray">
              Loading models from {debouncedRemoteUrl.trim()}…
            </Text>
          </Flex>
        )}
        {showEmptyMessage && (
          <Text size="1" color="gray" mt="1">
            No models found at {debouncedRemoteUrl.trim()}.
          </Text>
        )}
        {showSelect && (
          <Select.Root
            // Force a full remount whenever the endpoint identity changes.
            // Radix Select registers items in a portal-backed collection, and
            // without this the dropdown keeps stale items from the previous
            // endpoint and shows a literal mix of local + remote entries.
            // Uses the debounced URL (not the live `remoteUrl`) so we don't
            // remount on every keystroke while the user is typing.
            key={isRemote ? `remote-${modelsBaseUrl || 'empty'}` : 'local'}
            value={selectedModel}
            onValueChange={onSelectedModelChange}
            disabled={disabled}
            size="2"
          >
            <Select.Trigger
              placeholder={placeholder}
              style={{ width: '100%' }}
            />
            <Select.Content>
              {models.map((model) => (
                <Select.Item key={model.name} value={model.name}>
                  <Flex justify="between" align="center" gap="4" width="100%">
                    <Text truncate>{model.name}</Text>
                    {model.defaultContextSize &&
                      model.defaultContextSize > 0 && (
                        <Tooltip
                          content={`Default Max Context: ${model.defaultContextSize.toLocaleString()} Tokens`}
                        >
                          <Badge
                            variant="soft"
                            color="blue"
                            radius="full"
                            size="1"
                            style={{ flexShrink: 0 }}
                          >
                            <LightningBoltIcon style={{ marginRight: '2px' }} />
                            {prettyBytes(model.defaultContextSize).replace(
                              ' ',
                              ''
                            )}
                          </Badge>
                        </Tooltip>
                      )}
                  </Flex>
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        )}
      </label>
    </Flex>
  );
};
