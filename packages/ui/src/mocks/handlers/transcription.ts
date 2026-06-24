// packages/ui/src/mocks/handlers/transcription.ts
//
// GET /api/transcription/status/:jobId — polled by the upload flow
// after a successful POST /api/sessions/upload. Returns a
// "completed" status so the UI clears the progress indicator
// without an actual background job.
import { http, HttpResponse } from 'msw';

export const transcriptionHandlers = [
  http.get('/api/transcription/status/:jobId', ({ params }) => {
    return HttpResponse.json({
      job_id: params.jobId,
      status: 'completed',
      progress: 100,
      duration: 120,
      message: 'Transcription completed',
    });
  }),
];
