// packages/ui/src/utils/dashboardStats.ts
//
// Real-data backing for the four dashboard stat cards (mirroring the
// Sessions-page info boxes from the therascript-pointoni concept):
//   1. Sessions (+N this month, 12-month volume sparkline)
//   2. Hours transcribed (completed/transcribing sub-line, monthly-hours sparkline)
//   3. Active clients (N new this month, monthly-active-clients sparkline)
//   4. Avg. session (median + avg-tokens sub-line, no sparkline — like the concept)
//
// All month buckets are trailing 12 calendar months (oldest → newest),
// derived from `Session.date` (ISO string). Sessions with missing/invalid
// dates still count toward totals but are skipped for monthly bucketing.

import type { Session } from '../types';

export interface DashboardStats {
  totalSessions: number;
  sessionsThisMonth: number;
  sessionsByMonth: number[];

  totalSeconds: number;
  totalHoursLabel: string;
  completedCount: number;
  transcribingCount: number;
  hoursByMonth: number[];

  activeClients: number;
  newClientsThisMonth: number;
  currentMonthLabel: string;
  clientsByMonth: number[];

  avgSeconds: number | null;
  avgSessionLabel: string;
  medianSeconds: number | null;
  medianSessionLabel: string;
  avgTokens: number | null;
}

export const MONTH_BUCKETS = 12;

function monthKey(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

function parseDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/** Oldest → newest keys for the trailing 12 calendar months incl. `now`. */
export function trailingMonthKeys(now: Date): string[] {
  const keys: string[] = [];
  for (let i = MONTH_BUCKETS - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(monthKey(d.getFullYear(), d.getMonth()));
  }
  return keys;
}

export function formatHoursLabel(totalSeconds: number): string {
  const hours = totalSeconds / 3600;
  if (hours < 10) return `${Math.round(hours * 10) / 10}h`;
  return `${Math.round(hours)}h`;
}

/** "52m" below an hour, "1h 5m" above — matches the concept's compact style. */
export function formatSessionLengthLabel(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function computeDashboardStats(
  sessions: Session[],
  now: Date = new Date()
): DashboardStats {
  const keys = trailingMonthKeys(now);
  const keyIndex = new Map(keys.map((k, i) => [k, i]));
  const currentKey = keys[keys.length - 1];
  const currentMonthLabel = now.toLocaleString(undefined, { month: 'long' });

  const sessionsByMonth = new Array<number>(MONTH_BUCKETS).fill(0);
  const hoursByMonth = new Array<number>(MONTH_BUCKETS).fill(0);
  const clientsByMonthSets: Array<Set<string>> = Array.from(
    { length: MONTH_BUCKETS },
    () => new Set<string>()
  );

  let sessionsThisMonth = 0;
  let totalSeconds = 0;
  let completedCount = 0;
  let transcribingCount = 0;

  const durations: number[] = [];
  const tokenCounts: number[] = [];
  const clientFirstSeen = new Map<string, string>();
  const activeClients = new Set<string>();

  for (const s of sessions ?? []) {
    if (s.status === 'completed') completedCount++;
    if (s.status === 'transcribing' || s.status === 'queued') {
      transcribingCount++;
    }

    const duration =
      typeof s.duration === 'number' && !isNaN(s.duration) ? s.duration : null;
    if (duration !== null && duration > 0) {
      totalSeconds += duration;
      durations.push(duration);
    }
    if (
      typeof s.transcriptTokenCount === 'number' &&
      !isNaN(s.transcriptTokenCount) &&
      s.transcriptTokenCount > 0
    ) {
      tokenCounts.push(s.transcriptTokenCount);
    }

    const client = (s.clientName ?? '').trim();
    if (client) activeClients.add(client);

    const d = parseDate(s.date);
    if (!d) continue;
    const key = monthKey(d.getFullYear(), d.getMonth());
    const idx = keyIndex.get(key);
    if (idx === undefined) continue;

    sessionsByMonth[idx]++;
    if (duration !== null && duration > 0) {
      hoursByMonth[idx] += duration / 3600;
    }
    if (client) clientsByMonthSets[idx].add(client);

    if (key === currentKey) sessionsThisMonth++;
    if (client) {
      const prev = clientFirstSeen.get(client);
      if (prev === undefined || key < prev) clientFirstSeen.set(client, key);
    }
  }

  let newClientsThisMonth = 0;
  for (const first of clientFirstSeen.values()) {
    if (first === currentKey) newClientsThisMonth++;
  }

  const avgSeconds =
    durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : null;
  const medianSeconds = median(durations);
  const avgTokens =
    tokenCounts.length > 0
      ? Math.round(tokenCounts.reduce((a, b) => a + b, 0) / tokenCounts.length)
      : null;

  return {
    totalSessions: (sessions ?? []).length,
    sessionsThisMonth,
    sessionsByMonth,
    totalSeconds,
    totalHoursLabel: formatHoursLabel(totalSeconds),
    completedCount,
    transcribingCount,
    hoursByMonth: hoursByMonth.map((h) => Math.round(h * 10) / 10),
    activeClients: activeClients.size,
    newClientsThisMonth,
    currentMonthLabel,
    clientsByMonth: clientsByMonthSets.map((set) => set.size),
    avgSeconds,
    avgSessionLabel:
      avgSeconds === null ? '–' : formatSessionLengthLabel(avgSeconds),
    medianSeconds,
    medianSessionLabel:
      medianSeconds === null ? '–' : formatSessionLengthLabel(medianSeconds),
    avgTokens,
  };
}
