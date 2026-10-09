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

  // Docker container status + logs. DockerStatusModal.tsx is currently
  // not mounted anywhere in the UI (orphan), so system-status.spec.ts
  // covers these endpoints via page-context fetch, asserting the
  // contract the modal will consume once wired up.
  http.get('/api/docker/status', () =>
    HttpResponse.json({
      containers: [
        {
          id: 'e2e-whisper-id',
          name: 'therascript_whisper_service',
          image: 'therascript-whisper:latest',
          state: 'running',
          status: 'Up 2 hours',
          ports: [
            { IP: '0.0.0.0', PublicPort: 8000, PrivatePort: 8000, Type: 'tcp' },
          ],
        },
        {
          id: 'e2e-es-id',
          name: 'therascript_elasticsearch',
          image: 'elasticsearch:8.x',
          state: 'running',
          status: 'Up 2 hours (healthy)',
          ports: [
            { IP: '0.0.0.0', PublicPort: 9200, PrivatePort: 9200, Type: 'tcp' },
          ],
        },
      ],
    })
  ),

  http.get('/api/docker/logs/:containerName', ({ params }) =>
    HttpResponse.json({
      logs: `[mock] recent logs for ${params.containerName}\nline 1: service healthy`,
    })
  ),
];
