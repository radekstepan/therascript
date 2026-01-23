import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useAtom, useAtomValue } from 'jotai';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Box,
  Flex,
  Text,
  TextField,
  Slider,
  Badge,
  Select,
} from '@radix-ui/themes';
import {
  GearIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  LightningBoltIcon,
  InfoCircledIcon,
} from '@radix-ui/react-icons';
import {
  isRunConfigSidebarOpenAtom,
  runConfigSidebarWidthAtom,
  temperatureAtom,
  topPAtom,
  repeatPenaltyAtom,
  systemPromptOverrideAtom,
} from '../../store/ui/runConfigSidebarAtom';
import { SESSION_TYPES, THERAPY_TYPES } from '../../constants';
import { updateSessionMetadata } from '../../api/session';
import { fetchSession } from '../../api/session';
import type { Session, SessionMetadata } from '../../types';
import { cn } from '../../utils';
import {
  formatIsoDateToYMD,
  getTodayDateString,
  debounce,
} from '../../helpers';

interface SectionState {
  modelParams: boolean;
  systemPrompt: boolean;
  metadata: boolean;
}

export function RunConfigSidebar() {
  const { sessionId } = useParams<{
    sessionId?: string;
    chatId?: string;
  }>();
  const [isOpen, setIsOpen] = useAtom(isRunConfigSidebarOpenAtom);
  const sidebarWidth = useAtomValue(runConfigSidebarWidthAtom);
  const [temperature, setTemperature] = useAtom(temperatureAtom);
  const [topP, setTopP] = useAtom(topPAtom);
  const [repeatPenalty, setRepeatPenalty] = useAtom(repeatPenaltyAtom);
  const [systemPromptOverrides, setSystemPromptOverrides] = useAtom(
    systemPromptOverrideAtom
  );

  const [sections, setSections] = useState<SectionState>({
    modelParams: true,
    systemPrompt: true,
    metadata: true,
  });

  const [saveStatus, setSaveStatus] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle');

  const idleTimeoutRef = useRef<number | null>(null);

  const parsedSessionId = sessionId ? Number(sessionId) : null;
  const currentSessionId =
    parsedSessionId !== null && Number.isFinite(parsedSessionId)
      ? parsedSessionId
      : null;
  const isSessionActive = currentSessionId !== null;

  useEffect(() => {
    return () => {
      if (idleTimeoutRef.current) {
        window.clearTimeout(idleTimeoutRef.current);
      }
    };
  }, []);

  const currentSystemPromptOverride = currentSessionId
    ? systemPromptOverrides[currentSessionId] || ''
    : '';

  const queryClient = useQueryClient();

  const { data: sessionData } = useQuery<Session, Error>({
    queryKey: ['sessionMeta', currentSessionId],
    queryFn: () => fetchSession(currentSessionId!),
    enabled: isSessionActive,
    staleTime: 30000,
  });

  const [formState, setFormState] = useState<SessionMetadata>({
    clientName: sessionData?.clientName || '',
    sessionName: sessionData?.sessionName || sessionData?.fileName || '',
    date: sessionData
      ? formatIsoDateToYMD(sessionData.date)
      : getTodayDateString(),
    sessionType: sessionData?.sessionType || SESSION_TYPES[0] || '',
    therapy: sessionData?.therapy || THERAPY_TYPES[0] || '',
  });

  const updateMetadataMutation = useMutation({
    mutationFn: (metadata: Partial<SessionMetadata>) => {
      if (currentSessionId == null) throw new Error('No session ID');
      return updateSessionMetadata(currentSessionId, metadata);
    },
    onSuccess: () => {
      setSaveStatus('saved');
      queryClient.invalidateQueries({
        queryKey: ['sessionMeta', currentSessionId],
      });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      if (idleTimeoutRef.current) window.clearTimeout(idleTimeoutRef.current);
      idleTimeoutRef.current = window.setTimeout(
        () => setSaveStatus('idle'),
        2000
      );
    },
    onError: () => {
      setSaveStatus('error');
      if (idleTimeoutRef.current) window.clearTimeout(idleTimeoutRef.current);
      idleTimeoutRef.current = window.setTimeout(
        () => setSaveStatus('idle'),
        2000
      );
    },
  });

  React.useEffect(() => {
    if (sessionData) {
      setFormState({
        clientName: sessionData.clientName || '',
        sessionName: sessionData.sessionName || sessionData.fileName || '',
        date: formatIsoDateToYMD(sessionData.date),
        sessionType: sessionData.sessionType || SESSION_TYPES[0] || '',
        therapy: sessionData.therapy || THERAPY_TYPES[0] || '',
      });
    }
  }, [sessionData]);

  const debouncedSave = useCallback(
    debounce((metadata: Partial<SessionMetadata>) => {
      setSaveStatus('saving');
      updateMetadataMutation.mutate(metadata);
    }, 500),
    [updateMetadataMutation]
  );

  const handleFormChange = <K extends keyof SessionMetadata>(
    field: K,
    value: SessionMetadata[K]
  ) => {
    const newState = { ...formState, [field]: value };
    setFormState(newState);

    if (field === 'sessionType' && value === 'Intake') {
      newState.therapy = 'N/A';
      setFormState(newState);
    }

    debouncedSave(newState);
  };

  const handleSystemPromptChange = (value: string) => {
    if (!currentSessionId) return;
    setSystemPromptOverrides({
      ...systemPromptOverrides,
      [currentSessionId]: value,
    });
  };

  const toggleSection = (section: keyof SectionState) => {
    setSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  if (!isOpen) return null;

  const shouldRenderMetadata = isSessionActive;

  return (
    <div
      className={cn(
        'fixed top-0 right-0 h-full flex flex-col shadow-xl z-40 transition-all duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1.0)]',
        'bg-[var(--gray-1)] text-[var(--gray-11)]',
        'border-l border-[var(--gray-a4)]'
      )}
      style={{
        width: sidebarWidth,
        backgroundColor: 'var(--color-panel-solid)',
      }}
      aria-label="Run configuration sidebar"
    >
      <div className="flex items-center justify-between h-16 px-4 border-b border-[var(--gray-a4)]">
        <Flex align="center" gap="2">
          <GearIcon width={18} height={18} className="text-[var(--gray-11)]" />
          <Text size="2" weight="bold" className="text-[var(--gray-12)]">
            Run Configuration
          </Text>
        </Flex>
        <button
          onClick={() => setIsOpen(false)}
          className="p-2 rounded-lg text-[var(--gray-11)] hover:bg-[var(--gray-a3)] hover:text-[var(--gray-12)] transition-colors"
          aria-label="Close sidebar"
        >
          <ChevronRightIcon width={20} height={20} />
        </button>
      </div>

      <div className="flex-grow overflow-y-auto px-4 py-4 space-y-6">
        <Box>
          <button
            onClick={() => toggleSection('modelParams')}
            className="flex items-center w-full text-left mb-3"
          >
            {sections.modelParams ? (
              <ChevronDownIcon
                width={14}
                height={14}
                className="mr-2 text-[var(--gray-10)]"
              />
            ) : (
              <ChevronRightIcon
                width={14}
                height={14}
                className="mr-2 text-[var(--gray-10)]"
              />
            )}
            <Text size="2" weight="medium" className="text-[var(--gray-12)]">
              Model Parameters
            </Text>
          </button>

          {sections.modelParams && (
            <Box className="space-y-4 pl-6">
              <Box>
                <Flex align="center" justify="between" mb="2">
                  <Text size="1" className="text-[var(--gray-11)]">
                    Temperature
                  </Text>
                  <Badge variant="outline" size="1">
                    {temperature.toFixed(1)}
                  </Badge>
                </Flex>
                <Slider
                  value={[temperature]}
                  onValueChange={([value]) => setTemperature(value)}
                  min={0}
                  max={2}
                  step={0.1}
                  className="w-full"
                />
              </Box>

              <Box>
                <Flex align="center" justify="between" mb="2">
                  <Text size="1" className="text-[var(--gray-11)]">
                    Top-P
                  </Text>
                  <Badge variant="outline" size="1">
                    {topP.toFixed(2)}
                  </Badge>
                </Flex>
                <Slider
                  value={[topP]}
                  onValueChange={([value]) => setTopP(value)}
                  min={0}
                  max={1}
                  step={0.05}
                  className="w-full"
                />
              </Box>

              <Box>
                <Flex align="center" justify="between" mb="2">
                  <Text size="1" className="text-[var(--gray-11)]">
                    Repeat Penalty
                  </Text>
                  <Badge variant="outline" size="1">
                    {repeatPenalty.toFixed(1)}
                  </Badge>
                </Flex>
                <Slider
                  value={[repeatPenalty]}
                  onValueChange={([value]) => setRepeatPenalty(value)}
                  min={0.5}
                  max={2}
                  step={0.1}
                  className="w-full"
                />
              </Box>
            </Box>
          )}
        </Box>

        <Box>
          <button
            onClick={() => toggleSection('systemPrompt')}
            className="flex items-center w-full text-left mb-3"
          >
            {sections.systemPrompt ? (
              <ChevronDownIcon
                width={14}
                height={14}
                className="mr-2 text-[var(--gray-10)]"
              />
            ) : (
              <ChevronRightIcon
                width={14}
                height={14}
                className="mr-2 text-[var(--gray-10)]"
              />
            )}
            <Flex align="center" gap="2">
              <LightningBoltIcon
                width={14}
                height={14}
                className="text-[var(--gray-10)]"
              />
              <Text size="2" weight="medium" className="text-[var(--gray-12)]">
                System Prompt
              </Text>
            </Flex>
          </button>

          {sections.systemPrompt && (
            <Box className="pl-6">
              <Flex align="center" gap="2" mb="2">
                <InfoCircledIcon
                  width={12}
                  height={12}
                  className="text-[var(--gray-a10)]"
                />
                <Text size="1" color="gray">
                  Override the default system prompt for this session
                </Text>
              </Flex>
              <textarea
                value={currentSystemPromptOverride}
                onChange={(e) => handleSystemPromptChange(e.target.value)}
                placeholder="Enter custom system prompt..."
                rows={6}
                className={cn(
                  'w-full flex-grow rounded-md border border-[--gray-a7] bg-[--gray-1] focus:border-[--accent-8] focus:shadow-[0_0_0_1px_var(--accent-8)]',
                  'px-2 py-1 text-sm text-[--gray-12] placeholder:text-[--gray-a9] focus-visible:outline-none resize-y min-h-[120px]'
                )}
              />
            </Box>
          )}
        </Box>

        {shouldRenderMetadata && (
          <Box>
            <button
              onClick={() => toggleSection('metadata')}
              className="flex items-center w-full text-left mb-3"
            >
              {sections.metadata ? (
                <ChevronDownIcon
                  width={14}
                  height={14}
                  className="mr-2 text-[var(--gray-10)]"
                />
              ) : (
                <ChevronRightIcon
                  width={14}
                  height={14}
                  className="mr-2 text-[var(--gray-10)]"
                />
              )}
              <Flex align="center" gap="2">
                <InfoCircledIcon
                  width={14}
                  height={14}
                  className="text-[var(--gray-10)]"
                />
                <Text
                  size="2"
                  weight="medium"
                  className="text-[var(--gray-12)]"
                >
                  Session Metadata
                </Text>
              </Flex>
              {saveStatus !== 'idle' && (
                <Badge
                  size="1"
                  color={
                    saveStatus === 'saved'
                      ? 'green'
                      : saveStatus === 'error'
                        ? 'red'
                        : 'gray'
                  }
                  variant="soft"
                >
                  {saveStatus}
                </Badge>
              )}
            </button>

            {sections.metadata && (
              <Box className="pl-6 space-y-3">
                <Box>
                  <Text
                    size="1"
                    weight="medium"
                    as="label"
                    className="block mb-1"
                  >
                    Session Name
                  </Text>
                  <TextField.Root
                    size="2"
                    value={formState.sessionName}
                    onChange={(e) =>
                      handleFormChange('sessionName', e.target.value)
                    }
                    placeholder="e.g., Weekly Check-in"
                  />
                </Box>

                <Box>
                  <Text
                    size="1"
                    weight="medium"
                    as="label"
                    className="block mb-1"
                  >
                    Client Name
                  </Text>
                  <TextField.Root
                    size="2"
                    value={formState.clientName}
                    onChange={(e) =>
                      handleFormChange('clientName', e.target.value)
                    }
                    placeholder="Client's Full Name"
                  />
                </Box>

                <Box>
                  <Text
                    size="1"
                    weight="medium"
                    as="label"
                    className="block mb-1"
                  >
                    Date
                  </Text>
                  <input
                    type="date"
                    value={formState.date}
                    onChange={(e) => handleFormChange('date', e.target.value)}
                    className={cn(
                      'flex w-full rounded-md border border-[--gray-a7] bg-[--gray-1] focus:border-[--accent-8] focus:shadow-[0_0_0_1px_var(--accent-8)]',
                      'h-8 px-2 py-1 text-sm text-[--gray-12] placeholder:text-[--gray-a9] focus-visible:outline-none'
                    )}
                    style={{ lineHeight: 'normal' }}
                  />
                </Box>

                <Box>
                  <Text
                    size="1"
                    weight="medium"
                    as="label"
                    className="block mb-1"
                  >
                    Session Type
                  </Text>
                  <Select.Root
                    value={formState.sessionType}
                    onValueChange={(value) =>
                      handleFormChange('sessionType', value)
                    }
                    size="2"
                  >
                    <Select.Trigger placeholder="Select type..." />
                    <Select.Content>
                      {SESSION_TYPES.map((type) => (
                        <Select.Item key={type} value={type}>
                          {type.charAt(0).toUpperCase() + type.slice(1)}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                </Box>

                <Box>
                  <Text
                    size="1"
                    weight="medium"
                    as="label"
                    className="block mb-1"
                  >
                    Therapy Type
                  </Text>
                  <Select.Root
                    value={formState.therapy}
                    onValueChange={(value) =>
                      handleFormChange('therapy', value)
                    }
                    size="2"
                    disabled={formState.sessionType === 'Intake'}
                  >
                    <Select.Trigger placeholder="Select therapy..." />
                    <Select.Content>
                      {THERAPY_TYPES.map((type) => (
                        <Select.Item key={type} value={type}>
                          {type}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                </Box>
              </Box>
            )}
          </Box>
        )}
      </div>
    </div>
  );
}
