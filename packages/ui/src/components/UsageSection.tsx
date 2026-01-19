import React, { useState } from 'react';
import {
  Box,
  Heading,
  Text,
  Flex,
  Card,
  Separator,
  Badge,
  Select,
  Spinner,
  Callout,
  Button,
  Tooltip,
} from '@radix-ui/themes';
import { InfoCircledIcon } from '@radix-ui/react-icons';
import { formatDistanceToNow } from 'date-fns';
import {
  useUsageHistory,
  useUsageStats,
  useUsageLogs,
} from '../hooks/useUsage';
import { formatCurrency } from '../utils';

const WEEK_OPTIONS = [4, 8, 12] as const;

function formatDateRange(start: number, end: number): string {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  };
  return `${formatDate(startDate)} - ${formatDate(endDate)}`;
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${remainingSeconds}s`;
}

function formatTokens(tokens: number): string {
  return tokens.toLocaleString();
}

export function UsageSection() {
  const [selectedWeeks, setSelectedWeeks] = useState(12);
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);
  const [selectedType, setSelectedType] = useState<'all' | 'llm' | 'whisper'>(
    'all'
  );
  const [selectedModel, setSelectedModel] = useState<string>('all');
  const [selectedSource, setSelectedSource] = useState<string>('all');
  const [filterStart, setFilterStart] = useState<number | null>(null);
  const [filterEnd, setFilterEnd] = useState<number | null>(null);

  const { data: historyData, isLoading: historyLoading } =
    useUsageHistory(selectedWeeks);
  const { data: statsData, isLoading: statsLoading } = useUsageStats();

  const { data: logsData, isLoading: logsLoading } = useUsageLogs(
    filterStart && filterEnd
      ? {
          start: filterStart,
          end: filterEnd,
          type: selectedType === 'all' ? undefined : selectedType,
          model: selectedModel === 'all' ? undefined : selectedModel,
          source: selectedSource === 'all' ? undefined : selectedSource,
        }
      : {
          type: selectedType === 'all' ? undefined : selectedType,
          model: selectedModel === 'all' ? undefined : selectedModel,
          source: selectedSource === 'all' ? undefined : selectedSource,
        }
  );

  if (historyLoading || statsLoading || logsLoading) {
    return (
      <Box p="4" className="flex items-center justify-center">
        <Spinner />
      </Box>
    );
  }

  const llmTotalTokens =
    (statsData?.llm.totalPromptTokens || 0) +
    (statsData?.llm.totalCompletionTokens || 0);
  const llmTotalCalls = statsData?.llm.callCount || 0;
  const whisperTotalDuration = statsData?.whisper.totalDuration || 0;
  const whisperTotalCalls = statsData?.whisper.callCount || 0;
  const totalCost = statsData?.totalEstimatedCost || 0;

  const weekCosts = historyData?.weeks.map((w) => w.totalCost) || [];
  const maxActualCost = Math.max(...weekCosts, 0);
  const maxCost = maxActualCost > 0 ? maxActualCost : 0.005;
  const chartData = [...(historyData?.weeks || [])].sort(
    (a, b) => a.weekStart - b.weekStart
  );

  console.log('[UsageSection] Chart data:', {
    totalWeeks: chartData.length,
    maxCost,
    weeks: chartData.map((w, i) => ({
      index: i,
      weekStart: formatDateRange(w.weekStart, w.weekEnd),
      totalCost: w.totalCost,
      llmCost: w.llm.estimatedCost,
      whisperCost: w.whisper.estimatedCost,
    })),
  });

  const handleWeekClick = (weekStart: number) => {
    setSelectedWeek(weekStart);
    setFilterStart(weekStart);
    setFilterEnd(
      weekStart +
        6 * 24 * 60 * 60 * 1000 +
        23 * 60 * 60 * 1000 +
        59 * 60 * 1000 +
        999
    );
  };

  const clearWeekFilter = () => {
    setSelectedWeek(null);
    setFilterStart(null);
    setFilterEnd(null);
  };

  return (
    <Box>
      <Flex direction="column" gap="6" mb="6">
        <Flex gap="4" style={{ flexWrap: 'wrap' }}>
          <Card variant="surface" style={{ flex: 1, minWidth: '200px' }}>
            <Box p="4">
              <Text as="p" size="2" color="gray" mb="2">
                Total LLM Tokens
              </Text>
              <Flex align="baseline" gap="2">
                <Text size="6" weight="bold">
                  {formatTokens(llmTotalTokens)}
                </Text>
                <Text size="2" color="gray">
                  ({formatTokens(statsData?.llm.totalPromptTokens || 0)} prompt
                  / {formatTokens(statsData?.llm.totalCompletionTokens || 0)}{' '}
                  completion)
                </Text>
              </Flex>
              <Separator my="2" />
              <Text as="p" size="2" color="gray" mb="1">
                Total Calls: {llmTotalCalls}
              </Text>
            </Box>
          </Card>

          <Card variant="surface" style={{ flex: 1, minWidth: '200px' }}>
            <Box p="4">
              <Text as="p" size="2" color="gray" mb="2">
                Total Whisper Duration
              </Text>
              <Flex align="baseline" gap="2">
                <Text size="6" weight="bold">
                  {formatDuration(whisperTotalDuration)}
                </Text>
                <Text size="2" color="gray">
                  ({whisperTotalCalls} transcription
                  {whisperTotalCalls !== 1 ? 's' : ''})
                </Text>
              </Flex>
            </Box>
          </Card>

          <Card variant="surface" style={{ flex: 1, minWidth: '200px' }}>
            <Box p="4">
              <Text as="p" size="2" color="gray" mb="2">
                Total Estimated Cost
              </Text>
              <Flex align="baseline" gap="2">
                <Text
                  size="6"
                  weight="bold"
                  style={{ color: 'var(--accent-a11)' }}
                >
                  {formatCurrency(totalCost)}
                </Text>
              </Flex>
            </Box>
          </Card>
        </Flex>
      </Flex>

      <Flex direction="column" gap="6">
        <Flex align="center" justify="between">
          <Heading as="h2" size="5">
            Weekly Cost History
          </Heading>
          <Flex align="center" gap="3">
            {selectedWeek !== null && (
              <Button variant="soft" size="1" onClick={clearWeekFilter}>
                Clear Filter
              </Button>
            )}
            <Select.Root
              value={selectedWeeks.toString()}
              onValueChange={(v) => setSelectedWeeks(parseInt(v))}
            >
              <Select.Trigger placeholder="Select weeks..." />
              <Select.Content>
                {WEEK_OPTIONS.map((weeks) => (
                  <Select.Item key={weeks} value={weeks.toString()}>
                    Last {weeks} weeks
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </Flex>
        </Flex>

        {chartData.length > 0 && (
          <Box
            style={{
              display: 'flex',
              flexDirection: 'row',
              gap: '2px',
              height: '200px',
              marginBottom: '4px',
              padding: '12px',
              backgroundColor: 'var(--gray-1)',
              borderRadius: '8px',
            }}
          >
            {chartData.map((week) => {
              const llmHeight =
                maxCost > 0 ? (week.llm.estimatedCost / maxCost) * 160 : 0;
              const whisperHeight =
                maxCost > 0 ? (week.whisper.estimatedCost / maxCost) * 160 : 0;

              const MIN_BAR_HEIGHT = 3; // Minimum height in pixels for visibility
              const hasLlmCost = week.llm.estimatedCost > 0;
              const hasWhisperCost = week.whisper.estimatedCost > 0;

              return (
                <Flex
                  key={week.weekStart}
                  direction="column"
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    height: '100%',
                  }}
                >
                  <Flex
                    style={{
                      width: '100%',
                      gap: '2px',
                      flex: 1,
                      alignItems: 'flex-end',
                      minHeight: '30px',
                    }}
                  >
                    {hasLlmCost && (
                      <Tooltip
                        content={`LLM: ${formatCurrency(week.llm.estimatedCost)} (${week.llm.callCount} calls)`}
                      >
                        <Box
                          style={{
                            flex: 1,
                            minWidth: '2px',
                            backgroundColor: 'var(--blue-9)',
                            height: `${Math.max(llmHeight, MIN_BAR_HEIGHT)}px`,
                            borderRadius: '2px',
                            cursor: 'pointer',
                            transition: 'opacity 0.2s',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.opacity = '0.8';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.opacity = '1';
                          }}
                          onClick={() => handleWeekClick(week.weekStart)}
                        />
                      </Tooltip>
                    )}
                    {hasWhisperCost && (
                      <Tooltip
                        content={`Whisper: ${formatCurrency(week.whisper.estimatedCost)} (${formatDuration(week.whisper.totalDuration)})`}
                      >
                        <Box
                          style={{
                            flex: 1,
                            minWidth: '2px',
                            backgroundColor: 'var(--purple-9)',
                            height: `${Math.max(whisperHeight, MIN_BAR_HEIGHT)}px`,
                            borderRadius: '2px',
                            cursor: 'pointer',
                            transition: 'opacity 0.2s',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.opacity = '0.8';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.opacity = '1';
                          }}
                          onClick={() => handleWeekClick(week.weekStart)}
                        />
                      </Tooltip>
                    )}
                  </Flex>
                  <Text
                    as="div"
                    size="1"
                    mt="2"
                    style={{ textAlign: 'center', lineHeight: 1.2 }}
                  >
                    {formatDateRange(week.weekStart, week.weekEnd)}
                  </Text>
                </Flex>
              );
            })}
          </Box>
        )}

        <Flex gap="2" mb="2" align="center">
          <Badge variant="solid" color="blue">
            LLM
          </Badge>
          <Badge variant="solid" color="purple">
            Whisper
          </Badge>
        </Flex>
      </Flex>

      <Heading as="h2" size="5" mb="4" mt="6">
        Detailed Usage Logs
      </Heading>

      <Flex gap="3" mb="4" wrap="wrap">
        <Select.Root
          value={selectedType}
          onValueChange={(v) => {
            setSelectedType(v as 'all' | 'llm' | 'whisper');
            clearWeekFilter();
          }}
        >
          <Select.Trigger placeholder="Filter by type..." />
          <Select.Content>
            <Select.Item value="all">All Types</Select.Item>
            <Select.Item value="llm">LLM Only</Select.Item>
            <Select.Item value="whisper">Whisper Only</Select.Item>
          </Select.Content>
        </Select.Root>

        <Select.Root
          value={selectedModel}
          onValueChange={(v) => {
            setSelectedModel(v);
            clearWeekFilter();
          }}
        >
          <Select.Trigger placeholder="Filter by model..." />
          <Select.Content>
            <Select.Item value="all">All Models</Select.Item>
            {Object.keys(statsData?.llm.callsByModel || {}).map((model) => (
              <Select.Item key={model} value={model}>
                {model}
              </Select.Item>
            ))}
            {Object.keys(statsData?.whisper.callsByModel || {}).map((model) => (
              <Select.Item key={model} value={model}>
                {model}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>

        <Select.Root
          value={selectedSource}
          onValueChange={(v) => {
            setSelectedSource(v);
            clearWeekFilter();
          }}
        >
          <Select.Trigger placeholder="Filter by source..." />
          <Select.Content>
            <Select.Item value="all">All Sources</Select.Item>
            {Object.keys(statsData?.llm.callsBySource || {}).map((source) => (
              <Select.Item key={source} value={source}>
                {source}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      </Flex>

      {logsLoading ? (
        <Box p="4" className="flex items-center justify-center">
          <Spinner />
        </Box>
      ) : logsData?.items.length === 0 ? (
        <Box p="4">
          <Text color="gray">No usage logs found.</Text>
        </Box>
      ) : (
        <Box>
          {/* Header */}
          <Flex
            style={{
              padding: '8px',
              backgroundColor: 'var(--gray-2)',
              borderBottom: '2px solid var(--gray-5)',
              position: 'sticky',
              top: 0,
              zIndex: 10,
            }}
          >
            <Box style={{ width: '150px', paddingRight: '12px' }}>
              <Text size="2" weight="bold" color="gray">
                Time
              </Text>
            </Box>
            <Box
              style={{
                width: '90px',
                paddingRight: '12px',
                textAlign: 'center',
              }}
            >
              <Text size="2" weight="bold" color="gray">
                Type
              </Text>
            </Box>
            <Box style={{ width: '110px', paddingRight: '12px' }}>
              <Text size="2" weight="bold" color="gray">
                Source
              </Text>
            </Box>
            <Box style={{ width: '110px', paddingRight: '12px' }}>
              <Text size="2" weight="bold" color="gray">
                Model
              </Text>
            </Box>
            <Box style={{ width: '160px', paddingRight: '12px' }}>
              <Text size="2" weight="bold" color="gray">
                Tokens / Duration
              </Text>
            </Box>
            <Box style={{ flex: 1, textAlign: 'right' }}>
              <Text size="2" weight="bold" color="gray">
                Cost
              </Text>
            </Box>
          </Flex>

          {/* Body */}
          <Box style={{ maxHeight: '500px', overflowY: 'auto' }}>
            {logsData?.items.map((log) => (
              <Flex
                key={log.id}
                align="center"
                style={{
                  padding: '8px',
                  borderBottom: '1px solid var(--gray-3)',
                }}
              >
                <Box style={{ width: '150px', paddingRight: '12px' }}>
                  <Tooltip content={new Date(log.timestamp).toLocaleString()}>
                    <Text size="2" style={{ cursor: 'help' }}>
                      {formatDistanceToNow(new Date(log.timestamp), {
                        addSuffix: true,
                      })}
                    </Text>
                  </Tooltip>
                </Box>
                <Box
                  style={{
                    width: '90px',
                    paddingRight: '12px',
                    display: 'flex',
                    justifyContent: 'center',
                  }}
                >
                  <Badge
                    variant="soft"
                    color={log.type === 'llm' ? 'blue' : 'purple'}
                    style={{
                      textAlign: 'center',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      paddingLeft: '8px',
                      paddingRight: '8px',
                    }}
                  >
                    {log.type.toUpperCase()}
                  </Badge>
                </Box>
                <Box style={{ width: '110px', paddingRight: '12px' }}>
                  <Text size="2">{log.source}</Text>
                </Box>
                <Box style={{ width: '110px', paddingRight: '12px' }}>
                  <Text size="2">{log.model}</Text>
                </Box>
                <Box style={{ width: '160px', paddingRight: '12px' }}>
                  {log.type === 'llm' ? (
                    <Text size="2">
                      {log.promptTokens !== null
                        ? formatTokens(log.promptTokens)
                        : '—'}{' '}
                      /{' '}
                      {log.completionTokens !== null
                        ? formatTokens(log.completionTokens)
                        : '—'}
                    </Text>
                  ) : (
                    <Text size="2">
                      {log.duration !== null
                        ? formatDuration(log.duration)
                        : '—'}
                    </Text>
                  )}
                </Box>
                <Box style={{ flex: 1, textAlign: 'right' }}>
                  <Text
                    size="2"
                    style={{
                      color:
                        log.estimatedCost > 0
                          ? 'var(--accent-a11)'
                          : 'var(--gray-11)',
                    }}
                  >
                    {formatCurrency(log.estimatedCost)}
                  </Text>
                </Box>
              </Flex>
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
}
