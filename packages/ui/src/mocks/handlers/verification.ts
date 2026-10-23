// packages/ui/src/mocks/handlers/verification.ts
//
// MSW handlers for the /api/verification/* dashboard endpoints used by
// VerificationAuditPage: job list, global stats (KPIs, per-model
// accuracy, trend, session coverage), and flagged statements.
//
// The stats fixture seeds one coverage row for session 1 ("Intake
// Session", matching MOCK_INTAKE_SESSION in ../state.ts) so specs can
// exercise the jump-to-transcript navigation from the Coverage tab.
//
// Owned spec files: verification-coverage.spec.ts,
// verification-chart-padding.spec.ts,
// verification-model-accuracy-scroll.spec.ts,
// verification-live-banner.spec.ts, fact-check.spec.ts (chat
// verifications + dismiss/delete below).
import { http, HttpResponse } from 'msw';
import type { VerificationGlobalStats } from '../../api/verification';
import {
  e2eVerificationJobs,
  readFactCheckStatements,
  readFactCheckVerifications,
  writeFactCheckVerifications,
} from '../state';

const STATS_FIXTURE: VerificationGlobalStats = {
  totalMessagesAudited: 4,
  overallAccuracyPercent: 87.5,
  totalClaims: 8,
  supportedClaims: 7,
  partialClaims: 0,
  contradictedClaims: 1,
  fabricatedClaims: 0,
  omissions: 0,
  unverifiedMessagesCount: 2,
  byModel: [
    {
      model: 'e2e-judge-model',
      messagesAudited: 4,
      totalClaims: 8,
      supportedClaims: 7,
      partialClaims: 0,
      contradictedClaims: 1,
      fabricatedClaims: 0,
      omissions: 0,
      accuracyPercent: 87.5,
      fabricationRate: 0,
      contradictionRate: 12.5,
      omissionsPerMessage: 0,
      averageAccuracyScore: 87.5,
    },
  ],
  overTime: [
    {
      date: '2026-06-19',
      messagesAudited: 2,
      totalClaims: 4,
      accuracyPercent: 75,
      fabrications: 1,
      contradictions: 0,
      omissions: 1,
    },
    {
      date: '2026-06-20',
      messagesAudited: 3,
      totalClaims: 6,
      accuracyPercent: 83.3,
      fabrications: 0,
      contradictions: 1,
      omissions: 0,
    },
    {
      date: '2026-06-21',
      messagesAudited: 1,
      totalClaims: 2,
      accuracyPercent: 100,
      fabrications: 0,
      contradictions: 0,
      omissions: 1,
    },
    {
      date: '2026-06-22',
      messagesAudited: 5,
      totalClaims: 10,
      accuracyPercent: 90,
      fabrications: 1,
      contradictions: 1,
      omissions: 0,
    },
    {
      date: '2026-06-23',
      messagesAudited: 4,
      totalClaims: 8,
      accuracyPercent: 87.5,
      fabrications: 0,
      contradictions: 1,
      omissions: 0,
    },
  ],
  sessionsSummary: [
    {
      sessionId: 1,
      sessionName: 'Intake Session',
      clientName: 'Jane Doe',
      date: '2026-06-23T12:00:00.000Z',
      totalAiMessages: 6,
      verifiedAiMessages: 4,
      isFullyVerified: false,
      flaggedIssues: 1,
      averageAccuracy: 87.5,
    },
  ],
};

export const verificationHandlers = [
  http.get('/api/verification/jobs', () =>
    HttpResponse.json(e2eVerificationJobs)
  ),
  http.get('/api/verification/jobs/:jobId/failures', ({ params }) =>
    HttpResponse.json({
      jobId: Number(params.jobId),
      failures: [],
    })
  ),
  http.get('/api/verification/stats', () => HttpResponse.json(STATS_FIXTURE)),
  http.get('/api/verification/statements', () => {
    const items = readFactCheckStatements();
    return HttpResponse.json({
      items,
      total: items.length,
      limit: 50,
      offset: 0,
    });
  }),
  // Chat-scoped verdicts for the session chat view
  // (fetchChatVerifications). Injected per-spec via
  // POST /api/__e2e/set-fact-check; empty by default.
  http.get('/api/sessions/:sessionId/chats/:chatId/verifications', () =>
    HttpResponse.json(readFactCheckVerifications())
  ),
  // Dismiss one finding as confirmed (fact-check.spec.ts exercises the
  // modal Dismiss button). Wrong/missing tokens are rejected like the
  // real backend (409) so the modal's error path stays honest.
  http.post(
    '/api/verification/statements/:statementId/dismiss',
    async ({ params, request }) => {
      const statementId = Number(params.statementId);
      const body = (await request.json().catch(() => ({}))) as {
        expectedReviewToken?: string;
      };
      const verifications = readFactCheckVerifications();
      for (const verification of verifications) {
        const statements = verification.statements ?? [];
        const idx = statements.findIndex((s) => s.id === statementId);
        if (idx < 0) continue;
        const current = statements[idx]!;
        if (
          current.review_token == null ||
          body.expectedReviewToken !== current.review_token
        ) {
          return HttpResponse.json(
            { message: 'stale confirmation token' },
            { status: 409 }
          );
        }
        const confirmed = {
          ...current,
          review_status: 'confirmed' as const,
          confirmed_at: Date.now(),
          review_id: 900 + statementId,
        };
        const nextVerification = {
          ...verification,
          statements: statements.map((s) =>
            s.id === statementId ? confirmed : s
          ),
        };
        writeFactCheckVerifications(
          verifications.map((v) =>
            v.id === verification.id ? nextVerification : v
          )
        );
        return HttpResponse.json({
          statement: confirmed,
          verification: nextVerification,
        });
      }
      return HttpResponse.json(
        { message: 'statement not found' },
        { status: 404 }
      );
    }
  ),
  // Clear one response's verification (the failed-verification "Clear"
  // button in ChatMessageBubble).
  http.delete('/api/verification/messages/:messageId', ({ params }) => {
    const messageId = Number(params.messageId);
    writeFactCheckVerifications(
      readFactCheckVerifications().filter((v) => v.message_id !== messageId)
    );
    return HttpResponse.json({ message: 'cleared' });
  }),
];
