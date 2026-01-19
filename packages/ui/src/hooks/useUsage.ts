import { useQuery } from '@tanstack/react-query';
import {
  fetchUsageHistory,
  fetchUsageStats,
  fetchUsageLogs,
} from '../api/usage';
import type { UsageLogsParams } from '../api/usage';

export const useUsageHistory = (weeks?: number) => {
  return useQuery({
    queryKey: ['usage', 'history', weeks],
    queryFn: () => fetchUsageHistory(weeks),
    refetchOnWindowFocus: false,
  });
};

export const useUsageStats = () => {
  return useQuery({
    queryKey: ['usage', 'stats'],
    queryFn: () => fetchUsageStats(),
    refetchOnWindowFocus: false,
  });
};

export const useUsageLogs = (params: UsageLogsParams) => {
  return useQuery({
    queryKey: ['usage', 'logs', params],
    queryFn: () => fetchUsageLogs(params),
    refetchOnWindowFocus: false,
  });
};
