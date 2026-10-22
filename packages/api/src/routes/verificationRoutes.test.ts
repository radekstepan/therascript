// @vitest-environment node
// packages/api/src/routes/verificationRoutes.test.ts
//
// Route-level contract tests for `POST /api/verification/statements/:statementId/dismiss`.
// Handler mocks cannot prove Elysia param/body/response validation, so these
// exercise the mounted route: strict id/token validation (400), repository
// error mapping (404/409), and response-schema shape (review metadata
// present, never silently stripped).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Elysia } from 'elysia';

const { mockDismiss, mockNotFoundError, mockConflictError } = vi.hoisted(
  () => ({
    mockDismiss: vi.fn(),
    mockNotFoundError: class MockReviewNotFoundError extends Error {},
    mockConflictError: class MockReviewConflictError extends Error {},
  })
);

vi.mock('@therascript/data', () => ({
  verificationRepository: {
    dismissStatementAsConfirmed: (...args: unknown[]) => mockDismiss(...args),
  },
  StatementReviewNotFoundError: mockNotFoundError,
  StatementReviewConflictError: mockConflictError,
  resolveVerificationSkipVerified: () => true,
  sessionRepository: {},
  chatRepository: {},
  messageRepository: {},
}));

vi.mock('../services/jobQueueService.js', () => ({
  addVerificationJob: vi.fn(),
  isVerificationJobQueued: vi.fn(),
  cancelVerificationJobFromQueue: vi.fn(),
}));

vi.mock('../services/streamSubscriber.js', () => ({
  subscribeToVerificationStream: vi.fn(),
}));

vi.mock('../services/activeModelService.js', () => ({
  getConfiguredTopP: vi.fn(),
  getConfiguredRepeatPenalty: vi.fn(),
  getConfiguredNumGpuLayers: vi.fn(),
  getConfiguredThinkingBudget: vi.fn(),
  getActiveBaseUrl: vi.fn(),
  getActiveModel: vi.fn(),
  getConfiguredContextSize: vi.fn(),
}));

const { verificationRoutes } = await import('./verificationRoutes.js');
const { setupMiddleware } = await import('../setupMiddleware.js');

// Mounted exactly like the real app (middleware first): route-validation
// failures surface as the application's normal 400 status, and ApiError
// statuses (404/409) pass through.
const app = new Elysia()
  .use(setupMiddleware('test', {} as never))
  .use(verificationRoutes);
// Bare route (no error mapping) for the response-strictness probe, where
// Elysia's native 422 proves the schema rejects stripped metadata.
const bareApp = new Elysia().use(verificationRoutes);

const postDismiss = (statementId: string, body: unknown) =>
  app.handle(
    new Request(
      `http://localhost/api/verification/statements/${statementId}/dismiss`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }
    )
  );

const confirmedStatement = {
  id: 9,
  message_verification_id: 4,
  message_id: 12,
  session_id: 1,
  statement_index: 2,
  kind: 'claim',
  exact_quote: 'The client flies to Mars.',
  normalized_claim: 'The client flies to Mars.',
  start_char: 58,
  end_char: 85,
  verdict: 'fabricated',
  severity: 'high',
  confidence: 0.9,
  reasoning: 'Not in transcript.',
  transcript_evidence_json: null,
  evidence: [],
  created_at: 203,
  review_status: 'confirmed',
  confirmed_at: 300,
  review_id: 2,
  review_token: 'v1.token',
};

const parentVerification = {
  id: 4,
  message_id: 12,
  chat_id: 7,
  session_id: 1,
  verification_job_id: null,
  authored_model: 'llama-3.1-8b',
  judge_model: 'judge-v1',
  status: 'completed',
  total_claims: 3,
  supported_claims: 2,
  partial_claims: 1,
  contradicted_claims: 0,
  fabricated_claims: 0,
  omissions_count: 1,
  accuracy_score: 0.625,
  summary_assessment: null,
  prompt_tokens: null,
  completion_tokens: null,
  duration_ms: null,
  verified_at: 202,
  error_message: null,
  material_revision: 'v1.abc',
  statements: [confirmedStatement],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('POST /api/verification/statements/:statementId/dismiss', () => {
  it('returns 200 with the confirmed statement and authoritative parent', async () => {
    mockDismiss.mockReturnValue({
      statement: confirmedStatement,
      verification: parentVerification,
    });
    const res = await postDismiss('9', { expectedReviewToken: 'v1.token' });
    expect(res.status).toBe(200);
    expect(mockDismiss).toHaveBeenCalledWith(9, 'v1.token');
    const json = (await res.json()) as {
      statement: typeof confirmedStatement;
      verification: typeof parentVerification;
    };
    expect(json.statement.review_status).toBe('confirmed');
    expect(json.statement.verdict).toBe('fabricated');
    expect(json.verification.statements).toHaveLength(1);
  });

  it.each([['0'], ['-3'], ['2.5'], ['12abc']])(
    'rejects statement id %p with 400 without touching the repository',
    async (statementId) => {
      const res = await postDismiss(statementId, {
        expectedReviewToken: 'v1.token',
      });
      expect(res.status).toBe(400);
      expect(mockDismiss).not.toHaveBeenCalled();
    }
  );

  it.each([
    [{}],
    [{ expectedReviewToken: '' }],
    [{ expectedReviewToken: '   ' }],
  ])('rejects missing/blank tokens with 400: %p', async (body) => {
    const res = await postDismiss('9', body);
    expect(res.status).toBe(400);
    expect(mockDismiss).not.toHaveBeenCalled();
  });

  it('maps repository not-found to 404', async () => {
    mockDismiss.mockImplementation(() => {
      throw new mockNotFoundError('Statement with ID 9 no longer exists.');
    });
    const res = await postDismiss('9', { expectedReviewToken: 'v1.token' });
    expect(res.status).toBe(404);
  });

  it('maps repository conflicts to 409', async () => {
    mockDismiss.mockImplementation(() => {
      throw new mockConflictError('stale confirmation token');
    });
    const res = await postDismiss('9', { expectedReviewToken: 'v1.token' });
    expect(res.status).toBe(409);
  });

  it('carries the explanation in the 409 body for client refresh', async () => {
    mockDismiss.mockImplementation(() => {
      throw Object.assign(new mockConflictError('stale confirmation token'), {
        verification: parentVerification,
      });
    });
    const res = await postDismiss('9', { expectedReviewToken: 'v1.token' });
    expect(res.status).toBe(409);
    // Thrown ApiErrors surface through Elysia's native mapping (status +
    // plain-text explanation); the UI refreshes via query invalidation on
    // 404/409, and consumes a carried assessment when one is present.
    expect(await res.text()).toMatch(/stale confirmation token/);
  });

  it('rejects responses that silently drop review metadata', async () => {
    const { review_status: _dropped, ...stripped } = confirmedStatement;
    void _dropped;
    mockDismiss.mockReturnValue({
      statement: stripped,
      verification: parentVerification,
    });
    const res = await bareApp.handle(
      new Request('http://localhost/api/verification/statements/9/dismiss', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedReviewToken: 'v1.token' }),
      })
    );
    // Elysia strict response validation: missing review_status must fail,
    // proving the schema carries the metadata end to end.
    expect(res.status).toBe(422);
  });
});
