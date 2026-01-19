import axios from 'axios';

export interface UsageHistoryWeek {
  weekStart: number;
  weekEnd: number;
  llm: {
    totalPromptTokens: number;
    totalCompletionTokens: number;
    estimatedCost: number;
    callCount: number;
  };
  whisper: {
    totalDuration: number;
    estimatedCost: number;
    callCount: number;
  };
  totalCost: number;
}

export interface UsageHistoryResponse {
  weeks: UsageHistoryWeek[];
  pricing: {
    llm: Record<
      string,
      { promptCostPer1M: number; completionCostPer1M: number }
    >;
    whisper: Record<string, { costPerMinute: number }>;
  };
}

export interface UsageStats {
  llm: {
    totalPromptTokens: number;
    totalCompletionTokens: number;
    estimatedCost: number;
    callCount: number;
    callsByModel: Record<string, number>;
    callsBySource: Record<string, number>;
  };
  whisper: {
    totalDuration: number;
    estimatedCost: number;
    callCount: number;
    callsByModel: Record<string, number>;
  };
  totalEstimatedCost: number;
}

export interface UsageLog {
  id: number;
  type: 'llm' | 'whisper';
  source: string;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  duration: number | null;
  timestamp: number;
  estimatedCost: number;
}

export interface UsageLogsResponse {
  items: UsageLog[];
  total: number;
  limit: number;
  offset: number;
}

export interface UsageLogsParams {
  start?: number;
  end?: number;
  type?: 'llm' | 'whisper';
  model?: string;
  source?: string;
  limit?: number;
  offset?: number;
}

export const fetchUsageHistory = async (
  weeks?: number
): Promise<UsageHistoryResponse> => {
  const params = weeks !== undefined ? { weeks: weeks.toString() } : {};
  const response = await axios.get<UsageHistoryResponse>('/api/usage/history', {
    params,
  });
  return response.data;
};

export const fetchUsageStats = async (): Promise<UsageStats> => {
  const response = await axios.get<UsageStats>('/api/usage/stats');
  return response.data;
};

export const fetchUsageLogs = async (
  params: UsageLogsParams = {}
): Promise<UsageLogsResponse> => {
  const response = await axios.get<UsageLogsResponse>('/api/usage/logs', {
    params,
  });
  return response.data;
};
