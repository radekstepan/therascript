// packages/ui/src/mocks/handlers/e2e.ts
//
// Test-only hooks. Production code never hits /api/__e2e/* paths.
// Specs call POST /api/__e2e/reset in their beforeEach to reseed
// the mutable mock state to the known-good baseline, and
// readiness.spec.ts calls POST /api/__e2e/set-ready to flip the
// readiness overlay on/off.
import { http, HttpResponse } from 'msw';
import type {
  FlaggedStatementItem,
  MessageVerification,
} from '../../api/verification';
import type { MockChatMessage } from '../state';
import {
  e2eMockSeed,
  readReadiness,
  setE2eUploadError,
  setE2eVerificationJobs,
  writeFactCheckChatMessages,
  writeFactCheckStatements,
  writeFactCheckVerifications,
  writeReadiness,
  type E2EVerificationJob,
  type ReadinessShape,
} from '../state';
import { resetE2ePullJobs } from './llm';

export const e2eHandlers = [
  // Failure injection for POST /api/sessions/upload
  // (upload-failure.spec.ts). Body: { status, message } or {} to clear.
  http.post('/api/__e2e/set-upload-error', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as {
      status?: number;
      message?: string;
    };
    if (typeof body.status === 'number' && typeof body.message === 'string') {
      setE2eUploadError({ status: body.status, message: body.message });
    } else {
      setE2eUploadError(null);
    }
    return HttpResponse.json({ ok: true });
  }),
  http.post('/api/__e2e/reset', () => {
    e2eMockSeed();
    resetE2ePullJobs();
    return HttpResponse.json({ ok: true });
  }),
  // Job-list injection for GET /api/verification/jobs
  // (verification-live-banner.spec.ts). Body: { jobs } or {} to clear.
  http.post('/api/__e2e/set-verification-jobs', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as {
      jobs?: E2EVerificationJob[];
    };
    setE2eVerificationJobs(Array.isArray(body.jobs) ? body.jobs : []);
    return HttpResponse.json({ ok: true });
  }),
  // Fact-check fixture injection (fact-check.spec.ts). Seeds the
  // chat-scoped verifications for the session view, the dashboard's
  // flagged-statements feed, and the chat-10 messages they annotate.
  // Stored in localStorage so the fixtures survive the full document
  // loads between seeding and asserting (MSW v2 resolves handlers in
  // the page realm, where module state is wiped by navigation).
  // Anything omitted resets to empty via POST /api/__e2e/reset.
  http.post('/api/__e2e/set-fact-check', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as {
      verifications?: MessageVerification[];
      statements?: FlaggedStatementItem[];
      chatMessages?: MockChatMessage[];
    };
    writeFactCheckVerifications(
      Array.isArray(body.verifications) ? body.verifications : []
    );
    writeFactCheckStatements(
      Array.isArray(body.statements) ? body.statements : []
    );
    writeFactCheckChatMessages(
      Array.isArray(body.chatMessages) ? body.chatMessages : []
    );
    return HttpResponse.json({ ok: true });
  }),
  http.post('/api/__e2e/set-ready', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as {
      ready?: boolean;
      services?: ReadinessShape['services'];
    };
    const current = readReadiness();
    const next: ReadinessShape = {
      ready: typeof body.ready === 'boolean' ? body.ready : current.ready,
      services: body.services ?? current.services,
    };
    writeReadiness(next);
    return HttpResponse.json({ ok: true });
  }),
];
