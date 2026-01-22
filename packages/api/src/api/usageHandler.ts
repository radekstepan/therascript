import {
  usageRepository,
  type WeeklyAggregate,
  type WeeklyAggregateByModel,
  type UsageTotalsByModel,
} from '@therascript/data';
import {
  pricing,
  type LlmModelPricing,
  type WhisperModelPricing,
} from '@therascript/config';
import { BadRequestError } from '../errors.js';

interface UsageHistoryWeek {
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

interface UsageHistoryResponse {
  weeks: UsageHistoryWeek[];
  pricing: {
    llm: Record<
      string,
      { promptCostPer1M: number; completionCostPer1M: number }
    >;
    whisper: Record<string, { costPerMinute: number }>;
  };
}

interface UsageStatsResponse {
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

interface UsageLogsParams {
  start?: number;
  end?: number;
  type?: 'llm' | 'whisper';
  model?: string;
  source?: string;
  limit?: number;
  offset?: number;
}

interface UsageQueryParams {
  weeks?: string | number;
  start?: string | number;
  end?: string | number;
  type?: string;
  model?: string;
  source?: string;
  limit?: string | number;
  offset?: string | number;
}

interface UsageHandlerContext {
  query: UsageQueryParams;
  set: { status?: number | string };
}

interface UsageLogWithCost {
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

interface UsageLogsResponse {
  items: UsageLogWithCost[];
  total: number;
  limit: number;
  offset: number;
}

function getWeekStart(date: Date): number {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  d.setUTCDate(diff);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

function getWeekEnd(weekStart: number): number {
  return (
    weekStart +
    6 * 24 * 60 * 60 * 1000 +
    23 * 60 * 60 * 1000 +
    59 * 60 * 1000 +
    999
  );
}

function getLlmPricing(model: string): LlmModelPricing {
  return pricing.llm[model] || pricing.llm['default'];
}

function getWhisperPricing(model: string): WhisperModelPricing {
  return pricing.whisper[model] || pricing.whisper['default'];
}

function calculateLlmCost(
  model: string,
  promptTokens: number | null,
  completionTokens: number | null
): number {
  if (promptTokens === null || completionTokens === null) return 0;
  const { promptCostPer1M, completionCostPer1M } = getLlmPricing(model);
  const promptCost = (promptTokens / 1000000) * promptCostPer1M;
  const completionCost = (completionTokens / 1000000) * completionCostPer1M;
  return promptCost + completionCost;
}

function calculateWhisperCost(model: string, duration: number | null): number {
  if (duration === null) return 0;
  const { costPerMinute } = getWhisperPricing(model);
  return (duration / 60) * costPerMinute;
}

export const getUsageHistory = async ({
  query,
  set,
}: UsageHandlerContext): Promise<UsageHistoryResponse> => {
  let weeks = parseInt(String(query.weeks || '12'), 10);
  if (isNaN(weeks)) weeks = 12;
  if (weeks < 1) weeks = 1;
  if (weeks > 52) weeks = 52;

  const now = Date.now();
  const endWeekStart = getWeekStart(new Date(now));
  const startWeekStart = endWeekStart - (weeks - 1) * 7 * 24 * 60 * 60 * 1000;

  console.log('[UsageHistory] Query range:', {
    weeks,
    startWeekStart: new Date(startWeekStart).toISOString(),
    endWeekStart: new Date(endWeekStart).toISOString(),
    queryEnd: new Date(endWeekStart + 7 * 24 * 60 * 60 * 1000).toISOString(),
  });

  const aggregates = usageRepository.getWeeklyAggregates({
    start: startWeekStart,
    end: endWeekStart + 7 * 24 * 60 * 60 * 1000,
    groupByModel: true,
  }) as WeeklyAggregateByModel[];

  console.log(
    '[UsageHistory] Aggregates returned:',
    aggregates.length,
    aggregates.map((a) => ({
      weekStart: new Date(a.weekStart).toISOString(),
      type: a.type,
      model: a.model,
      callCount: a.callCount,
    }))
  );

  const weekModelMap = new Map<number, Map<string, WeeklyAggregateByModel>>();
  for (const agg of aggregates) {
    if (!weekModelMap.has(agg.weekStart)) {
      weekModelMap.set(agg.weekStart, new Map());
    }
    weekModelMap.get(agg.weekStart)!.set(agg.model, agg);
  }

  console.log(
    '[UsageHistory] Week model map keys:',
    Array.from(weekModelMap.keys()).map((k) => new Date(k).toISOString())
  );

  const weeksResponse: UsageHistoryWeek[] = [];
  for (let i = 0; i < weeks; i++) {
    const weekStart = startWeekStart + i * 7 * 24 * 60 * 60 * 1000;
    const weekEnd = getWeekEnd(weekStart);

    let modelAggs = weekModelMap.get(weekStart);

    if (!modelAggs) {
      const tolerance = 3600000;
      let closestKey: number | null = null;
      let closestDistance = tolerance;

      for (const key of weekModelMap.keys()) {
        const distance = Math.abs(key - weekStart);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestKey = key;
        }
      }

      if (closestKey !== null) {
        modelAggs = weekModelMap.get(closestKey)!;
        console.log(
          `[UsageHistory] Week ${i}: Using fuzzy match for ${new Date(weekStart).toISOString()}, matched with ${new Date(closestKey!).toISOString()} (distance: ${closestDistance}ms)`
        );
      }
    }

    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalDuration = 0;
    let llmCallCount = 0;
    let whisperCallCount = 0;
    let totalLlmCost = 0;
    let totalWhisperCost = 0;

    if (modelAggs) {
      for (const [model, agg] of modelAggs.entries()) {
        if (agg.type === 'llm') {
          totalPromptTokens += agg.totalPromptTokens;
          totalCompletionTokens += agg.totalCompletionTokens;
          llmCallCount += agg.callCount;
          const llmCost = calculateLlmCost(
            model,
            agg.totalPromptTokens,
            agg.totalCompletionTokens
          );
          totalLlmCost += llmCost;
        } else {
          totalDuration += agg.totalDuration;
          whisperCallCount += agg.callCount;
          const whisperCost = calculateWhisperCost(model, agg.totalDuration);
          totalWhisperCost += whisperCost;
        }
      }
    }

    if (modelAggs || totalLlmCost > 0 || totalWhisperCost > 0) {
      console.log(`[UsageHistory] Week ${i}:`, {
        weekStart: new Date(weekStart).toISOString(),
        weekEnd: new Date(weekEnd).toISOString(),
        foundModelAggs: modelAggs !== undefined,
        modelCount: modelAggs?.size || 0,
        llmCost: totalLlmCost,
        whisperCost: totalWhisperCost,
        totalCost: totalLlmCost + totalWhisperCost,
      });
    } else {
      console.log(`[UsageHistory] Week ${i} (empty):`, {
        weekStart: new Date(weekStart).toISOString(),
        weekEnd: new Date(weekEnd).toISOString(),
        foundModelAggs: modelAggs !== undefined,
      });
    }

    weeksResponse.push({
      weekStart,
      weekEnd,
      llm: {
        totalPromptTokens,
        totalCompletionTokens,
        estimatedCost: totalLlmCost,
        callCount: llmCallCount,
      },
      whisper: {
        totalDuration,
        estimatedCost: totalWhisperCost,
        callCount: whisperCallCount,
      },
      totalCost: totalLlmCost + totalWhisperCost,
    });
  }

  set.status = 200;
  return {
    weeks: weeksResponse,
    pricing: {
      llm: pricing.llm as Record<
        string,
        { promptCostPer1M: number; completionCostPer1M: number }
      >,
      whisper: pricing.whisper as Record<string, { costPerMinute: number }>,
    },
  };
};

export const getUsageStats = async ({
  set,
}: Omit<UsageHandlerContext, 'query'>): Promise<UsageStatsResponse> => {
  const totals = usageRepository.getTotals({
    groupByModel: true,
  }) as UsageTotalsByModel[];
  const totalsWithoutGroupBy = usageRepository.getTotals({
    groupByModel: false,
  }) as Exclude<
    ReturnType<typeof usageRepository.getTotals>,
    UsageTotalsByModel[]
  >;

  let totalLlmCost = 0;
  let totalWhisperCost = 0;

  for (const agg of totals) {
    if (agg.type === 'llm') {
      totalLlmCost += calculateLlmCost(
        agg.model,
        agg.totalPromptTokens,
        agg.totalCompletionTokens
      );
    } else {
      totalWhisperCost += calculateWhisperCost(agg.model, agg.totalDuration);
    }
  }

  set.status = 200;
  return {
    llm: {
      totalPromptTokens: totalsWithoutGroupBy.llm.totalPromptTokens,
      totalCompletionTokens: totalsWithoutGroupBy.llm.totalCompletionTokens,
      estimatedCost: totalLlmCost,
      callCount: totalsWithoutGroupBy.llm.callCount,
      callsByModel: totalsWithoutGroupBy.llm.callsByModel,
      callsBySource: totalsWithoutGroupBy.llm.callsBySource,
    },
    whisper: {
      totalDuration: totalsWithoutGroupBy.whisper.totalDuration,
      estimatedCost: totalWhisperCost,
      callCount: totalsWithoutGroupBy.whisper.callCount,
      callsByModel: totalsWithoutGroupBy.whisper.callsByModel,
    },
    totalEstimatedCost: totalLlmCost + totalWhisperCost,
  };
};

export const getUsageLogs = async ({
  query,
  set,
}: UsageHandlerContext): Promise<UsageLogsResponse> => {
  let limit = parseInt(String(query.limit || '50'), 10);
  let offset = parseInt(String(query.offset || '0'), 10);

  if (isNaN(limit) || limit < 1) limit = 50;
  if (limit > 200) limit = 200;
  if (isNaN(offset) || offset < 0) offset = 0;

  const start =
    query.start !== undefined ? parseInt(String(query.start), 10) : undefined;
  const end =
    query.end !== undefined ? parseInt(String(query.end), 10) : undefined;

  if (start !== undefined && (isNaN(start) || start < 0)) {
    throw new BadRequestError('Invalid start timestamp');
  }
  if (end !== undefined && (isNaN(end) || end < 0)) {
    throw new BadRequestError('Invalid end timestamp');
  }

  const result = usageRepository.getUsageLogs({
    start,
    end,
    limit,
    offset,
    type: query.type as 'llm' | 'whisper' | undefined,
    model: query.model,
    source: query.source,
  });

  const itemsWithCost = result.items.map((item) => ({
    ...item,
    estimatedCost:
      item.type === 'llm'
        ? calculateLlmCost(item.model, item.promptTokens, item.completionTokens)
        : calculateWhisperCost(item.model, item.duration),
  }));

  set.status = 200;
  return {
    items: itemsWithCost,
    total: result.total,
    limit,
    offset,
  };
};
