// packages/ui/src/components/Verification/AccuracyTimelineCard.tsx
//
// Responsive SVG trend chart (DashboardStats styling): accuracy % line plus
// stacked issue counts (fabrications, contradictions, omissions) by date,
// with an All-Models / per-LLM filter.
import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Card,
  Flex,
  Heading,
  Text,
  Select,
  Spinner,
  Box,
} from '@radix-ui/themes';
import { TrendingUp } from 'lucide-react';
import {
  fetchVerificationStats,
  type VerificationTimepointStat,
} from '../../api/verification';

const ALL_MODELS = '__all__';

function TrendChart({ points }: { points: VerificationTimepointStat[] }) {
  const width = 640;
  const height = 180;
  const padL = 44;
  const padR = 12;
  const padT = 12;
  const padB = 28;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const maxIssues = Math.max(
    1,
    ...points.map((p) => p.fabrications + p.contradictions + p.omissions)
  );

  const x = (i: number) =>
    points.length === 1
      ? padL + innerW / 2
      : padL + (i / (points.length - 1)) * innerW;
  const yAcc = (pct: number) => padT + (1 - pct / 100) * innerH;

  const line = points
    .map(
      (p, i) =>
        `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${yAcc(p.accuracyPercent).toFixed(1)}`
    )
    .join(' ');
  const area = `${line} L${x(points.length - 1).toFixed(1)},${(padT + innerH).toFixed(1)} L${x(0).toFixed(1)},${(padT + innerH).toFixed(1)} Z`;

  const barW = Math.max(
    4,
    Math.min(26, (innerW / Math.max(points.length, 1)) * 0.4)
  );

  // Show at most ~8 x-axis labels, evenly spaced.
  const labelIdx = useMemo(() => {
    if (points.length <= 8) return points.map((_, i) => i);
    const step = (points.length - 1) / 7;
    return Array.from({ length: 8 }, (_, k) =>
      Math.min(points.length - 1, Math.round(k * step))
    );
  }, [points.length]);

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Accuracy trend across ${points.length} days`}
      style={{ display: 'block' }}
    >
      {[0, 25, 50, 75, 100].map((tick) => (
        <g key={tick}>
          <line
            x1={padL}
            x2={width - padR}
            y1={yAcc(tick)}
            y2={yAcc(tick)}
            stroke="var(--gray-a4)"
            strokeWidth={1}
          />
          <text
            x={padL - 6}
            y={yAcc(tick) + 3.5}
            textAnchor="end"
            fontSize="10"
            fill="var(--gray-10)"
          >
            {tick}%
          </text>
        </g>
      ))}

      {points.map((p, i) => {
        const total = p.fabrications + p.contradictions + p.omissions;
        const baseY = padT + innerH;
        const h = (total / maxIssues) * (innerH * 0.45);
        const fabH = total > 0 ? (p.fabrications / total) * h : 0;
        const conH = total > 0 ? (p.contradictions / total) * h : 0;
        return (
          <g key={p.date}>
            <title>{`${p.date}: ${p.accuracyPercent.toFixed(1)}% accuracy · ${p.fabrications} fabricated · ${p.contradictions} contradicted · ${p.omissions} omissions · ${p.messagesAudited} msgs`}</title>
            {total > 0 && (
              <>
                <rect
                  x={x(i) - barW / 2}
                  y={baseY - h}
                  width={barW}
                  height={fabH}
                  fill="var(--red-9)"
                  opacity={0.85}
                />
                <rect
                  x={x(i) - barW / 2}
                  y={baseY - h + fabH}
                  width={barW}
                  height={conH}
                  fill="var(--orange-9)"
                  opacity={0.85}
                />
                <rect
                  x={x(i) - barW / 2}
                  y={baseY - h + fabH + conH}
                  width={barW}
                  height={Math.max(h - fabH - conH, 0)}
                  fill="var(--amber-9)"
                  opacity={0.85}
                />
              </>
            )}
          </g>
        );
      })}

      <path d={area} fill="var(--accent-a3)" />
      <path
        d={line}
        fill="none"
        stroke="var(--accent-9)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {points.map((p, i) => (
        <g key={`dot-${p.date}`}>
          <title>{`${p.date}: ${p.accuracyPercent.toFixed(1)}% accuracy`}</title>
          <circle
            cx={x(i)}
            cy={yAcc(p.accuracyPercent)}
            r={3}
            fill="var(--accent-9)"
            stroke="var(--color-panel-solid)"
            strokeWidth={1.5}
          />
        </g>
      ))}

      {labelIdx.map((i) => (
        <text
          key={points[i].date}
          x={x(i)}
          y={height - 8}
          textAnchor="middle"
          fontSize="10"
          fill="var(--gray-10)"
        >
          {points[i].date.slice(5)}
        </text>
      ))}
    </svg>
  );
}

export function AccuracyTimelineCard({
  defaultPoints,
  models,
}: {
  defaultPoints: VerificationTimepointStat[];
  models: string[];
}) {
  const [selectedModel, setSelectedModel] = useState<string>(ALL_MODELS);

  const filteredQuery = useQuery({
    queryKey: ['verificationStats', { model: selectedModel }],
    queryFn: () => fetchVerificationStats({ model: selectedModel }),
    enabled: selectedModel !== ALL_MODELS,
    staleTime: 30000,
  });

  const points =
    selectedModel === ALL_MODELS
      ? defaultPoints
      : (filteredQuery.data?.overTime ?? []);
  const isLoading = selectedModel !== ALL_MODELS && filteredQuery.isLoading;

  return (
    <Card size="3">
      <Flex align="center" justify="between" gap="3" mb="1" wrap="wrap">
        <Flex align="center" gap="2">
          <TrendingUp size={16} style={{ color: 'var(--gray-11)' }} />
          <Heading size="3">Accuracy & Hallucinations Over Time</Heading>
        </Flex>
        <Select.Root value={selectedModel} onValueChange={setSelectedModel}>
          <Select.Trigger aria-label="Filter trend by model" />
          <Select.Content>
            <Select.Item value={ALL_MODELS}>All Models</Select.Item>
            {models.map((model) => (
              <Select.Item key={model} value={model}>
                {model}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      </Flex>
      <Text size="2" color="gray" mb="3" as="p">
        Daily claim accuracy with flagged issues stacked underneath.
      </Text>

      <Flex gap="4" mb="2" wrap="wrap">
        {[
          { label: 'Accuracy %', color: 'var(--accent-9)' },
          { label: 'Fabricated', color: 'var(--red-9)' },
          { label: 'Contradicted', color: 'var(--orange-9)' },
          { label: 'Omissions', color: 'var(--amber-9)' },
        ].map((item) => (
          <Flex key={item.label} align="center" gap="1">
            <span
              style={{
                width: '10px',
                height: '10px',
                borderRadius: 'var(--radius-full)',
                backgroundColor: item.color,
                display: 'inline-block',
              }}
            />
            <Text size="1" color="gray">
              {item.label}
            </Text>
          </Flex>
        ))}
      </Flex>

      {isLoading ? (
        <Flex align="center" justify="center" gap="2" py="6">
          <Spinner size="2" />
          <Text size="2" color="gray">
            Loading trend…
          </Text>
        </Flex>
      ) : filteredQuery.isError ? (
        <Flex align="center" justify="center" py="6">
          <Text size="2" color="red">
            Failed to load trend: {(filteredQuery.error as Error).message}
          </Text>
        </Flex>
      ) : points.length === 0 ? (
        <Flex align="center" justify="center" py="6">
          <Text size="2" color="gray">
            {selectedModel === ALL_MODELS
              ? 'No audited responses yet. Run a verification audit to see trends.'
              : `No audited responses for “${selectedModel}” yet.`}
          </Text>
        </Flex>
      ) : (
        <Box>
          <TrendChart points={points} />
        </Box>
      )}
    </Card>
  );
}
