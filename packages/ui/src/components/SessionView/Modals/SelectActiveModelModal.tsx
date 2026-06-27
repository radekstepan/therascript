/* packages/ui/src/components/SessionView/Modals/SelectActiveModelModal.tsx */
import React, { useState, useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSetAtom } from 'jotai';
import { Dialog, Button, Flex, Text, Spinner, Callout } from '@radix-ui/themes';
import { InfoCircledIcon, Cross2Icon, CheckIcon } from '@radix-ui/react-icons';
import { setLlmApiToken, setLlmModel } from '../../../api/api';
import type { LlmStatus } from '../../../types';
import { remoteBaseUrlAtom } from '../../../store';
import {
  LlmSettingsForm,
  type LlmSettingsState,
} from '../../Shared/LlmSettingsForm';

interface SelectActiveModelModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onModelSuccessfullySet: () => void;
  currentActiveModelName?: string | null;
  currentConfiguredContextSize?: number | null;
  activeTranscriptTokens?: number | null;
  llmStatus?: LlmStatus;
}

export function SelectActiveModelModal({
  isOpen,
  onOpenChange,
  onModelSuccessfullySet,
  currentActiveModelName,
  currentConfiguredContextSize,
  activeTranscriptTokens,
  llmStatus,
}: SelectActiveModelModalProps) {
  const queryClient = useQueryClient();
  const prevIsOpenRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const setPersistedRemoteUrl = useSetAtom(remoteBaseUrlAtom);

  const [formState, setFormState] = useState<LlmSettingsState>({
    selectedModel: currentActiveModelName || '',
    contextSizeInput: '',
    isRemote: false,
    remoteUrl: '',
    apiToken: '',
    temperature: 0.7,
    topP: 0.9,
    repeatPenalty: 1.1,
    numGpuLayers: undefined,
    thinkingBudget: -1,
  });

  const isValidHttpUrl = React.useCallback((value: string): boolean => {
    try {
      const parsed = new URL(value.trim());
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }, []);

  const setModelMutation = useMutation({
    mutationFn: (variables: {
      modelName: string;
      contextSize?: number | null;
      temperature?: number;
      topP?: number;
      repeatPenalty?: number;
      numGpuLayers?: number | null;
      thinkingBudget?: number | null;
      baseUrl?: string | null;
    }) =>
      setLlmModel(
        variables.modelName,
        variables.contextSize,
        variables.temperature,
        variables.topP,
        variables.repeatPenalty,
        variables.numGpuLayers,
        variables.thinkingBudget,
        variables.baseUrl
      ),
    onSuccess: () => {
      onModelSuccessfullySet();
      queryClient.invalidateQueries({ queryKey: ['llmStatus'] });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      setError(`Failed to set model: ${err.message}`);
    },
  });

  // Separate mutation for the API token so the model save isn't blocked
  // if the token update fails (and vice versa). Fires only when the user
  // actually changed the token field — i.e. the typed value differs from
  // the server-side presence boolean.
  const setApiTokenMutation = useMutation({
    mutationFn: (token: string | null) => setLlmApiToken(token),
    onSuccess: (data) => {
      queryClient.setQueryData<LlmStatus | undefined>(['llmStatus'], (prev) =>
        prev ? { ...prev, hasRemoteApiToken: data.hasRemoteApiToken } : prev
      );
      queryClient.invalidateQueries({ queryKey: ['llmStatus'] });
    },
    onError: (err: Error) => {
      // Don't block the model save flow — surface a non-fatal error.
      console.warn('Failed to set remote LLM API token:', err.message);
    },
  });

  // Fix flickering bug: only initialize form once when modal opens
  // Decouple from llmStatus polling by using ref-based guard
  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      // Modal just opened — snapshot current backend state into local form
      setFormState({
        selectedModel: currentActiveModelName || '',
        contextSizeInput: currentConfiguredContextSize
          ? String(currentConfiguredContextSize)
          : '',
        isRemote: llmStatus?.isRemoteBaseUrl ?? false,
        remoteUrl:
          (llmStatus?.isRemoteBaseUrl ? llmStatus?.activeBaseUrl : '') ?? '',
        // Token is never sent back from the server; the user must re-enter
        // to change it. The form's "is a token set?" comes from
        // llmStatus.hasRemoteApiToken, surfaced via the picker's placeholder.
        apiToken: '',
        temperature: llmStatus?.configuredTemperature ?? 0.7,
        topP: llmStatus?.configuredTopP ?? 0.9,
        repeatPenalty: llmStatus?.configuredRepeatPenalty ?? 1.1,
        numGpuLayers:
          llmStatus?.configuredNumGpuLayers != null
            ? llmStatus.configuredNumGpuLayers
            : undefined,
        thinkingBudget: llmStatus?.configuredThinkingBudget ?? -1,
      });
      setError(null);
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen]); // ← llmStatus properties intentionally excluded

  const handleSave = () => {
    setError(null);
    if (!formState.selectedModel) {
      setError('Please select a model.');
      return;
    }
    const contextSize = formState.contextSizeInput
      ? parseInt(formState.contextSizeInput, 10)
      : null;
    if (
      formState.contextSizeInput &&
      (isNaN(contextSize!) || contextSize! <= 0)
    ) {
      setError('Context size must be a positive number if provided.');
      return;
    }

    // Resolve the base URL we send to the backend.
    // - Remote mode + invalid URL -> block save with a clear error
    // - Remote mode + valid URL  -> send the trimmed URL
    // - Local mode               -> send null to reset to default
    let baseUrl: string | null = null;
    if (formState.isRemote) {
      const trimmed = formState.remoteUrl.trim();
      if (!isValidHttpUrl(trimmed)) {
        setError(
          'Please enter a valid http(s) URL for the remote LM Studio server.'
        );
        return;
      }
      baseUrl = trimmed;
    }

    // Persist the URL the user just confirmed (or the cleared state) into
    // the localStorage-backed atom so the next dialog — chat or analysis —
    // pre-fills it. Empty string is a valid intentional state ("no remote
    // URL saved") and survives across reloads. Skipped on the invalid-URL
    // early-return above so a blocked save never overwrites a good value.
    setPersistedRemoteUrl(formState.remoteUrl.trim());

    // Token change semantics:
    // - apiToken !== ''  -> set/replace (saves the typed value to the DB)
    // - apiToken === ''  -> no-op (preserves any existing token)
    //
    // The empty-field case deliberately does NOT clear the token, even
    // when a token is currently configured. Re-opening the dialog and
    // clicking Save & Load Model without typing a new value must not
    // wipe the credential — the user has an explicit Clear icon button
    // in the picker for that.
    const trimmedToken = formState.apiToken.trim();
    if (trimmedToken.length > 0) {
      setApiTokenMutation.mutate(trimmedToken);
    }

    setModelMutation.mutate({
      modelName: formState.selectedModel,
      contextSize,
      temperature: formState.temperature,
      topP: formState.topP,
      repeatPenalty: formState.repeatPenalty,
      numGpuLayers: formState.numGpuLayers ?? null,
      thinkingBudget: formState.thinkingBudget,
      baseUrl,
    });
  };

  const isSaving = setModelMutation.isPending;
  const isModelLoaded = llmStatus?.loaded === true;

  return (
    <Dialog.Root open={isOpen} onOpenChange={onOpenChange}>
      <Dialog.Content style={{ maxWidth: 450 }}>
        <Dialog.Title>Configure AI Model</Dialog.Title>
        <Dialog.Description size="2" mb="4">
          Select the active model and optionally override its context size.
        </Dialog.Description>
        <Flex direction="column" gap="4">
          <LlmSettingsForm
            llmStatus={llmStatus}
            activeTranscriptTokens={activeTranscriptTokens}
            state={formState}
            onChange={setFormState}
            isOpen={isOpen}
            isSaving={isSaving}
          />
          {(error || setModelMutation.isError) && (
            <Callout.Root color="red" role="alert" size="1">
              <Callout.Icon>
                <InfoCircledIcon />
              </Callout.Icon>
              <Callout.Text>
                {error || setModelMutation.error?.message}
              </Callout.Text>
            </Callout.Root>
          )}
        </Flex>

        <Flex gap="3" mt="4" justify="end">
          <Button
            variant="soft"
            color="gray"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
            className="transition-all duration-150"
          >
            <Cross2Icon /> Cancel
          </Button>
          {!isModelLoaded && (
            <Button
              onClick={handleSave}
              disabled={isSaving || !formState.selectedModel}
              className="transition-all duration-150"
            >
              {isSaving ? (
                <>
                  <Spinner /> <Text ml="1">Saving...</Text>
                </>
              ) : (
                <>
                  <CheckIcon /> Save & Load Model
                </>
              )}
            </Button>
          )}
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
