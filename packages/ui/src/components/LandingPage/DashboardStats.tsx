// packages/ui/src/components/LandingPage/DashboardStats.tsx
//
// The four Sessions-page info boxes from the therascript-pointoni concept,
// backed by real session data: Sessions, Hours transcribed, Active clients
// (each with a 12-month sparkline) and Avg. session.
import React, { useMemo } from 'react';
import { Card, Flex, Grid, Text } from '@radix-ui/themes';
import { Library, Clock, UserRound, Timer } from 'lucide-react';
import type { Session } from '../../types';
import { computeDashboardStats } from '../../utils/dashboardStats';

function Sparkline({ data }: { data: number[] }) {
  const width = 120;
  const height = 28;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = data.length === 1 ? width : (i / (data.length - 1)) * width;
    const y = height - 3 - ((v - min) / range) * (height - 8);
    return [x, y] as const;
  });
  const line = pts
    .map(
      (p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`
    )
    .join(' ');
  const last = pts[pts.length - 1];
  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      <path
        d={line}
        fill="none"
        stroke="var(--accent-9)"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={last[0]} cy={last[1]} r={2.5} fill="var(--accent-9)" />
    </svg>
  );
}

interface StatCardProps {
  label: string;
  value: string;
  sub: React.ReactNode;
  icon: React.ReactNode;
  spark?: number[];
}

function StatCard({ label, value, sub, icon, spark }: StatCardProps) {
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
        style={{ marginTop: '4px', letterSpacing: '-0.02em' }}
      >
        {value}
      </Text>
      <Flex justify="between" align="end" gap="2" style={{ marginTop: '2px' }}>
        <Text size="1" color="gray">
          {sub}
        </Text>
        {spark && spark.some((v) => v > 0) && (
          <div style={{ width: '80px', flexShrink: 0 }}>
            <Sparkline data={spark} />
          </div>
        )}
      </Flex>
    </Card>
  );
}

export function DashboardStats({ sessions }: { sessions: Session[] }) {
  const stats = useMemo(() => computeDashboardStats(sessions), [sessions]);

  return (
    <Grid
      columns={{ initial: '2', lg: '4' }}
      gap="4"
      mb="6"
      style={{ width: '100%' }}
    >
      <StatCard
        label="Sessions"
        value={String(stats.totalSessions)}
        sub={
          <Text size="1" color="green">
            +{stats.sessionsThisMonth} this month
          </Text>
        }
        icon={<Library size={15} />}
        spark={stats.sessionsByMonth}
      />
      <StatCard
        label="Hours transcribed"
        value={stats.totalHoursLabel}
        sub={`${stats.completedCount} transcribed · ${stats.transcribingCount} in progress`}
        icon={<Clock size={15} />}
        spark={stats.hoursByMonth}
      />
      <StatCard
        label="Active clients"
        value={String(stats.activeClients)}
        sub={`${stats.newClientsThisMonth} new in ${stats.currentMonthLabel}`}
        icon={<UserRound size={15} />}
        spark={stats.clientsByMonth}
      />
      <StatCard
        label="Avg. session"
        value={stats.avgSessionLabel}
        sub={
          stats.avgSeconds === null
            ? 'No durations yet'
            : `median ${stats.medianSessionLabel}${
                stats.avgTokens !== null
                  ? ` · ${stats.avgTokens.toLocaleString()} tokens avg`
                  : ''
              }`
        }
        icon={<Timer size={15} />}
      />
    </Grid>
  );
}
