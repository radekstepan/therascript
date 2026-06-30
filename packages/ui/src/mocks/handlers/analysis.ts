// packages/ui/src/mocks/handlers/analysis.ts
//
// /api/analysis-jobs/* — list, create, single-job detail,
// streaming job progress (SSE), cancel, delete. The deep-analysis
// spec (analysis.spec.ts) exercises the full create → stream →
// end-state flow; analysis-jobs.spec.ts exercises list + cancel +
// delete from the jobs page.
//
// The POST handler snapshots the request body into mockAnalysisJob
// (see ../state) so the GET /:jobId and SSE stream handlers can
// echo the same prompt, model, and sessionIds back consistently.
import { http, HttpResponse } from 'msw';
import {
  MOCK_ANALYSIS_JOB_ID,
  MOCK_FINAL_SYNTHESIS_INSTRUCTIONS,
  MOCK_INTAKE_SESSION,
  MOCK_FOLLOWUP_SESSION,
  MOCK_INTERMEDIATE_QUESTION,
  MOCK_LOCAL_DEFAULT_BASE_URL,
  MOCK_REDUCE_RESPONSE,
  e2eAnalysisJobs,
  mockActiveBaseUrl,
  mockActiveModel,
  mockAnalysisJob,
  setE2eAnalysisJobs,
  setMockAnalysisJob,
} from '../state';

export const analysisHandlers = [
  // POST /api/analysis-jobs — CreateAnalysisJobModal.submit mutates
  // here. Returns 202 + { jobId } to match the real backend shape
  // (analysisHandler.ts) so the modal's `navigate('/analysis-jobs')`
  // lands on the correct URL.
  http.post('/api/analysis-jobs', async ({ request }) => {
    const body = (await request.json()) as {
      prompt?: string;
      modelName?: string | null;
      sessionIds?: number[];
      baseUrl?: string | null;
    };

    // Mirror the real backend's ensureLlmReady: if the request omits
    // baseUrl while the global active URL is remote, fail the health
    // check instead of silently accepting. This pins the regression
    // where the analysis modal's Local-mode submit dropped the field
    // and the server's listModels() health-checked the stale remote
    // URL (analysisHandler.ts:326, ensureLlmReady in
    // llamaCppService.ts:408-436).
    if (
      (body.baseUrl === undefined || body.baseUrl === null) &&
      mockActiveBaseUrl &&
      mockActiveBaseUrl !== MOCK_LOCAL_DEFAULT_BASE_URL
    ) {
      return HttpResponse.json(
        { error: `Remote LLM at ${mockActiveBaseUrl} failed health check.` },
        { status: 500 }
      );
    }

    setMockAnalysisJob({
      id: MOCK_ANALYSIS_JOB_ID,
      originalPrompt: body.prompt ?? '',
      shortPrompt: 'Anxiety Trends Analysis',
      modelName: body.modelName || mockActiveModel || 'qwen2.5-7b-instruct',
      sessionIds: body.sessionIds ?? [],
    });
    return HttpResponse.json({ jobId: MOCK_ANALYSIS_JOB_ID }, { status: 202 });
  }),

  // GET /api/analysis-jobs/:jobId — full job detail with parsed
  // strategy + per-session summaries + final_result. Mirrors the real
  // backend's getAnalysisJobHandler shape (analysisRoutes.ts:53) so
  // React Query and the JobDetailView can render the end-state UI
  // directly.
  http.get('/api/analysis-jobs/1', () => {
    if (!mockAnalysisJob) {
      return HttpResponse.json({ error: 'Job not found' }, { status: 404 });
    }
    const created = Date.now() - 5_000;
    const summaries = mockAnalysisJob.sessionIds.map((sessionId, idx) => {
      const session =
        sessionId === 1 ? MOCK_INTAKE_SESSION : MOCK_FOLLOWUP_SESSION;
      return {
        id: 100 + idx,
        analysis_job_id: MOCK_ANALYSIS_JOB_ID,
        session_id: sessionId,
        summary_text: `Session ${sessionId} analysis: noted anxiety spikes tied to work deadlines.`,
        status: 'completed',
        error_message: null,
        sessionName: session.sessionName,
        sessionDate: session.date,
      };
    });
    return HttpResponse.json({
      id: MOCK_ANALYSIS_JOB_ID,
      original_prompt: mockAnalysisJob.originalPrompt,
      short_prompt: mockAnalysisJob.shortPrompt,
      status: 'completed',
      final_result: MOCK_REDUCE_RESPONSE,
      error_message: null,
      created_at: created,
      completed_at: created + 4_000,
      model_name: mockAnalysisJob.modelName,
      context_size: 8192,
      strategy_json: JSON.stringify({
        intermediate_question: MOCK_INTERMEDIATE_QUESTION,
        final_synthesis_instructions: MOCK_FINAL_SYNTHESIS_INSTRUCTIONS,
      }),
      summaries,
      strategy: {
        intermediate_question: MOCK_INTERMEDIATE_QUESTION,
        final_synthesis_instructions: MOCK_FINAL_SYNTHESIS_INSTRUCTIONS,
      },
    });
  }),

  // GET /api/analysis-jobs/:jobId/stream — SSE feed for the
  // JobDetailView. Mirrors the event-shape contract in
  // useAnalysisStream.ts:8-33 and streamAnalysisJobHandler
  // (analysisHandler.ts:644). The real handler uses setImmediate
  // between events to yield to the event loop; we use setTimeout
  // (50ms) for the same reason — without a yield React cannot
  // process intermediate state updates between enqueues.
  http.get('/api/analysis-jobs/1/stream', () => {
    if (!mockAnalysisJob) {
      return new HttpResponse('Job not found', { status: 404 });
    }
    const created = Date.now() - 5_000;
    const completed = created + 4_000;
    const summaries = mockAnalysisJob.sessionIds.map((sessionId, idx) => {
      const session =
        sessionId === 1 ? MOCK_INTAKE_SESSION : MOCK_FOLLOWUP_SESSION;
      return {
        id: 100 + idx,
        analysis_job_id: MOCK_ANALYSIS_JOB_ID,
        session_id: sessionId,
        summary_text: `Session ${sessionId} analysis: noted anxiety spikes tied to work deadlines.`,
        status: 'completed',
        error_message: null,
        sessionName: session.sessionName,
        sessionDate: session.date,
      };
    });
    const jobSnapshot = {
      id: MOCK_ANALYSIS_JOB_ID,
      original_prompt: mockAnalysisJob.originalPrompt,
      short_prompt: mockAnalysisJob.shortPrompt,
      status: 'completed',
      final_result: MOCK_REDUCE_RESPONSE,
      error_message: null,
      created_at: created,
      completed_at: completed,
      model_name: mockAnalysisJob.modelName,
      context_size: 8192,
      strategy_json: JSON.stringify({
        intermediate_question: MOCK_INTERMEDIATE_QUESTION,
        final_synthesis_instructions: MOCK_FINAL_SYNTHESIS_INSTRUCTIONS,
      }),
    };

    const encoder = new TextEncoder();
    const sse = (payload: unknown) =>
      encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const enqueue = (data: object) => {
          controller.enqueue(sse(data));
        };

        // 1. Snapshot with the fully completed state. The hook reads
        // `summaries[*].summary_text` into mapLogs and
        // `job.final_result` into reduceLog so the visible UI matches
        // the final answer when the stream closes.
        enqueue({
          type: 'snapshot',
          phase: 'status',
          job: jobSnapshot,
          summaries,
        });

        // 2. Send a `reduce` end event with non-zero completionTokens
        // + duration so the hook populates reduceMetrics. The
        // AnalysisJobsPage.tsx:621 tokens/s footer is gated on both
        // fields being truthy, so without this the metric never
        // renders. The end event must arrive *before* the terminal
        // status because the hook closes the EventSource on
        // status: 'completed' (useAnalysisStream.ts:285).
        enqueue({
          type: 'end',
          phase: 'reduce',
          promptTokens: 1840,
          completionTokens: 96,
          duration: 4800,
        });

        // 3. Yield so the snapshot + end events can flush, then send
        // the terminal status event to close the stream.
        setTimeout(() => {
          enqueue({
            type: 'status',
            phase: 'status',
            status: 'completed',
          });
          controller.close();
        }, 50);
      },
    });

    return new HttpResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
        Connection: 'keep-alive',
      },
    });
  }),

  // GET /api/analysis-jobs — list view. The union of
  // `e2eAnalysisJobs` (analysis-jobs.spec.ts) and `mockAnalysisJob`
  // (the deep-analysis spec) is served here. The deep-analysis
  // spec finds its row by the unique `Anxiety Trends Analysis`
  // short_prompt so the order is irrelevant.
  http.get('/api/analysis-jobs', () => {
    const baseList = e2eAnalysisJobs.map((j) => ({ ...j }));
    if (mockAnalysisJob) {
      const created = Date.now() - 5_000;
      baseList.push({
        id: mockAnalysisJob.id,
        original_prompt: mockAnalysisJob.originalPrompt,
        short_prompt: mockAnalysisJob.shortPrompt,
        status: 'completed',
        final_result: MOCK_REDUCE_RESPONSE,
        error_message: null,
        created_at: created,
        completed_at: created + 4_000,
        model_name: mockAnalysisJob.modelName,
        context_size: 8192,
        strategy_json: JSON.stringify({
          intermediate_question: MOCK_INTERMEDIATE_QUESTION,
          final_synthesis_instructions: MOCK_FINAL_SYNTHESIS_INSTRUCTIONS,
        }),
      });
    }
    return HttpResponse.json(baseList);
  }),

  // POST /api/analysis-jobs/:id/cancel — transitions the processing
  // job to "canceling" so the UI's spinner shows. A subsequent list
  // fetch observes "canceled".
  http.post('/api/analysis-jobs/:id/cancel', ({ params }) => {
    const id = parseInt(params.id as string, 10);
    setE2eAnalysisJobs(
      e2eAnalysisJobs.map((j) =>
        j.id === id ? { ...j, status: 'canceled', completed_at: Date.now() } : j
      )
    );
    return HttpResponse.json({ message: `Job ${id} cancellation requested.` });
  }),

  // DELETE /api/analysis-jobs/:id — removes the job from the list.
  http.delete('/api/analysis-jobs/:id', ({ params }) => {
    const id = parseInt(params.id as string, 10);
    setE2eAnalysisJobs(e2eAnalysisJobs.filter((j) => j.id !== id));
    return HttpResponse.json({ message: `Job ${id} deleted.` });
  }),
];
