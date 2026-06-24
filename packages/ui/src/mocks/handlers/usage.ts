// packages/ui/src/mocks/handlers/usage.ts
//
// /api/usage/* — history (weekly cost chart), stats (total cards),
// logs (paginated table). Used by UsageSection in SettingsPage.
// Currently no spec exercises these directly, but the page is
// mounted from the sidebar/settings navigation so the mocks prevent
// ECONNREFUSED noise in the worker console.
import { http, HttpResponse } from 'msw';
import {
  MOCK_USAGE_HISTORY,
  MOCK_USAGE_STATS,
  buildUsageLogs,
  buildUsageWeeks,
} from '../state';

export const usageHandlers = [
  // GET /api/usage/history?weeks=N — drives the Weekly Cost History
  // bar chart. UsageSection.tsx:57 defaults to 12 weeks and
  // re-queries on every Select.Root change (4, 8, or 12 weeks), so
  // we honor the param.
  http.get('/api/usage/history', ({ request }) => {
    const url = new URL(request.url);
    const weeksParam = url.searchParams.get('weeks');
    const weeks = weeksParam ? Math.max(1, parseInt(weeksParam, 10) || 12) : 12;
    return HttpResponse.json({
      weeks: buildUsageWeeks(weeks),
      pricing: MOCK_USAGE_HISTORY.pricing,
    });
  }),

  // GET /api/usage/stats — powers the Total LLM Tokens / Total
  // Whisper Duration / Total Estimated Cost cards and the Model +
  // Source filter dropdowns in UsageSection.tsx:366-405.
  // callsByModel and callsBySource are intentionally non-empty so
  // the Select.Content dropdowns render real options.
  http.get('/api/usage/stats', () => HttpResponse.json(MOCK_USAGE_STATS)),

  // GET /api/usage/logs — drives the "Detailed Usage Logs" table
  // in UsageSection.tsx:418-552. Mix of LLM and whisper entries
  // with recency-graded timestamps so formatDistanceToNow produces
  // a range of "X minutes/hours/days ago" labels. Query params
  // (start, end, type, model, source, limit, offset) are accepted
  // but ignored — the real backend filters server-side; the mock
  // always returns a stable payload so the table renders without
  // 500s.
  http.get('/api/usage/logs', () => {
    const items = buildUsageLogs();
    return HttpResponse.json({
      items,
      total: items.length,
      limit: 100,
      offset: 0,
    });
  }),
];
