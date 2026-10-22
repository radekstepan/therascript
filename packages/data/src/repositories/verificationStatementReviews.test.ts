import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { configureDb, run, all, get, closeDb } from '@therascript/db';
import {
  verificationRepository,
  StatementReviewNotFoundError,
  StatementReviewConflictError,
  StaleVerificationMaterialError,
  type VerificationStatementInput,
} from './verificationRepository.js';

const T0 = Date.UTC(2024, 4, 10, 12, 0, 0);
let tmpDir: string;
let dbPath: string;

const insertSession = (name: string): number => {
  const info = run(
    `INSERT INTO sessions (fileName, clientName, sessionName, date, sessionType, therapy, status)
     VALUES ('audio.mp3', 'Client', ?, '2024-05-10', 'intake', 'cbt', 'completed')`,
    name
  );
  return info.lastInsertRowid as number;
};

const insertChat = (sessionId: number): number => {
  const info = run(
    'INSERT INTO chats (sessionId, timestamp, name, tags) VALUES (?, ?, ?, ?)',
    sessionId,
    T0,
    null,
    null
  );
  return info.lastInsertRowid as number;
};

const insertMessage = (
  chatId: number,
  sender: 'user' | 'ai',
  text: string,
  timestamp: number
): number => {
  const info = run(
    `INSERT INTO messages (chatId, sender, text, timestamp, promptTokens, completionTokens, duration, isTruncated, model)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    chatId,
    sender,
    text,
    timestamp,
    null,
    sender === 'ai' ? 10 : null,
    null,
    0,
    sender === 'ai' ? 'model-a' : null
  );
  return info.lastInsertRowid as number;
};

const insertParagraph = (
  sessionId: number,
  paragraphIndex: number,
  text: string,
  speaker: string | null = 'SPEAKER_01',
  timestampMs: number = paragraphIndex * 5000
): void => {
  run(
    'INSERT INTO transcript_paragraphs (sessionId, paragraphIndex, timestampMs, text, speaker) VALUES (?, ?, ?, ?, ?)',
    sessionId,
    paragraphIndex,
    timestampMs,
    text,
    speaker
  );
};

/** Session + chat + user question + AI answer + 2 transcript paragraphs. */
const seedConversation = (answer: string) => {
  const sessionId = insertSession('S1');
  const chatId = insertChat(sessionId);
  insertMessage(
    chatId,
    'user',
    'Summarize the medication discussion.',
    T0 - 1000
  );
  const messageId = insertMessage(chatId, 'ai', answer, T0);
  insertParagraph(sessionId, 0, 'I take Sertraline every morning.');
  insertParagraph(sessionId, 1, 'How long have you taken it?', 'SPEAKER_02');
  return { sessionId, chatId, messageId };
};

const claim = (
  index: number,
  partial: Partial<VerificationStatementInput> & {
    exactQuote: string;
    normalizedClaim: string;
    verdict: VerificationStatementInput['verdict'];
  }
): VerificationStatementInput => ({
  statementIndex: index,
  kind: 'claim',
  severity: 'medium',
  confidence: 0.9,
  reasoning: 'Judge reasoning.',
  ...partial,
});

const omission = (
  index: number,
  partial: Partial<VerificationStatementInput> & { normalizedClaim: string }
): VerificationStatementInput => ({
  statementIndex: index,
  kind: 'omission',
  exactQuote: '',
  verdict: 'omission',
  severity: 'medium',
  confidence: 0.8,
  reasoning: 'Omission reasoning.',
  ...partial,
});

/** The required scoring fixture: supported + partial + fabricated + omission. */
const seedFixture = () => {
  const seeded = seedConversation(
    'The client takes Sertraline. The client runs marathons. The client flies to Mars.'
  );
  const job = verificationRepository.createVerificationJob({
    scope: 'all_unverified',
  });
  const saved = verificationRepository.saveMessageVerificationResult({
    messageId: seeded.messageId,
    chatId: seeded.chatId,
    sessionId: seeded.sessionId,
    verificationJobId: job.id,
    authoredModel: 'model-a',
    judgeModel: 'judge-1',
    totalClaims: 3,
    supportedClaims: 1,
    partialClaims: 1,
    fabricatedClaims: 1,
    omissionsCount: 1,
    accuracyScore: 1.5 / 4,
    statements: [
      claim(0, {
        exactQuote: 'The client takes Sertraline.',
        normalizedClaim: 'The client takes Sertraline.',
        startChar: 0,
        endChar: 28,
        verdict: 'supported',
        severity: 'none',
      }),
      claim(1, {
        exactQuote: 'The client runs marathons.',
        normalizedClaim: 'The client runs marathons.',
        startChar: 29,
        endChar: 57,
        verdict: 'partially_supported',
      }),
      claim(2, {
        exactQuote: 'The client flies to Mars.',
        normalizedClaim: 'The client flies to Mars.',
        startChar: 58,
        endChar: 85,
        verdict: 'fabricated',
        severity: 'high',
      }),
      omission(3, {
        normalizedClaim: 'Missed the trauma disclosure.',
        evidence: [
          {
            paragraphIndex: 0,
            timestampMs: 0,
            speaker: 'SPEAKER_01',
            quote: 'I take Sertraline every morning.',
          },
        ],
      }),
    ],
  });
  return { ...seeded, job, saved };
};

const chatStatements = (chatId: number) => {
  const verifications =
    verificationRepository.findVerificationsByChatId(chatId);
  expect(verifications).toHaveLength(1);
  return {
    verification: verifications[0]!,
    statements: verifications[0]!.statements ?? [],
  };
};

const reviewRows = () =>
  all<any>('SELECT * FROM verification_statement_reviews ORDER BY id ASC');

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verification-reviews-test-'));
  dbPath = path.join(tmpDir, 'test.db');
  configureDb({ dbPath, isDev: false });
  run('SELECT 1');
});

afterAll(() => {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  run('DELETE FROM verification_statement_reviews');
  run('DELETE FROM verified_statements');
  run('DELETE FROM message_verifications');
  run('DELETE FROM verification_jobs');
  run('DELETE FROM messages');
  run('DELETE FROM chats');
  run('DELETE FROM transcript_paragraphs');
  run('DELETE FROM sessions');
});

describe('statement review reads', () => {
  it('exposes unreviewed metadata + tokens on all statement reads', () => {
    const { chatId, saved } = seedFixture();
    expect(saved.material_revision).toBeTruthy();
    const { statements } = chatStatements(chatId);
    expect(statements).toHaveLength(4);
    for (const s of statements) {
      expect(s.review_status).toBe('unreviewed');
      expect(s.confirmed_at).toBeNull();
      expect(s.review_id).toBeNull();
      expect(typeof s.review_token).toBe('string');
      expect(s.review_token!.length).toBeGreaterThan(10);
    }
    // Tokens are statement-bound: distinct per row.
    const tokens = new Set(statements.map((s) => s.review_token));
    expect(tokens.size).toBe(4);
  });

  it('starts legacy rows (no revision/keys) unreviewed', () => {
    const { sessionId, chatId, messageId } = seedConversation('Legacy answer.');
    const verifiedAt = Date.now();
    run(
      `INSERT INTO message_verifications (message_id, chat_id, session_id, judge_model, status, total_claims, supported_claims, fabricated_claims, accuracy_score, verified_at)
       VALUES (?, ?, ?, 'judge-1', 'completed', 1, 0, 1, 0, ?)`,
      messageId,
      chatId,
      sessionId,
      verifiedAt
    );
    const parent = get<{ id: number }>(
      'SELECT id FROM message_verifications WHERE message_id = ?',
      messageId
    )!;
    run(
      `INSERT INTO verified_statements (message_verification_id, message_id, session_id, statement_index, kind, exact_quote, normalized_claim, verdict, severity, confidence, reasoning, created_at)
       VALUES (?, ?, ?, 0, 'claim', 'Legacy answer.', 'Legacy answer.', 'fabricated', 'high', 0.9, 'Old judge.', ?)`,
      parent.id,
      messageId,
      sessionId,
      Date.now()
    );
    const { statements } = chatStatements(chatId);
    expect(statements).toHaveLength(1);
    expect(statements[0]!.review_status).toBe('unreviewed');
    expect(statements[0]!.review_token).toBeTruthy();
  });
});

describe('dismissStatementAsConfirmed', () => {
  it('confirms one finding, keeps raw Judge data, updates effective aggregates', () => {
    const { chatId, job } = seedFixture();
    const before = get<any>(
      'SELECT * FROM message_verifications WHERE chat_id = ?',
      chatId
    );
    const { statements } = chatStatements(chatId);
    const fabricated = statements.find((s) => s.verdict === 'fabricated')!;
    const jobBefore = verificationRepository.findVerificationJobById(job.id)!;

    const result = verificationRepository.dismissStatementAsConfirmed(
      fabricated.id,
      fabricated.review_token!
    );

    // Original Judge finding plus confirmed metadata.
    expect(result.statement.id).toBe(fabricated.id);
    expect(result.statement.verdict).toBe('fabricated');
    expect(result.statement.severity).toBe('high');
    expect(result.statement.reasoning).toBe('Judge reasoning.');
    expect(result.statement.review_status).toBe('confirmed');
    expect(result.statement.confirmed_at).toEqual(expect.any(Number));
    expect(result.statement.review_id).toEqual(expect.any(Number));

    // Parent stays completed with effective aggregates; audit fields intact.
    expect(result.verification.status).toBe('completed');
    expect(result.verification.total_claims).toBe(3);
    expect(result.verification.supported_claims).toBe(2);
    expect(result.verification.partial_claims).toBe(1);
    expect(result.verification.fabricated_claims).toBe(0);
    expect(result.verification.omissions_count).toBe(1);
    expect(result.verification.accuracy_score).toBeCloseTo(2.5 / 4, 10);
    expect(result.verification.verified_at).toBe(before.verified_at);
    expect(result.verification.judge_model).toBe(before.judge_model);
    expect(result.verification.authored_model).toBe(before.authored_model);
    expect(result.verification.statements).toHaveLength(4);

    // Neighbors unaffected.
    const partial = result.verification.statements!.find(
      (s) => s.verdict === 'partially_supported'
    )!;
    expect(partial.review_status).toBe('unreviewed');

    // Old job run counters describe execution at audit time — untouched.
    const jobAfter = verificationRepository.findVerificationJobById(job.id)!;
    expect(jobAfter).toEqual(jobBefore);

    // Durable review row carries a snapshot of what was approved.
    const reviews = reviewRows();
    expect(reviews).toHaveLength(1);
    expect(reviews[0].message_id).toBe(result.verification.message_id);
    expect(reviews[0].reusable).toBe(1);
    expect(reviews[0].verdict).toBe('fabricated');
    expect(reviews[0].exact_quote).toBe('The client flies to Mars.');
  });

  it('implements the required fixture progression (62.5 → 83.33 → 100)', () => {
    const { chatId } = seedFixture();
    const byVerdict = (verdict: string) =>
      chatStatements(chatId).statements.find((s) => s.verdict === verdict)!;

    const afterFabricated = verificationRepository.dismissStatementAsConfirmed(
      byVerdict('fabricated').id,
      byVerdict('fabricated').review_token!
    );
    expect(afterFabricated.verification.accuracy_score).toBeCloseTo(
      2.5 / 4,
      10
    );

    // Omission confirm removes the denominator penalty without adding a claim.
    const omissionRow = chatStatements(chatId).statements.find(
      (s) => s.kind === 'omission'
    )!;
    const afterOmission = verificationRepository.dismissStatementAsConfirmed(
      omissionRow.id,
      omissionRow.review_token!
    );
    expect(afterOmission.verification.omissions_count).toBe(0);
    expect(afterOmission.verification.supported_claims).toBe(2);
    expect(afterOmission.verification.accuracy_score).toBeCloseTo(2.5 / 3, 10);

    const afterPartial = verificationRepository.dismissStatementAsConfirmed(
      byVerdict('partially_supported').id,
      byVerdict('partially_supported').review_token!
    );
    expect(afterPartial.verification.supported_claims).toBe(3);
    expect(afterPartial.verification.partial_claims).toBe(0);
    expect(afterPartial.verification.accuracy_score).toBe(1);

    // A fully-dismissed response remains verified (completed).
    expect(afterPartial.verification.status).toBe('completed');
    const candidates =
      verificationRepository.findCandidateMessagesForVerification({
        scope: 'all_unverified',
      });
    expect(candidates).toHaveLength(0);
  });

  it('is idempotent for repeated submissions', () => {
    const { chatId } = seedFixture();
    const fabricated = chatStatements(chatId).statements.find(
      (s) => s.verdict === 'fabricated'
    )!;
    const first = verificationRepository.dismissStatementAsConfirmed(
      fabricated.id,
      fabricated.review_token!
    );
    const second = verificationRepository.dismissStatementAsConfirmed(
      fabricated.id,
      fabricated.review_token!
    );
    expect(second.statement.review_id).toBe(first.statement.review_id);
    expect(second.statement.confirmed_at).toBe(first.statement.confirmed_at);
    expect(second.verification.accuracy_score).toBe(
      first.verification.accuracy_score
    );
    expect(reviewRows()).toHaveLength(1);
  });

  it('returns 404-style errors for missing and replaced statement ids', () => {
    const { chatId, messageId, sessionId } = seedFixture();
    const fabricated = chatStatements(chatId).statements.find(
      (s) => s.verdict === 'fabricated'
    )!;
    expect(() =>
      verificationRepository.dismissStatementAsConfirmed(999999, 'v1.x')
    ).toThrow(StatementReviewNotFoundError);

    // Worker rerun replaces rows with new ids: the old id must 404, never
    // silently apply to a replacement row.
    verificationRepository.saveMessageVerificationResult({
      messageId,
      chatId,
      sessionId,
      judgeModel: 'judge-1',
      totalClaims: 1,
      fabricatedClaims: 1,
      accuracyScore: 0,
      statements: [
        claim(0, {
          exactQuote: 'The client flies to Mars.',
          normalizedClaim: 'The client flies to Mars.',
          startChar: 58,
          endChar: 85,
          verdict: 'fabricated',
        }),
      ],
    });
    expect(() =>
      verificationRepository.dismissStatementAsConfirmed(
        fabricated.id,
        fabricated.review_token!
      )
    ).toThrow(StatementReviewNotFoundError);
    expect(reviewRows()).toHaveLength(0);
  });

  it('returns 409-style conflicts for supported, failed, and stale submissions', () => {
    const { chatId } = seedFixture();
    const { statements } = chatStatements(chatId);
    const supported = statements.find((s) => s.verdict === 'supported')!;
    expect(() =>
      verificationRepository.dismissStatementAsConfirmed(
        supported.id,
        supported.review_token!
      )
    ).toThrow(StatementReviewConflictError);

    const fabricated = statements.find((s) => s.verdict === 'fabricated')!;
    expect(() =>
      verificationRepository.dismissStatementAsConfirmed(
        fabricated.id,
        'v1.tampered-token'
      )
    ).toThrow(StatementReviewConflictError);

    // Failed assessments are not dismissible.
    const failed = seedConversation('Broken answer.');
    verificationRepository.saveMessageVerificationResult({
      messageId: failed.messageId,
      chatId: failed.chatId,
      sessionId: failed.sessionId,
      judgeModel: 'judge-1',
      status: 'failed',
      errorMessage: 'boom',
    });
    // A failed row has no statements; craft the conflict via a completed row
    // flipped to failed to prove the status gate (not just "no rows").
    run(
      `INSERT INTO verified_statements (message_verification_id, message_id, session_id, statement_index, kind, exact_quote, normalized_claim, verdict, severity, confidence, reasoning, created_at)
       VALUES ((SELECT id FROM message_verifications WHERE message_id = ?), ?, ?, 0, 'claim', 'q', 'c', 'fabricated', 'high', 0.9, 'r', ?)`,
      failed.messageId,
      failed.messageId,
      failed.sessionId,
      Date.now()
    );
    const failedRow = get<{ id: number; message_verification_id: number }>(
      'SELECT * FROM verified_statements WHERE message_id = ?',
      failed.messageId
    )!;
    const failedParent = get<any>(
      'SELECT * FROM message_verifications WHERE message_id = ?',
      failed.messageId
    );
    void failedParent;
    const token = chatStatements(failed.chatId).statements[0]!.review_token!;
    void failedRow;
    expect(() =>
      verificationRepository.dismissStatementAsConfirmed(
        chatStatements(failed.chatId).statements[0]!.id,
        token
      )
    ).toThrow(StatementReviewConflictError);

    // Failed validations write nothing.
    expect(reviewRows()).toHaveLength(0);
  });

  it('carries the current assessment on 409s, null on 404s', () => {
    const { chatId } = seedFixture();
    const fabricated = chatStatements(chatId).statements.find(
      (s) => s.verdict === 'fabricated'
    )!;
    let conflict: unknown = null;
    try {
      verificationRepository.dismissStatementAsConfirmed(
        fabricated.id,
        'v1.tampered'
      );
    } catch (error) {
      conflict = error;
    }
    expect(conflict).toBeInstanceOf(StatementReviewConflictError);
    const carried = (conflict as StatementReviewConflictError).verification;
    expect(carried).not.toBeNull();
    expect(carried!.message_id).toBe(fabricated.message_id);
    expect(carried!.statements).toHaveLength(4);
    // Fresh tokens so the client can retry against current data.
    expect(
      carried!.statements!.every((s) => typeof s.review_token === 'string')
    ).toBe(true);

    let missing: unknown = null;
    try {
      verificationRepository.dismissStatementAsConfirmed(999999, 'v1.x');
    } catch (error) {
      missing = error;
    }
    expect(missing).toBeInstanceOf(StatementReviewNotFoundError);
    expect((missing as StatementReviewNotFoundError).verification).toBeNull();
  });

  it('rejects dismissals after transcript edits (material_changed)', () => {
    const { chatId, sessionId } = seedFixture();
    const fabricated = chatStatements(chatId).statements.find(
      (s) => s.verdict === 'fabricated'
    )!;
    // Therapist edits the transcript after the audit.
    run(
      'UPDATE transcript_paragraphs SET text = ? WHERE sessionId = ? AND paragraphIndex = 0',
      'I take Fluoxetine every morning.',
      sessionId
    );
    let caught: unknown = null;
    try {
      verificationRepository.dismissStatementAsConfirmed(
        fabricated.id,
        fabricated.review_token!
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(StatementReviewConflictError);
    expect((caught as StatementReviewConflictError).reason).toBe(
      'material_changed'
    );
    expect(reviewRows()).toHaveLength(0);
  });

  it('establishes a legacy baseline from current material on first dismiss', () => {
    const { sessionId, chatId, messageId } = seedConversation(
      'Legacy answer here.'
    );
    run(
      `INSERT INTO message_verifications (message_id, chat_id, session_id, judge_model, status, total_claims, fabricated_claims, accuracy_score, verified_at)
       VALUES (?, ?, ?, 'judge-1', 'completed', 1, 1, 0, ?)`,
      messageId,
      chatId,
      sessionId,
      Date.now()
    );
    const parent = get<{ id: number }>(
      'SELECT id FROM message_verifications WHERE message_id = ?',
      messageId
    )!;
    run(
      `INSERT INTO verified_statements (message_verification_id, message_id, session_id, statement_index, kind, exact_quote, normalized_claim, start_char, end_char, verdict, severity, confidence, reasoning, created_at)
       VALUES (?, ?, ?, 0, 'claim', 'Legacy answer here.', 'Legacy answer here.', 0, 18, 'fabricated', 'high', 0.9, 'Old judge.', ?)`,
      parent.id,
      messageId,
      sessionId,
      Date.now()
    );
    const target = chatStatements(chatId).statements[0]!;
    const result = verificationRepository.dismissStatementAsConfirmed(
      target.id,
      target.review_token!
    );
    expect(result.statement.review_status).toBe('confirmed');
    expect(result.verification.supported_claims).toBe(1);
    const updated = get<{ material_revision: string | null }>(
      'SELECT material_revision FROM message_verifications WHERE id = ?',
      parent.id
    )!;
    expect(updated.material_revision).toBeTruthy();
  });
});

describe('ambiguous findings', () => {
  it('confirms only the selected row and never auto-reuses across runs', () => {
    const seeded = seedConversation('Aspirin helps. Aspirin helps.');
    verificationRepository.saveMessageVerificationResult({
      messageId: seeded.messageId,
      chatId: seeded.chatId,
      sessionId: seeded.sessionId,
      judgeModel: 'judge-1',
      totalClaims: 2,
      fabricatedClaims: 2,
      accuracyScore: 0,
      statements: [
        claim(0, {
          exactQuote: 'Aspirin helps.',
          normalizedClaim: 'Aspirin helps the client.',
          verdict: 'fabricated',
        }),
        claim(1, {
          exactQuote: 'Aspirin helps.',
          normalizedClaim: 'Aspirin helps the client.',
          verdict: 'fabricated',
        }),
      ],
    });
    const { statements } = chatStatements(seeded.chatId);
    expect(statements).toHaveLength(2);

    // Both rows share an unresolved duplicate quote → ambiguous.
    const result = verificationRepository.dismissStatementAsConfirmed(
      statements[0]!.id,
      statements[0]!.review_token!
    );
    expect(result.statement.review_status).toBe('confirmed');
    const sibling = result.verification.statements!.find(
      (s) => s.id === statements[1]!.id
    )!;
    expect(sibling.review_status).toBe('unreviewed');

    const reviews = reviewRows();
    expect(reviews).toHaveLength(1);
    expect(reviews[0].reusable).toBe(0);
    expect(reviews[0].confirmed_statement_id).toBe(statements[0]!.id);

    // Forced rerun with new ids: the ambiguous association must not match.
    const resaved = verificationRepository.saveMessageVerificationResult({
      messageId: seeded.messageId,
      chatId: seeded.chatId,
      sessionId: seeded.sessionId,
      judgeModel: 'judge-1',
      totalClaims: 2,
      fabricatedClaims: 2,
      accuracyScore: 0,
      statements: [
        claim(0, {
          exactQuote: 'Aspirin helps.',
          normalizedClaim: 'Aspirin helps the client.',
          verdict: 'fabricated',
        }),
        claim(1, {
          exactQuote: 'Aspirin helps.',
          normalizedClaim: 'Aspirin helps the client.',
          verdict: 'fabricated',
        }),
      ],
    });
    expect(resaved.fabricated_claims).toBe(2);
    expect(
      resaved.statements!.every((s) => s.review_status === 'unreviewed')
    ).toBe(true);
    // The old review is retained as history, not re-applied.
    expect(reviewRows()).toHaveLength(1);
  });
});

describe('review reuse across reruns', () => {
  it('honors matching reviews on forced reruns with new ids/order', () => {
    const { chatId, messageId, sessionId } = seedFixture();
    const fabricated = chatStatements(chatId).statements.find(
      (s) => s.verdict === 'fabricated'
    )!;
    verificationRepository.dismissStatementAsConfirmed(
      fabricated.id,
      fabricated.review_token!
    );

    // Rerun: same findings, shuffled order, new statement ids.
    const resaved = verificationRepository.saveMessageVerificationResult({
      messageId,
      chatId,
      sessionId,
      judgeModel: 'judge-1',
      totalClaims: 3,
      supportedClaims: 1,
      partialClaims: 1,
      fabricatedClaims: 1,
      omissionsCount: 1,
      accuracyScore: 1.5 / 4,
      statements: [
        claim(0, {
          exactQuote: 'The client flies to Mars.',
          normalizedClaim: 'The client flies to Mars.',
          startChar: 58,
          endChar: 85,
          verdict: 'fabricated',
          severity: 'high',
        }),
        claim(1, {
          exactQuote: 'The client takes Sertraline.',
          normalizedClaim: 'The client takes Sertraline.',
          startChar: 0,
          endChar: 28,
          verdict: 'supported',
          severity: 'none',
        }),
        claim(2, {
          exactQuote: 'The client runs marathons.',
          normalizedClaim: 'The client runs marathons.',
          startChar: 29,
          endChar: 57,
          verdict: 'partially_supported',
        }),
        omission(3, {
          normalizedClaim: 'Missed the trauma disclosure.',
          evidence: [
            {
              paragraphIndex: 0,
              timestampMs: 0,
              speaker: 'SPEAKER_01',
              quote: 'I take Sertraline every morning.',
            },
          ],
        }),
      ],
    });
    const confirmed = resaved.statements!.find(
      (s) => s.verdict === 'fabricated'
    )!;
    expect(confirmed.review_status).toBe('confirmed');
    expect(resaved.supported_claims).toBe(2);
    expect(resaved.fabricated_claims).toBe(0);
    expect(resaved.accuracy_score).toBeCloseTo(2.5 / 4, 10);
    // New/changed claims stay unresolved.
    expect(
      resaved.statements!.find((s) => s.verdict === 'partially_supported')!
        .review_status
    ).toBe('unreviewed');
  });

  it('matches typography variants and reordered omission evidence', () => {
    const seeded = seedConversation('The client takes “Sertraline” daily.');
    verificationRepository.saveMessageVerificationResult({
      messageId: seeded.messageId,
      chatId: seeded.chatId,
      sessionId: seeded.sessionId,
      judgeModel: 'judge-1',
      totalClaims: 1,
      contradictedClaims: 1,
      omissionsCount: 1,
      accuracyScore: 0,
      statements: [
        claim(0, {
          exactQuote: 'takes “Sertraline” daily',
          normalizedClaim: 'The client takes Sertraline daily.',
          startChar: 11,
          endChar: 33,
          verdict: 'contradicted',
        }),
        omission(1, {
          normalizedClaim: 'Missed two events.',
          evidence: [
            {
              paragraphIndex: 0,
              timestampMs: 0,
              speaker: 'SPEAKER_01',
              quote: 'I take Sertraline every morning.',
            },
            {
              paragraphIndex: 1,
              timestampMs: 5000,
              speaker: 'SPEAKER_02',
              quote: 'How long have you taken it?',
            },
          ],
        }),
      ],
    });
    const { statements } = chatStatements(seeded.chatId);
    for (const s of statements) {
      verificationRepository.dismissStatementAsConfirmed(s.id, s.review_token!);
    }

    const resaved = verificationRepository.saveMessageVerificationResult({
      messageId: seeded.messageId,
      chatId: seeded.chatId,
      sessionId: seeded.sessionId,
      judgeModel: 'judge-1',
      totalClaims: 1,
      contradictedClaims: 1,
      omissionsCount: 1,
      accuracyScore: 0,
      statements: [
        claim(0, {
          exactQuote: `TAKES 'sertraline'   daily`,
          normalizedClaim: 'the client takes Sertraline daily.',
          startChar: 11,
          endChar: 33,
          verdict: 'contradicted',
        }),
        omission(1, {
          normalizedClaim: 'Missed two events.',
          evidence: [
            {
              paragraphIndex: 1,
              timestampMs: 5000,
              speaker: 'SPEAKER_02',
              quote: 'How long have you taken it?',
            },
            {
              paragraphIndex: 0,
              timestampMs: 0,
              speaker: 'SPEAKER_01',
              quote: 'I take Sertraline every morning.',
            },
          ],
        }),
      ],
    });
    expect(
      resaved.statements!.every((s) => s.review_status === 'confirmed')
    ).toBe(true);
    expect(resaved.supported_claims).toBe(1);
    expect(resaved.omissions_count).toBe(0);
    expect(resaved.accuracy_score).toBe(1);
  });

  it('does not reuse reviews after answer/question/transcript changes', () => {
    const { chatId, messageId, sessionId } = seedFixture();
    const fabricated = chatStatements(chatId).statements.find(
      (s) => s.verdict === 'fabricated'
    )!;
    verificationRepository.dismissStatementAsConfirmed(
      fabricated.id,
      fabricated.review_token!
    );

    // Transcript edit changes the material revision.
    run(
      'UPDATE transcript_paragraphs SET text = ? WHERE sessionId = ? AND paragraphIndex = 0',
      'I take Sertraline every evening.',
      sessionId
    );
    const resaved = verificationRepository.saveMessageVerificationResult({
      messageId,
      chatId,
      sessionId,
      judgeModel: 'judge-1',
      totalClaims: 3,
      supportedClaims: 1,
      partialClaims: 1,
      fabricatedClaims: 1,
      omissionsCount: 1,
      accuracyScore: 1.5 / 4,
      statements: [
        claim(0, {
          exactQuote: 'The client takes Sertraline.',
          normalizedClaim: 'The client takes Sertraline.',
          startChar: 0,
          endChar: 28,
          verdict: 'supported',
          severity: 'none',
        }),
        claim(1, {
          exactQuote: 'The client runs marathons.',
          normalizedClaim: 'The client runs marathons.',
          startChar: 29,
          endChar: 57,
          verdict: 'partially_supported',
        }),
        claim(2, {
          exactQuote: 'The client flies to Mars.',
          normalizedClaim: 'The client flies to Mars.',
          startChar: 58,
          endChar: 85,
          verdict: 'fabricated',
          severity: 'high',
        }),
        omission(3, { normalizedClaim: 'Missed the trauma disclosure.' }),
      ],
    });
    expect(
      resaved.statements!.find((s) => s.verdict === 'fabricated')!.review_status
    ).toBe('unreviewed');
    expect(resaved.accuracy_score).toBeCloseTo(1.5 / 4, 10);
    // Old reviews retained as history.
    expect(reviewRows()).toHaveLength(1);
  });

  it('rejects saves evaluated against stale material', () => {
    const { chatId, messageId, sessionId } = seedFixture();
    const before = get<any>(
      'SELECT material_revision FROM message_verifications WHERE message_id = ?',
      messageId
    )!;
    run(
      'UPDATE transcript_paragraphs SET text = ? WHERE sessionId = ? AND paragraphIndex = 1',
      'Edited question.',
      sessionId
    );
    expect(() =>
      verificationRepository.saveMessageVerificationResult({
        messageId,
        chatId,
        sessionId,
        judgeModel: 'judge-1',
        materialRevision: before.material_revision,
        statements: [],
      })
    ).toThrow(StaleVerificationMaterialError);
    // The stale save wrote nothing: prior assessment and reviews intact.
    const after = get<any>(
      'SELECT material_revision, fabricated_claims FROM message_verifications WHERE message_id = ?',
      messageId
    )!;
    expect(after.material_revision).toBe(before.material_revision);
    expect(after.fabricated_claims).toBe(1);
  });
});

describe('effective job counters on audited saves', () => {
  it('records effective (review-reconciled) counters for new audits', () => {
    const { chatId, messageId, sessionId } = seedFixture();
    const fabricated = chatStatements(chatId).statements.find(
      (s) => s.verdict === 'fabricated'
    )!;
    verificationRepository.dismissStatementAsConfirmed(
      fabricated.id,
      fabricated.review_token!
    );

    // A new audit run re-audits the message: counters describe effective
    // results at save time (confirmation reconciled), not raw Judge counts.
    const job = verificationRepository.createVerificationJob({
      scope: 'single_chat',
      chatId,
    });
    verificationRepository.saveMessageVerificationResult({
      messageId,
      chatId,
      sessionId,
      verificationJobId: job.id,
      judgeModel: 'judge-1',
      totalClaims: 1,
      fabricatedClaims: 1,
      accuracyScore: 0,
      statements: [
        claim(0, {
          exactQuote: 'The client flies to Mars.',
          normalizedClaim: 'The client flies to Mars.',
          startChar: 58,
          endChar: 85,
          verdict: 'fabricated',
          severity: 'high',
        }),
      ],
    });
    const updated = verificationRepository.findVerificationJobById(job.id)!;
    expect(updated.total_statements).toBe(1);
    expect(updated.flagged_statements).toBe(0);
    expect(updated.processed_messages).toBe(1);
  });
});

describe('review-aware analytics and feed', () => {
  it('excludes confirmed findings from feed rows, counts, and session totals', () => {
    const { chatId, sessionId } = seedFixture();
    const feedBefore = verificationRepository.findFlaggedStatements({});
    expect(feedBefore.total).toBe(3);
    const detailBefore =
      verificationRepository.findVerificationsBySessionId(sessionId);
    expect(detailBefore.flaggedIssues).toBe(3);

    const fabricated = chatStatements(chatId).statements.find(
      (s) => s.verdict === 'fabricated'
    )!;
    verificationRepository.dismissStatementAsConfirmed(
      fabricated.id,
      fabricated.review_token!
    );

    // Feed rows AND pagination COUNT exclude the confirmed finding.
    const feedAfter = verificationRepository.findFlaggedStatements({});
    expect(feedAfter.total).toBe(2);
    expect(feedAfter.items.some((i) => i.verdict === 'fabricated')).toBe(false);
    // Filtered requests exclude it too.
    const filtered = verificationRepository.findFlaggedStatements({
      verdicts: ['fabricated'],
    });
    expect(filtered.total).toBe(0);
    expect(filtered.items).toHaveLength(0);

    // Session flagged totals use the same unresolved predicate.
    const detailAfter =
      verificationRepository.findVerificationsBySessionId(sessionId);
    expect(detailAfter.flaggedIssues).toBe(2);

    // Pooled/global/model/time aggregates consume effective parent data.
    const stats = verificationRepository.getGlobalVerificationAnalytics();
    expect(stats.supportedClaims).toBe(2);
    expect(stats.fabricatedClaims).toBe(0);
    expect(stats.overallAccuracyPercent).toBeCloseTo((2.5 / 4) * 100);
    const sessionSummary = stats.sessionsSummary.find(
      (s) => s.sessionId === sessionId
    )!;
    expect(sessionSummary.flaggedIssues).toBe(2);
    expect(sessionSummary.averageAccuracy).toBeCloseTo(62.5);
  });

  it('keeps dismissed responses verified with null chat-summary convention intact', () => {
    // Dismissal never changes coverage: verified counts stay, unverified pool
    // does not regain the message.
    const { chatId } = seedFixture();
    for (const s of chatStatements(chatId).statements.filter(
      (st) => st.verdict !== 'supported'
    )) {
      verificationRepository.dismissStatementAsConfirmed(s.id, s.review_token!);
    }
    const stats = verificationRepository.getGlobalVerificationAnalytics();
    expect(stats.totalMessagesAudited).toBe(1);
    expect(stats.unverifiedMessagesCount).toBe(0);
  });
});

describe('review lifecycle', () => {
  it('survives response clear and re-applies on recheck', () => {
    const { chatId, messageId, sessionId } = seedFixture();
    const fabricated = chatStatements(chatId).statements.find(
      (s) => s.verdict === 'fabricated'
    )!;
    verificationRepository.dismissStatementAsConfirmed(
      fabricated.id,
      fabricated.review_token!
    );

    // Clear Response Fact Check: assessment gone, confirmation kept.
    expect(verificationRepository.deleteMessageVerification(messageId)).toBe(
      true
    );
    expect(reviewRows()).toHaveLength(1);
    expect(
      verificationRepository.findVerificationsByChatId(chatId)
    ).toHaveLength(0);

    // Recheck: matching finding stays confirmed without new review rows.
    const rechecked = verificationRepository.saveMessageVerificationResult({
      messageId,
      chatId,
      sessionId,
      judgeModel: 'judge-1',
      totalClaims: 1,
      fabricatedClaims: 1,
      accuracyScore: 0,
      statements: [
        claim(0, {
          exactQuote: 'The client flies to Mars.',
          normalizedClaim: 'The client flies to Mars.',
          startChar: 58,
          endChar: 85,
          verdict: 'fabricated',
          severity: 'high',
        }),
      ],
    });
    expect(rechecked.statements![0]!.review_status).toBe('confirmed');
    expect(rechecked.supported_claims).toBe(1);
    expect(reviewRows()).toHaveLength(1);
  });

  it('survives failed retry saves and worker empty-result saves', () => {
    const { chatId, messageId, sessionId } = seedFixture();
    const fabricated = chatStatements(chatId).statements.find(
      (s) => s.verdict === 'fabricated'
    )!;
    verificationRepository.dismissStatementAsConfirmed(
      fabricated.id,
      fabricated.review_token!
    );
    verificationRepository.saveMessageVerificationResult({
      messageId,
      chatId,
      sessionId,
      judgeModel: 'judge-1',
      status: 'failed',
      errorMessage: 'Judge provider error',
      errorCode: 'provider_error',
    });
    expect(reviewRows()).toHaveLength(1);
  });

  it('is deleted by full reset but preserved otherwise', () => {
    const { chatId } = seedFixture();
    const fabricated = chatStatements(chatId).statements.find(
      (s) => s.verdict === 'fabricated'
    )!;
    verificationRepository.dismissStatementAsConfirmed(
      fabricated.id,
      fabricated.review_token!
    );
    const result = verificationRepository.resetAllVerifications();
    expect(result.deletedReviews).toBe(1);
    expect(reviewRows()).toHaveLength(0);
  });

  it('cascades on owning message deletion (chat delete)', () => {
    const { chatId } = seedFixture();
    const fabricated = chatStatements(chatId).statements.find(
      (s) => s.verdict === 'fabricated'
    )!;
    verificationRepository.dismissStatementAsConfirmed(
      fabricated.id,
      fabricated.review_token!
    );
    // Chat deletion cascades chats → messages → reviews (FK enforced).
    run('DELETE FROM chats WHERE id = ?', chatId);
    expect(reviewRows()).toHaveLength(0);
  });

  it('exports reviews for backup even after the assessment was cleared', () => {
    const { chatId, messageId } = seedFixture();
    const fabricated = chatStatements(chatId).statements.find(
      (s) => s.verdict === 'fabricated'
    )!;
    verificationRepository.dismissStatementAsConfirmed(
      fabricated.id,
      fabricated.review_token!
    );
    verificationRepository.deleteMessageVerification(messageId);
    const backup = verificationRepository.findAllStatementReviewsForBackup();
    expect(backup).toHaveLength(1);
    expect(backup[0]!.reusable).toBe(true);
    expect(backup[0]!.verdict).toBe('fabricated');
    expect(backup[0]!.context_revision).toBeTruthy();
  });
});

describe('dismiss/save ordering across separate connections', () => {
  it('sees worker-committed rows first: stale dismiss gets 404 and refreshes', () => {
    const { chatId, sessionId } = seedFixture();
    const fabricated = chatStatements(chatId).statements.find(
      (s) => s.verdict === 'fabricated'
    )!;

    // A second connection (the worker) replaces the rows with new ids.
    const peer = new Database(dbPath);
    peer.pragma('journal_mode = WAL');
    peer.pragma('busy_timeout = 5000');
    try {
      const parent = peer
        .prepare('SELECT * FROM message_verifications WHERE chat_id = ?')
        .get(chatId) as any;
      peer
        .prepare('DELETE FROM verified_statements WHERE message_id = ?')
        .run(parent.message_id);
      peer
        .prepare(
          `INSERT INTO verified_statements (message_verification_id, message_id, session_id, statement_index, kind, exact_quote, normalized_claim, verdict, severity, confidence, reasoning, created_at)
           VALUES (?, ?, ?, 0, 'claim', 'New quote.', 'New claim.', 'fabricated', 'high', 0.9, 'New judge.', ?)`
        )
        .run(parent.id, parent.message_id, parent.session_id, Date.now());
    } finally {
      peer.close();
    }

    expect(() =>
      verificationRepository.dismissStatementAsConfirmed(
        fabricated.id,
        fabricated.review_token!
      )
    ).toThrow(StatementReviewNotFoundError);
    // Refresh shows the replacement row, unreviewed.
    const { statements } = chatStatements(chatId);
    expect(statements).toHaveLength(1);
    expect(statements[0]!.review_status).toBe('unreviewed');
    expect(reviewRows()).toHaveLength(0);
    void sessionId;
  });

  it('serializes two different dismissals so both count', () => {
    const { chatId } = seedFixture();
    const { statements } = chatStatements(chatId);
    const first = statements.find((s) => s.verdict === 'fabricated')!;
    const second = statements.find((s) => s.verdict === 'partially_supported')!;

    const r1 = verificationRepository.dismissStatementAsConfirmed(
      first.id,
      first.review_token!
    );
    // Second dismissal reads the committed first review (separate tx).
    const r2 = verificationRepository.dismissStatementAsConfirmed(
      second.id,
      second.review_token!
    );
    expect(r2.verification.supported_claims).toBe(3);
    expect(r2.verification.partial_claims).toBe(0);
    expect(r2.verification.fabricated_claims).toBe(0);
    expect(r2.verification.accuracy_score).toBeCloseTo(3 / 4, 10);
    expect(reviewRows()).toHaveLength(2);
    void r1;
  });

  it('creates one review for duplicate dismissals', () => {
    const { chatId } = seedFixture();
    const fabricated = chatStatements(chatId).statements.find(
      (s) => s.verdict === 'fabricated'
    )!;
    const first = verificationRepository.dismissStatementAsConfirmed(
      fabricated.id,
      fabricated.review_token!
    );
    const repeat = verificationRepository.dismissStatementAsConfirmed(
      fabricated.id,
      fabricated.review_token!
    );
    expect(repeat.statement.review_id).toBe(first.statement.review_id);
    expect(repeat.statement.confirmed_at).toBe(first.statement.confirmed_at);
    expect(reviewRows()).toHaveLength(1);
  });
});
