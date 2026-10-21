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
// verification-live-banner.spec.ts.
import { http, HttpResponse } from 'msw';
import type { VerificationGlobalStats } from '../../api/verification';
import { e2eVerificationJobs } from '../state';

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
  http.get('/api/verification/stats', () => HttpResponse.json(STATS_FIXTURE)),
  http.get('/api/verification/statements', () =>
    HttpResponse.json({ items: [], total: 0, limit: 50, offset: 0 })
  ),
];
