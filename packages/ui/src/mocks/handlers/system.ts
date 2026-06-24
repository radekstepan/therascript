// packages/ui/src/mocks/handlers/system.ts
//
// System-level endpoints: GPU stats sidebar widget, jobs queue
// counts + reset, admin actions (reindex, reset-all-data). These
// are mounted globally so any page can render the sidebar without
// the request falling through to the webpack-dev-server proxy.
import { http, HttpResponse } from 'msw';
import { MOCK_GPU_STATS } from '../state';

export const systemHandlers = [
  http.get('/api/jobs/active-count', () =>
    HttpResponse.json({ total: 0, transcription: 0, analysis: 0 })
  ),

  http.get('/api/system/gpu-stats', () => HttpResponse.json(MOCK_GPU_STATS)),

  http.post('/api/admin/reindex-elasticsearch', () =>
    HttpResponse.json({
      message: 'Re-indexing complete',
      transcriptsIndexed: 0,
      messagesIndexed: 0,
      errors: [],
    })
  ),

  http.post('/api/jobs/reset-transcription', () =>
    HttpResponse.json({
      success: true,
    })
  ),

  // Settings data management. Pre-emptive for the planned
  // settings-data.spec.ts.
  http.post('/api/admin/reset-all-data', () =>
    HttpResponse.json({
      message: 'All application data has been reset.',
      errors: [],
    })
  ),
];
