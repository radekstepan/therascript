// packages/ui/src/components/Verification/VerificationAnalyticsSection.tsx
//
// Global KPI cards + per-model accuracy + accuracy-over-time visualizations.
import React from 'react';
import { Card, Flex, Grid, Text } from '@radix-ui/themes';
import { BadgeCheck, OctagonAlert, ListX, ScanSearch } from 'lucide-react';
import type { VerificationGlobalStats } from '../../api/verification';
import { ModelAccuracyCard } from './ModelAccuracyCard';
import { AccuracyTimelineCard } from './AccuracyTimelineCard';

function KpiCard({
  label,
  value,
  sub,
  icon,
  accent,
}: {
  label: string;
  value: string;
  sub: React.ReactNode;
  icon: React.ReactNode;
  accent?: string;
}) {
  return (
    <Card size="2" style={{ width: '100%' }}>
      <Flex justify="between" align="center">
        <Text size="2" color="gray" weight="medium">
          {label}
        </Text>
        <Text color="gray">{icon}</Text>
      </Flex>
      <Text
        as="p"
        size="7"
        weight="bold"
        style={{
          marginTop: '4px',
          letterSpacing: '-0.02em',
          color: accent,
        }}
      >
        {value}
      </Text>
      <Text size="1" color="gray" as="p" style={{ marginTop: '2px' }}>
        {sub}
      </Text>
    </Card>
  );
}

export function VerificationAnalyticsSection({
  stats,
}: {
  stats: VerificationGlobalStats;
}) {
  const {
    overallAccuracyPercent,
    totalClaims,
    fabricatedClaims,
    contradictedClaims,
    partialClaims,
    omissions,
    totalMessagesAudited,
    unverifiedMessagesCount,
    sessionsSummary,
    byModel,
    overTime,
  } = stats;

  const badClaims = fabricatedClaims + contradictedClaims;
  const badPct = totalClaims > 0 ? (badClaims / totalClaims) * 100 : 0;
  const accuracyAccent =
    overallAccuracyPercent >= 92
      ? 'var(--green-11)'
      : overallAccuracyPercent >= 80
        ? 'var(--amber-11)'
        : 'var(--red-11)';

  const verifiedSessions = sessionsSummary.filter(
    (s) => s.isFullyVerified
  ).length;
  const totalSessions = sessionsSummary.length;

  return (
    <Flex direction="column" gap="4">
      <Grid columns={{ initial: '2', lg: '4' }} gap="4" width="100%">
        <KpiCard
          label="Global Fact Accuracy"
          value={`${overallAccuracyPercent.toFixed(1)}%`}
          sub={`${totalClaims.toLocaleString()} claims · ${partialClaims.toLocaleString()} partial`}
          icon={<BadgeCheck size={15} />}
          accent={accuracyAccent}
        />
        <KpiCard
          label="Fabrications & Contradictions"
          value={badClaims.toLocaleString()}
          sub={`${badPct.toFixed(1)}% of claims · ${fabricatedClaims} fabricated · ${contradictedClaims} contradicted`}
          icon={<OctagonAlert size={15} />}
          accent={badClaims > 0 ? 'var(--red-11)' : undefined}
        />
        <KpiCard
          label="Clinical Omissions"
          value={omissions.toLocaleString()}
          sub="Key transcript evidence missed by the AI"
          icon={<ListX size={15} />}
          accent={omissions > 0 ? 'var(--amber-11)' : undefined}
        />
        <KpiCard
          label="Audit Coverage"
          value={`${totalMessagesAudited} / ${totalMessagesAudited + unverifiedMessagesCount}`}
          sub={`${verifiedSessions} / ${totalSessions} transcripts fully verified`}
          icon={<ScanSearch size={15} />}
        />
      </Grid>

      <Flex
        direction="column"
        gap="4"
        width="100%"
        data-testid="accuracy-stack"
      >
        <AccuracyTimelineCard
          defaultPoints={overTime}
          models={byModel.map((m) => m.model)}
        />
        <ModelAccuracyCard stats={byModel} />
      </Flex>
    </Flex>
  );
}
