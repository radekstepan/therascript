import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BadRequestError } from '../errors.js';

// Hoist mock config so it's available at module-init time.
const { mockPricing } = vi.hoisted(() => ({
  mockPricing: {
    llm: {
      'gemma3:4b': { promptCostPer1M: 0.01703, completionCostPer1M: 0.06815 },
      'gemma3:12b': { promptCostPer1M: 0.03, completionCostPer1M: 0.1 },
      default: { promptCostPer1M: 0.15, completionCostPer1M: 0.6 },
    },
    whisper: {
      large: { costPerMinute: 0.011 },
      default: { costPerMinute: 0.011 },
    },
  },
}));

vi.mock('@therascript/config', () => ({
  default: { pricing: mockPricing },
  pricing: mockPricing,
}));

// Hoist the repository mock so individual tests can override return values.
const { mockRepo } = vi.hoisted(() => ({
  mockRepo: {
    getWeeklyAggregates: vi.fn(),
    getTotals: vi.fn(),
    getUsageLogs: vi.fn(),
  },
}));

vi.mock('@therascript/data', () => ({
  usageRepository: mockRepo,
}));

const { getUsageHistory, getUsageStats, getUsageLogs } = await import(
  './usageHandler.js'
);

/**
 * Reference Monday at 12:00 UTC. Pinning `Date.now()` to this instant makes
 * the handler's `endWeekStart` deterministic and lets us assert against a
 * known week boundary.
 */
const REF_MONDAY_NOON_MS = Date.UTC(2024, 0, 1, 12, 0, 0);
const REF_MONDAY_START_MS = Date.UTC(2024, 0, 1, 0, 0, 0); // 00:00 UTC same day
const DAY_MS = 24 * 60 * 60 * 1000;

describe('usageHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(REF_MONDAY_NOON_MS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getWeekStart (Mon-anchored UTC week boundary) — observed via getUsageHistory', () => {
    it('a Monday at noon lands on the same Monday at 00:00 UTC', async () => {
      mockRepo.getWeeklyAggregates.mockReturnValue([]);
      await getUsageHistory({
        query: { weeks: '1' },
        set: { status: 0 },
      } as any);
      // endWeekStart = getWeekStart(now) = REF_MONDAY_START_MS
      // The query window is [start, end) where end = endWeekStart + 7d
      const call = mockRepo.getWeeklyAggregates.mock.calls[0]![0]!;
      expect(call.end - 7 * DAY_MS).toBe(REF_MONDAY_START_MS);
    });

    it('a Sunday belongs to the week that started on the PRIOR Monday (ISO Mon-Sun weeks)', async () => {
      // 2023-12-31 00:00:00Z is a Sunday
      // ISO interpretation: Sunday is the LAST day of the week that began
      // on the previous Monday (2023-12-25), not the upcoming Monday
      // (2024-01-01). The handler implements this.
      const sunday = REF_MONDAY_START_MS - DAY_MS;
      vi.setSystemTime(sunday);

      const priorMonday = REF_MONDAY_START_MS - 7 * DAY_MS; // 2023-12-25

      mockRepo.getWeeklyAggregates.mockReturnValue([]);
      await getUsageHistory({
        query: { weeks: '1' },
        set: { status: 0 },
      } as any);

      const call = mockRepo.getWeeklyAggregates.mock.calls[0]![0]!;
      expect(call.end - 7 * DAY_MS).toBe(priorMonday);
    });

    it('a Wednesday rolls back to the same Monday', async () => {
      // 2024-01-03 12:00:00Z is a Wednesday
      const wednesday = REF_MONDAY_NOON_MS + 2 * DAY_MS;
      vi.setSystemTime(wednesday);

      mockRepo.getWeeklyAggregates.mockReturnValue([]);
      await getUsageHistory({
        query: { weeks: '1' },
        set: { status: 0 },
      } as any);

      const call = mockRepo.getWeeklyAggregates.mock.calls[0]![0]!;
      expect(call.end - 7 * DAY_MS).toBe(REF_MONDAY_START_MS);
    });

    it("a Saturday rolls back one day to Friday's Monday", async () => {
      // 2024-01-06 12:00:00Z is a Saturday
      const saturday = REF_MONDAY_NOON_MS + 5 * DAY_MS;
      vi.setSystemTime(saturday);

      mockRepo.getWeeklyAggregates.mockReturnValue([]);
      await getUsageHistory({
        query: { weeks: '1' },
        set: { status: 0 },
      } as any);

      const call = mockRepo.getWeeklyAggregates.mock.calls[0]![0]!;
      expect(call.end - 7 * DAY_MS).toBe(REF_MONDAY_START_MS);
    });
  });

  describe('getUsageHistory — query parameter parsing', () => {
    beforeEach(() => {
      mockRepo.getWeeklyAggregates.mockReturnValue([]);
    });

    it('defaults to 12 weeks when no `weeks` is given', async () => {
      const res = await getUsageHistory({
        query: {},
        set: { status: 0 },
      } as any);
      expect(res.weeks).toHaveLength(12);
    });

    it('clamps to a minimum of 1 week', async () => {
      const res = await getUsageHistory({
        query: { weeks: '0' },
        set: { status: 0 },
      } as any);
      expect(res.weeks).toHaveLength(1);
    });

    it('clamps to a maximum of 52 weeks', async () => {
      const res = await getUsageHistory({
        query: { weeks: '999' },
        set: { status: 0 },
      } as any);
      expect(res.weeks).toHaveLength(52);
    });

    it('falls back to 12 when weeks is NaN', async () => {
      const res = await getUsageHistory({
        query: { weeks: 'not-a-number' },
        set: { status: 0 },
      } as any);
      expect(res.weeks).toHaveLength(12);
    });

    it('passes the expected SQL window to the repository', async () => {
      await getUsageHistory({
        query: { weeks: '3' },
        set: { status: 0 },
      } as any);

      const call = mockRepo.getWeeklyAggregates.mock.calls[0]![0]!;
      expect(call.end - call.start).toBe(3 * 7 * DAY_MS);
      expect(call.groupByModel).toBe(true);
    });

    it('returns the pricing config verbatim in the response', async () => {
      const res = await getUsageHistory({
        query: { weeks: '1' },
        set: { status: 0 },
      } as any);
      expect(res.pricing.llm['gemma3:4b']).toEqual(
        mockPricing.llm['gemma3:4b']
      );
      expect(res.pricing.whisper.large).toEqual(mockPricing.whisper.large);
    });
  });

  describe('getUsageHistory — cost & aggregation math', () => {
    it('sums LLM cost across multiple models in a single week', async () => {
      mockRepo.getWeeklyAggregates.mockReturnValue([
        {
          weekStart: REF_MONDAY_START_MS,
          weekEnd: REF_MONDAY_START_MS + 7 * DAY_MS - 1,
          type: 'llm',
          model: 'gemma3:4b',
          totalPromptTokens: 1_000_000,
          totalCompletionTokens: 1_000_000,
          totalDuration: 0,
          callCount: 5,
        },
        {
          weekStart: REF_MONDAY_START_MS,
          weekEnd: REF_MONDAY_START_MS + 7 * DAY_MS - 1,
          type: 'llm',
          model: 'gemma3:12b',
          totalPromptTokens: 2_000_000,
          totalCompletionTokens: 500_000,
          totalDuration: 0,
          callCount: 3,
        },
      ]);

      const res = await getUsageHistory({
        query: { weeks: '1' },
        set: { status: 0 },
      } as any);

      const w0 = res.weeks[0]!;
      // gemma3:4b:  1M * 0.01703 + 1M * 0.06815 = 0.08518
      // gemma3:12b: 2M * 0.03   + 0.5M * 0.1   = 0.11000
      // total: 0.19518
      expect(w0.llm.estimatedCost).toBeCloseTo(0.19518, 5);
      expect(w0.llm.totalPromptTokens).toBe(3_000_000);
      expect(w0.llm.totalCompletionTokens).toBe(1_500_000);
      expect(w0.llm.callCount).toBe(8);
      expect(w0.totalCost).toBeCloseTo(0.19518, 5);
    });

    it('aggregates whisper duration and cost per week', async () => {
      mockRepo.getWeeklyAggregates.mockReturnValue([
        {
          weekStart: REF_MONDAY_START_MS,
          weekEnd: REF_MONDAY_START_MS + 7 * DAY_MS - 1,
          type: 'whisper',
          model: 'large',
          totalPromptTokens: 0,
          totalCompletionTokens: 0,
          totalDuration: 60 * 5, // 5 minutes
          callCount: 2,
        },
      ]);

      const res = await getUsageHistory({
        query: { weeks: '1' },
        set: { status: 0 },
      } as any);

      const w0 = res.weeks[0]!;
      expect(w0.whisper.totalDuration).toBe(300);
      expect(w0.whisper.callCount).toBe(2);
      // 5 min * 0.011 / min = 0.055
      expect(w0.whisper.estimatedCost).toBeCloseTo(0.055, 5);
      expect(w0.totalCost).toBeCloseTo(0.055, 5);
    });

    it('falls back to default LLM pricing when the model is unknown', async () => {
      mockRepo.getWeeklyAggregates.mockReturnValue([
        {
          weekStart: REF_MONDAY_START_MS,
          weekEnd: REF_MONDAY_START_MS + 7 * DAY_MS - 1,
          type: 'llm',
          model: 'some-future-model',
          totalPromptTokens: 1_000_000,
          totalCompletionTokens: 0,
          totalDuration: 0,
          callCount: 1,
        },
      ]);

      const res = await getUsageHistory({
        query: { weeks: '1' },
        set: { status: 0 },
      } as any);

      // default: 0.15 per 1M prompt, 0.6 per 1M completion
      expect(res.weeks[0]!.llm.estimatedCost).toBeCloseTo(0.15, 5);
    });

    it('returns 0 cost for an LLM week with zero tokens (defensive)', async () => {
      mockRepo.getWeeklyAggregates.mockReturnValue([
        {
          weekStart: REF_MONDAY_START_MS,
          weekEnd: REF_MONDAY_START_MS + 7 * DAY_MS - 1,
          type: 'llm',
          model: 'gemma3:4b',
          totalPromptTokens: 0,
          totalCompletionTokens: 0,
          totalDuration: 0,
          callCount: 1,
        },
      ]);

      const res = await getUsageHistory({
        query: { weeks: '1' },
        set: { status: 0 },
      } as any);

      expect(res.weeks[0]!.llm.estimatedCost).toBe(0);
      expect(res.weeks[0]!.totalCost).toBe(0);
    });

    it('returns 0 cost for a whisper week with 0 duration (defensive)', async () => {
      mockRepo.getWeeklyAggregates.mockReturnValue([
        {
          weekStart: REF_MONDAY_START_MS,
          weekEnd: REF_MONDAY_START_MS + 7 * DAY_MS - 1,
          type: 'whisper',
          model: 'large',
          totalPromptTokens: 0,
          totalCompletionTokens: 0,
          totalDuration: 0,
          callCount: 0,
        },
      ]);

      const res = await getUsageHistory({
        query: { weeks: '1' },
        set: { status: 0 },
      } as any);

      expect(res.weeks[0]!.whisper.estimatedCost).toBe(0);
      expect(res.weeks[0]!.totalCost).toBe(0);
    });

    it('returns zeroed weeks when there is no usage data at all', async () => {
      mockRepo.getWeeklyAggregates.mockReturnValue([]);

      const res = await getUsageHistory({
        query: { weeks: '4' },
        set: { status: 0 },
      } as any);

      expect(res.weeks).toHaveLength(4);
      res.weeks.forEach((w) => {
        expect(w.llm.estimatedCost).toBe(0);
        expect(w.whisper.estimatedCost).toBe(0);
        expect(w.totalCost).toBe(0);
        expect(w.llm.callCount).toBe(0);
        expect(w.whisper.callCount).toBe(0);
      });
    });
  });

  describe('getUsageHistory — fuzzy week matching (1h tolerance)', () => {
    it('matches an aggregate whose weekStart is within the 1h tolerance', async () => {
      // Repository returns a row whose weekStart is 30 minutes later
      // (e.g. SQL rounds to a slightly different boundary than JS).
      const fuzzyKey = REF_MONDAY_START_MS + 30 * 60 * 1000;

      mockRepo.getWeeklyAggregates.mockReturnValue([
        {
          weekStart: fuzzyKey,
          weekEnd: fuzzyKey + 7 * DAY_MS - 1,
          type: 'llm',
          model: 'gemma3:4b',
          totalPromptTokens: 1_000_000,
          totalCompletionTokens: 0,
          totalDuration: 0,
          callCount: 1,
        },
      ]);

      const res = await getUsageHistory({
        query: { weeks: '1' },
        set: { status: 0 },
      } as any);

      // Should have found the row via fuzzy match and applied the cost.
      expect(res.weeks[0]!.llm.estimatedCost).toBeCloseTo(0.01703, 5);
      expect(res.weeks[0]!.llm.callCount).toBe(1);
    });

    it('does NOT match a weekStart beyond the 1h tolerance', async () => {
      // 2 hours off — well outside the 3600000ms tolerance.
      const tooFar = REF_MONDAY_START_MS + 2 * 60 * 60 * 1000;

      mockRepo.getWeeklyAggregates.mockReturnValue([
        {
          weekStart: tooFar,
          weekEnd: tooFar + 7 * DAY_MS - 1,
          type: 'llm',
          model: 'gemma3:4b',
          totalPromptTokens: 1_000_000,
          totalCompletionTokens: 0,
          totalDuration: 0,
          callCount: 1,
        },
      ]);

      const res = await getUsageHistory({
        query: { weeks: '1' },
        set: { status: 0 },
      } as any);

      // No match → no cost applied
      expect(res.weeks[0]!.llm.estimatedCost).toBe(0);
      expect(res.weeks[0]!.llm.callCount).toBe(0);
    });

    it('chooses the closest key when multiple are within tolerance', async () => {
      // 10 minutes and 50 minutes off — 10 min should win
      const keyA = REF_MONDAY_START_MS + 10 * 60 * 1000;
      const keyB = REF_MONDAY_START_MS + 50 * 60 * 1000;

      mockRepo.getWeeklyAggregates.mockReturnValue([
        {
          weekStart: keyA,
          weekEnd: keyA + 7 * DAY_MS - 1,
          type: 'llm',
          model: 'gemma3:4b',
          totalPromptTokens: 1_000_000,
          totalCompletionTokens: 0,
          totalDuration: 0,
          callCount: 1,
        },
        {
          weekStart: keyB,
          weekEnd: keyB + 7 * DAY_MS - 1,
          type: 'llm',
          model: 'gemma3:12b',
          totalPromptTokens: 2_000_000,
          totalCompletionTokens: 0,
          totalDuration: 0,
          callCount: 1,
        },
      ]);

      const res = await getUsageHistory({
        query: { weeks: '1' },
        set: { status: 0 },
      } as any);

      // keyA (gemma3:4b at +10 min) is closer than keyB (gemma3:12b at +50 min),
      // so only the gemma3:4b row's data is applied to this week.
      expect(res.weeks[0]!.llm.estimatedCost).toBeCloseTo(0.01703, 5);
      expect(res.weeks[0]!.llm.callCount).toBe(1);
    });
  });

  describe('getUsageStats', () => {
    it('sums cost across LLM and whisper and reports a grand total', async () => {
      mockRepo.getTotals
        // groupByModel=true — used for cost calculation
        .mockReturnValueOnce([
          {
            type: 'llm',
            model: 'gemma3:4b',
            totalPromptTokens: 1_000_000,
            totalCompletionTokens: 1_000_000,
            totalDuration: 0,
            callCount: 1,
          },
          {
            type: 'whisper',
            model: 'large',
            totalPromptTokens: 0,
            totalCompletionTokens: 0,
            totalDuration: 600, // 10 min
            callCount: 1,
          },
        ])
        // groupByModel=false — used for headline totals
        .mockReturnValueOnce({
          llm: {
            totalPromptTokens: 1_000_000,
            totalCompletionTokens: 1_000_000,
            callCount: 1,
            callsByModel: { 'gemma3:4b': 1 },
            callsBySource: { session_chat: 1 },
          },
          whisper: {
            totalDuration: 600,
            callCount: 1,
            callsByModel: { large: 1 },
          },
        });

      const res = await getUsageStats({ set: { status: 0 } } as any);

      // gemma3:4b: 1M*0.01703 + 1M*0.06815 = 0.08518
      // whisper: 10 * 0.011 = 0.11
      // total: 0.19518
      expect(res.llm.estimatedCost).toBeCloseTo(0.08518, 5);
      expect(res.whisper.estimatedCost).toBeCloseTo(0.11, 5);
      expect(res.totalEstimatedCost).toBeCloseTo(0.19518, 5);

      // Roll-ups are forwarded from the non-grouped query
      expect(res.llm.totalPromptTokens).toBe(1_000_000);
      expect(res.llm.callsByModel).toEqual({ 'gemma3:4b': 1 });
      expect(res.llm.callsBySource).toEqual({ session_chat: 1 });
      expect(res.whisper.totalDuration).toBe(600);
      expect(res.whisper.callsByModel).toEqual({ large: 1 });
    });

    it('returns zeroed totals when there is no usage', async () => {
      mockRepo.getTotals.mockReturnValueOnce([]).mockReturnValueOnce({
        llm: {
          totalPromptTokens: 0,
          totalCompletionTokens: 0,
          callCount: 0,
          callsByModel: {},
          callsBySource: {},
        },
        whisper: {
          totalDuration: 0,
          callCount: 0,
          callsByModel: {},
        },
      });

      const res = await getUsageStats({ set: { status: 0 } } as any);

      expect(res.llm.estimatedCost).toBe(0);
      expect(res.whisper.estimatedCost).toBe(0);
      expect(res.totalEstimatedCost).toBe(0);
    });

    it('uses default whisper pricing when an unknown model appears', async () => {
      mockRepo.getTotals
        .mockReturnValueOnce([
          {
            type: 'whisper',
            model: 'whisper-quantized-future',
            totalPromptTokens: 0,
            totalCompletionTokens: 0,
            totalDuration: 120, // 2 min
            callCount: 1,
          },
        ])
        .mockReturnValueOnce({
          llm: {
            totalPromptTokens: 0,
            totalCompletionTokens: 0,
            callCount: 0,
            callsByModel: {},
            callsBySource: {},
          },
          whisper: {
            totalDuration: 120,
            callCount: 1,
            callsByModel: { 'whisper-quantized-future': 1 },
          },
        });

      const res = await getUsageStats({ set: { status: 0 } } as any);

      // default whisper: 0.011/min → 2 * 0.011 = 0.022
      expect(res.whisper.estimatedCost).toBeCloseTo(0.022, 5);
    });
  });

  describe('getUsageLogs', () => {
    it('caps limit at 200 and floors to 50 (the default) when below 1', async () => {
      mockRepo.getUsageLogs.mockReturnValue({
        items: [],
        total: 0,
        limit: 0,
        offset: 0,
      });

      await getUsageLogs({
        query: { limit: '99999' },
        set: { status: 0 },
      } as any);
      expect(mockRepo.getUsageLogs.mock.calls[0]![0]!.limit).toBe(200);

      await getUsageLogs({
        query: { limit: '0' },
        set: { status: 0 },
      } as any);
      // The implementation guards `limit < 1` and falls back to 50.
      expect(mockRepo.getUsageLogs.mock.calls[1]![0]!.limit).toBe(50);

      await getUsageLogs({
        query: { limit: 'banana' },
        set: { status: 0 },
      } as any);
      expect(mockRepo.getUsageLogs.mock.calls[2]![0]!.limit).toBe(50);
    });

    it('clamps negative offset to 0', async () => {
      mockRepo.getUsageLogs.mockReturnValue({
        items: [],
        total: 0,
        limit: 50,
        offset: 0,
      });

      await getUsageLogs({
        query: { offset: '-5' },
        set: { status: 0 },
      } as any);
      expect(mockRepo.getUsageLogs.mock.calls[0]![0]!.offset).toBe(0);
    });

    it('rejects a negative start timestamp with BadRequestError', async () => {
      await expect(
        getUsageLogs({
          query: { start: '-1' },
          set: { status: 0 },
        } as any)
      ).rejects.toBeInstanceOf(BadRequestError);
    });

    it('rejects a negative end timestamp with BadRequestError', async () => {
      await expect(
        getUsageLogs({
          query: { end: '-1' },
          set: { status: 0 },
        } as any)
      ).rejects.toBeInstanceOf(BadRequestError);
    });

    it('forwards valid start/end/type/model/source to the repository', async () => {
      mockRepo.getUsageLogs.mockReturnValue({
        items: [],
        total: 0,
        limit: 50,
        offset: 0,
      });

      await getUsageLogs({
        query: {
          start: '100',
          end: '200',
          type: 'llm',
          model: 'gemma3:4b',
          source: 'session_chat',
        },
        set: { status: 0 },
      } as any);

      const call = mockRepo.getUsageLogs.mock.calls[0]![0]!;
      expect(call).toMatchObject({
        start: 100,
        end: 200,
        type: 'llm',
        model: 'gemma3:4b',
        source: 'session_chat',
      });
    });

    it('computes estimatedCost per log item based on its type/model', async () => {
      mockRepo.getUsageLogs.mockReturnValue({
        items: [
          {
            id: 1,
            type: 'llm',
            source: 'session_chat',
            model: 'gemma3:4b',
            promptTokens: 1_000_000,
            completionTokens: 0,
            duration: null,
            timestamp: 100,
          },
          {
            id: 2,
            type: 'whisper',
            source: 'transcription',
            model: 'large',
            promptTokens: null,
            completionTokens: null,
            duration: 60, // 1 min
            timestamp: 200,
          },
        ],
        total: 2,
        limit: 50,
        offset: 0,
      });

      const res = await getUsageLogs({
        query: {},
        set: { status: 0 },
      } as any);

      // 1M * 0.01703 = 0.01703
      expect(res.items[0]!.estimatedCost).toBeCloseTo(0.01703, 5);
      // 1 min * 0.011 = 0.011
      expect(res.items[1]!.estimatedCost).toBeCloseTo(0.011, 5);
      expect(res.total).toBe(2);
    });

    it('returns 0 cost for LLM items with null token counts', async () => {
      mockRepo.getUsageLogs.mockReturnValue({
        items: [
          {
            id: 1,
            type: 'llm',
            source: 'session_chat',
            model: 'gemma3:4b',
            promptTokens: null,
            completionTokens: null,
            duration: null,
            timestamp: 100,
          },
        ],
        total: 1,
        limit: 50,
        offset: 0,
      });

      const res = await getUsageLogs({
        query: {},
        set: { status: 0 },
      } as any);

      expect(res.items[0]!.estimatedCost).toBe(0);
    });

    it('returns 0 cost for whisper items with null duration', async () => {
      mockRepo.getUsageLogs.mockReturnValue({
        items: [
          {
            id: 1,
            type: 'whisper',
            source: 'transcription',
            model: 'large',
            promptTokens: null,
            completionTokens: null,
            duration: null,
            timestamp: 100,
          },
        ],
        total: 1,
        limit: 50,
        offset: 0,
      });

      const res = await getUsageLogs({
        query: {},
        set: { status: 0 },
      } as any);

      expect(res.items[0]!.estimatedCost).toBe(0);
    });

    it('uses default pricing for unknown models in log items', async () => {
      mockRepo.getUsageLogs.mockReturnValue({
        items: [
          {
            id: 1,
            type: 'llm',
            source: 'session_chat',
            model: 'unknown-model',
            promptTokens: 1_000_000,
            completionTokens: 0,
            duration: null,
            timestamp: 100,
          },
        ],
        total: 1,
        limit: 50,
        offset: 0,
      });

      const res = await getUsageLogs({
        query: {},
        set: { status: 0 },
      } as any);

      // default: 0.15 per 1M prompt
      expect(res.items[0]!.estimatedCost).toBeCloseTo(0.15, 5);
    });
  });
});
