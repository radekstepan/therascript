import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { configureDb, run, closeDb } from '@therascript/db';
import { messageRepository } from './messageRepository.js';
import { verificationRepository } from './verificationRepository.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2024, 4, 10, 12, 0, 0);

let tmpDir: string;

const insertSession = (
  name: string,
  status: string = 'completed',
  date: string = '2024-05-10',
  clientName: string = 'Client'
): number => {
  const info = run(
    `INSERT INTO sessions (fileName, clientName, sessionName, date, sessionType, therapy, status)
     VALUES ('audio.mp3', ?, ?, ?, 'intake', 'cbt', ?)`,
    clientName,
    name,
    date,
    status
  );
  return info.lastInsertRowid as number;
};

const insertChat = (sessionId: number | null): number => {
  const info = run(
    'INSERT INTO chats (sessionId, timestamp, name, tags) VALUES (?, ?, ?, ?)',
    sessionId,
    T0,
    null,
    null
  );
  return info.lastInsertRowid as number;
};

const insertMessage = (opts: {
  chatId: number;
  sender: 'user' | 'ai';
  text: string;
  timestamp: number;
  promptTokens?: number | null;
  completionTokens?: number | null;
  model?: string | null;
}): number => {
  // Explicit null must stay null (welcome messages); only `undefined` means
  // "use the default", so `??` cannot be used here.
  const completionTokens =
    opts.completionTokens === undefined
      ? opts.sender === 'ai'
        ? 10
        : null
      : opts.completionTokens;
  const info = run(
    `INSERT INTO messages (chatId, sender, text, timestamp, promptTokens, completionTokens, duration, isTruncated, model)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    opts.chatId,
    opts.sender,
    opts.text,
    opts.timestamp,
    opts.promptTokens ?? null,
    completionTokens,
    null,
    0,
    opts.model ?? null
  );
  return info.lastInsertRowid as number;
};

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verification-repo-test-'));
  configureDb({ dbPath: path.join(tmpDir, 'test.db'), isDev: false });
  // Trigger lazy DB init (migrations to V21 + template seeding).
  run('SELECT 1');
});

afterAll(() => {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  run('DELETE FROM verified_statements');
  run('DELETE FROM message_verifications');
  run('DELETE FROM verification_jobs');
  run('DELETE FROM messages');
  run('DELETE FROM chats');
  run('DELETE FROM sessions');
});

describe('messageRepository model capture', () => {
  it('stores the authoring model on ai messages', () => {
    const sessionId = insertSession('S1');
    const chatId = insertChat(sessionId);
    const ai = messageRepository.addMessage(
      chatId,
      'ai',
      'hello',
      5,
      10,
      100,
      false,
      'llama-3-test'
    );
    expect(ai.model).toBe('llama-3-test');

    const fetched = messageRepository.findMessageById(ai.id);
    expect(fetched?.model).toBe('llama-3-test');
  });

  it('defaults model to null when not provided', () => {
    const sessionId = insertSession('S1');
    const chatId = insertChat(sessionId);
    const user = messageRepository.addMessage(chatId, 'user', 'hi');
    expect(user.model).toBeNull();
  });
});

describe('verificationRepository job lifecycle', () => {
  it('creates, finds, updates, and counts jobs', () => {
    const job = verificationRepository.createVerificationJob({
      scope: 'selected_sessions',
      sessionIds: [3, 7],
      skipVerified: true,
      modelName: 'judge-1',
      contextSize: 8192,
      thinkingBudget: 1024,
      temperature: 0.2,
      topP: 0.9,
      repeatPenalty: 1.1,
      numGpuLayers: 99,
      llmBaseUrl: 'http://localhost:1234/v1',
    });
    expect(job.id).toBeGreaterThan(0);
    expect(job.status).toBe('pending');
    expect(job.scope).toBe('selected_sessions');
    expect(job.session_ids_json).toBe('[3,7]');
    expect(job.skip_verified).toBe(true);
    expect(job.model_name).toBe('judge-1');
    expect(job.num_gpu_layers).toBe(99);

    const found = verificationRepository.findVerificationJobById(job.id);
    expect(found?.id).toBe(job.id);
    expect(found?.skip_verified).toBe(true);

    expect(verificationRepository.findVerificationJobById(999999)).toBeNull();

    const second = verificationRepository.createVerificationJob({
      scope: 'all_unverified',
      skipVerified: false,
    });
    expect(second.skip_verified).toBe(false);
    const jobs = verificationRepository.findAllVerificationJobs();
    expect(jobs.map((j) => j.id)).toContain(job.id);
    expect(jobs.map((j) => j.id)).toContain(second.id);

    expect(
      verificationRepository.updateJobStatus(job.id, 'processing', {
        totalMessages: 5,
      })
    ).toBe(true);
    const processing = verificationRepository.findVerificationJobById(job.id);
    expect(processing?.status).toBe('processing');
    expect(processing?.total_messages).toBe(5);
    expect(processing?.completed_at).toBeNull();

    expect(
      verificationRepository.incrementJobCounters(job.id, {
        processedMessages: 2,
        totalStatements: 10,
        flaggedStatements: 3,
        omissionsCount: 1,
      })
    ).toBe(true);
    const counted = verificationRepository.findVerificationJobById(job.id);
    expect(counted?.processed_messages).toBe(2);
    expect(counted?.total_statements).toBe(10);
    expect(counted?.flagged_statements).toBe(3);
    expect(counted?.omissions_count).toBe(1);

    expect(verificationRepository.updateJobStatus(job.id, 'completed')).toBe(
      true
    );
    const done = verificationRepository.findVerificationJobById(job.id);
    expect(done?.status).toBe('completed');
    expect(done?.completed_at).not.toBeNull();

    expect(
      verificationRepository.updateJobStatus(second.id, 'failed', {
        errorMessage: 'boom',
      })
    ).toBe(true);
    expect(
      verificationRepository.findVerificationJobById(second.id)?.error_message
    ).toBe('boom');
  });
});

describe('transitionJobToProcessing', () => {
  it('transitions pending jobs but never revives terminal jobs', () => {
    const pending = verificationRepository.createVerificationJob({
      scope: 'all_unverified',
    });
    expect(
      verificationRepository.transitionJobToProcessing(pending.id, {
        totalMessages: 3,
      })
    ).toBe(true);
    const processing = verificationRepository.findVerificationJobById(
      pending.id
    );
    expect(processing?.status).toBe('processing');
    expect(processing?.total_messages).toBe(3);

    for (const terminal of ['completed', 'failed', 'canceled'] as const) {
      const job = verificationRepository.createVerificationJob({
        scope: 'all_unverified',
      });
      expect(verificationRepository.updateJobStatus(job.id, terminal)).toBe(
        true
      );
      expect(
        verificationRepository.transitionJobToProcessing(job.id, {
          totalMessages: 7,
        })
      ).toBe(false);
      const row = verificationRepository.findVerificationJobById(job.id);
      expect(row?.status).toBe(terminal);
      expect(row?.total_messages).toBe(0);
    }

    expect(verificationRepository.transitionJobToProcessing(999999)).toBe(
      false
    );
  });
});

describe('findCandidateMessagesForVerification', () => {
  const seedScenario = () => {
    const sessionId = insertSession('Main');
    const chatId = insertChat(sessionId);
    insertMessage({
      chatId,
      sender: 'user',
      text: 'How is the patient sleeping?',
      timestamp: T0,
    });
    const a1 = insertMessage({
      chatId,
      sender: 'ai',
      text: 'The patient sleeps well.',
      timestamp: T0 + 1000,
      model: 'model-a',
    });
    insertMessage({
      chatId,
      sender: 'user',
      text: 'Any anxiety symptoms?',
      timestamp: T0 + 2000,
    });
    const a2 = insertMessage({
      chatId,
      sender: 'ai',
      text: 'Yes, panic attacks nightly.',
      timestamp: T0 + 3000,
      model: 'model-b',
    });
    // Welcome message: completionTokens NULL + stock text.
    insertMessage({
      chatId,
      sender: 'ai',
      text: 'Session "Main" has been transcribed and is ready for analysis.',
      timestamp: T0 + 4000,
      completionTokens: null,
    });
    // Empty message.
    insertMessage({
      chatId,
      sender: 'ai',
      text: '   ',
      timestamp: T0 + 5000,
    });
    return { sessionId, chatId, a1, a2 };
  };

  it('returns newest-first with preceding user questions, excluding welcome/empty', () => {
    const { sessionId, a1, a2 } = seedScenario();
    const candidates =
      verificationRepository.findCandidateMessagesForVerification({
        scope: 'all_unverified',
      });
    expect(candidates.map((c) => c.id)).toEqual([a2, a1]);
    expect(candidates[0]?.sessionId).toBe(sessionId);
    expect(candidates[0]?.userQuestion).toBe('Any anxiety symptoms?');
    expect(candidates[1]?.userQuestion).toBe('How is the patient sleeping?');
    expect(candidates[0]?.model).toBe('model-b');
  });

  it('excludes standalone chats and non-completed sessions', () => {
    seedScenario();
    const standaloneChat = insertChat(null);
    insertMessage({
      chatId: standaloneChat,
      sender: 'ai',
      text: 'Standalone answer.',
      timestamp: T0 + 9000,
    });
    const pendingSession = insertSession('Pending', 'transcribing');
    const pendingChat = insertChat(pendingSession);
    insertMessage({
      chatId: pendingChat,
      sender: 'ai',
      text: 'Pending answer.',
      timestamp: T0 + 9500,
    });
    const candidates =
      verificationRepository.findCandidateMessagesForVerification({
        scope: 'all_unverified',
      });
    expect(candidates).toHaveLength(2);
  });

  it('skips verified messages by default and re-includes with skipVerified=false', () => {
    const { sessionId, chatId, a1, a2 } = seedScenario();
    verificationRepository.saveMessageVerificationResult({
      messageId: a2,
      chatId,
      sessionId,
      authoredModel: 'model-b',
      judgeModel: 'judge-1',
      totalClaims: 1,
      supportedClaims: 1,
      accuracyScore: 1,
    });
    const skipped = verificationRepository.findCandidateMessagesForVerification(
      {
        scope: 'all_unverified',
      }
    );
    expect(skipped.map((c) => c.id)).toEqual([a1]);

    const forced = verificationRepository.findCandidateMessagesForVerification({
      scope: 'all_force',
      skipVerified: false,
    });
    expect(forced.map((c) => c.id)).toEqual([a2, a1]);
  });

  it.each([undefined, true, false])(
    // Task 12: all_force owns its skip behavior — completed verifications
    // are always re-selected, even with an omitted or conflicting flag
    // (e.g. a pre-fix or restored row with skip_verified=true).
    'all_force includes previously completed messages with skipVerified=%s',
    (skipVerified) => {
      const { sessionId, chatId, a1, a2 } = seedScenario();
      verificationRepository.saveMessageVerificationResult({
        messageId: a2,
        chatId,
        sessionId,
        authoredModel: 'model-b',
        judgeModel: 'judge-1',
        totalClaims: 1,
        supportedClaims: 1,
        accuracyScore: 1,
      });
      const candidates =
        verificationRepository.findCandidateMessagesForVerification({
          scope: 'all_force',
          ...(skipVerified === undefined ? {} : { skipVerified }),
        });
      expect(candidates.map((c) => c.id)).toEqual([a2, a1]);
    }
  );

  it.each([undefined, true, false])(
    // Task 12 invariant: all_unverified always excludes completed
    // verifications, even with an explicitly conflicting flag.
    'all_unverified excludes completed messages with skipVerified=%s',
    (skipVerified) => {
      const { sessionId, chatId, a1, a2 } = seedScenario();
      verificationRepository.saveMessageVerificationResult({
        messageId: a2,
        chatId,
        sessionId,
        authoredModel: 'model-b',
        judgeModel: 'judge-1',
        totalClaims: 1,
        supportedClaims: 1,
        accuracyScore: 1,
      });
      const candidates =
        verificationRepository.findCandidateMessagesForVerification({
          scope: 'all_unverified',
          ...(skipVerified === undefined ? {} : { skipVerified }),
        });
      expect(candidates.map((c) => c.id)).toEqual([a1]);
    }
  );

  it.each([undefined, true, false])(
    // Task 12: the narrowed scopes keep explicit flag behavior — the flag
    // controls selection, defaulting to skip when omitted.
    'selected_sessions honors the explicit skip flag (skipVerified=%s)',
    (skipVerified) => {
      const { sessionId, chatId, a1, a2 } = seedScenario();
      verificationRepository.saveMessageVerificationResult({
        messageId: a2,
        chatId,
        sessionId,
        authoredModel: 'model-b',
        judgeModel: 'judge-1',
        totalClaims: 1,
        supportedClaims: 1,
        accuracyScore: 1,
      });
      const candidates =
        verificationRepository.findCandidateMessagesForVerification({
          scope: 'selected_sessions',
          sessionIds: [sessionId],
          ...(skipVerified === undefined ? {} : { skipVerified }),
        });
      expect(candidates.map((c) => c.id)).toEqual(
        skipVerified === false ? [a2, a1] : [a1]
      );
    }
  );

  it.each([undefined, true, false])(
    'single_chat honors the explicit skip flag (skipVerified=%s)',
    (skipVerified) => {
      const { sessionId, chatId, a1, a2 } = seedScenario();
      verificationRepository.saveMessageVerificationResult({
        messageId: a2,
        chatId,
        sessionId,
        authoredModel: 'model-b',
        judgeModel: 'judge-1',
        totalClaims: 1,
        supportedClaims: 1,
        accuracyScore: 1,
      });
      const candidates =
        verificationRepository.findCandidateMessagesForVerification({
          scope: 'single_chat',
          chatId,
          ...(skipVerified === undefined ? {} : { skipVerified }),
        });
      expect(candidates.map((c) => c.id)).toEqual(
        skipVerified === false ? [a2, a1] : [a1]
      );
    }
  );

  it('keeps failed messages eligible under the default skip so they retry', () => {
    const { sessionId, chatId, a1, a2 } = seedScenario();
    verificationRepository.saveMessageVerificationResult({
      messageId: a2,
      chatId,
      sessionId,
      authoredModel: 'model-b',
      judgeModel: 'judge-1',
      status: 'failed',
      errorMessage: 'Session transcript has no paragraphs.',
    });
    const candidates =
      verificationRepository.findCandidateMessagesForVerification({
        scope: 'all_unverified',
      });
    expect(candidates.map((c) => c.id)).toEqual([a2, a1]);
  });

  it('filters by selected sessions and single chat', () => {
    const first = seedScenario();
    const otherSession = insertSession('Other');
    const otherChat = insertChat(otherSession);
    insertMessage({
      chatId: otherChat,
      sender: 'user',
      text: 'Other question?',
      timestamp: T0 + 7900,
    });
    insertMessage({
      chatId: otherChat,
      sender: 'ai',
      text: 'Other answer.',
      timestamp: T0 + 8000,
    });
    const selected =
      verificationRepository.findCandidateMessagesForVerification({
        scope: 'selected_sessions',
        sessionIds: [otherSession],
      });
    expect(selected).toHaveLength(1);
    expect(selected[0]?.sessionId).toBe(otherSession);

    const single = verificationRepository.findCandidateMessagesForVerification({
      scope: 'single_chat',
      chatId: first.chatId,
    });
    expect(single.map((c) => c.id)).toEqual([first.a2, first.a1]);

    const limited = verificationRepository.findCandidateMessagesForVerification(
      {
        scope: 'all_unverified',
        limit: 1,
      }
    );
    expect(limited).toHaveLength(1);
  });

  it('skips ai messages with no preceding user message (default/welcome-only chats)', () => {
    const sessionId = insertSession('NoChat');
    const welcomeChat = insertChat(sessionId);
    insertMessage({
      chatId: welcomeChat,
      sender: 'ai',
      text: 'Session "NoChat" has been transcribed and is ready for analysis.',
      timestamp: T0,
      completionTokens: null,
    });
    insertMessage({
      chatId: welcomeChat,
      sender: 'ai',
      text: 'Stray answer with no question.',
      timestamp: T0 + 1000,
    });
    // AI message preceding the user message is not a response to it.
    const reversedChat = insertChat(sessionId);
    insertMessage({
      chatId: reversedChat,
      sender: 'ai',
      text: 'Answer before question.',
      timestamp: T0 + 2000,
    });
    insertMessage({
      chatId: reversedChat,
      sender: 'user',
      text: 'Late question.',
      timestamp: T0 + 3000,
    });
    const candidates =
      verificationRepository.findCandidateMessagesForVerification({
        scope: 'all_unverified',
      });
    expect(candidates).toHaveLength(0);
  });
});

describe('saveMessageVerificationResult', () => {
  it('persists verification + statements and updates job counters atomically', () => {
    const sessionId = insertSession('S1');
    const chatId = insertChat(sessionId);
    const msgId = insertMessage({
      chatId,
      sender: 'ai',
      text: 'The patient takes aspirin daily.',
      timestamp: T0,
      model: 'model-a',
    });
    const job = verificationRepository.createVerificationJob({
      scope: 'all_unverified',
    });
    const saved = verificationRepository.saveMessageVerificationResult({
      messageId: msgId,
      chatId,
      sessionId,
      verificationJobId: job.id,
      authoredModel: 'model-a',
      judgeModel: 'judge-1',
      totalClaims: 2,
      supportedClaims: 1,
      fabricatedClaims: 1,
      omissionsCount: 1,
      accuracyScore: 1 / 3,
      summaryAssessment: 'One fabrication, one omission.',
      promptTokens: 100,
      completionTokens: 50,
      durationMs: 1234,
      statements: [
        {
          statementIndex: 0,
          kind: 'claim',
          exactQuote: 'takes aspirin daily',
          normalizedClaim: 'Patient takes aspirin daily.',
          startChar: 12,
          endChar: 29,
          verdict: 'fabricated',
          severity: 'high',
          confidence: 0.9,
          reasoning: 'No mention in transcript.',
          evidence: [],
        },
        {
          statementIndex: 1,
          kind: 'omission',
          exactQuote: '',
          normalizedClaim: 'Missed insomnia discussion.',
          verdict: 'omission',
          severity: 'medium',
          confidence: 0.8,
          reasoning: 'Transcript covers insomnia at length.',
          evidence: [
            {
              paragraphIndex: 3,
              timestampMs: 60000,
              speaker: 'SPEAKER_01',
              quote: 'I cannot sleep at all.',
            },
          ],
        },
      ],
    });
    expect(saved.message_id).toBe(msgId);
    expect(saved.accuracy_score).toBeCloseTo(1 / 3);
    expect(saved.statements).toHaveLength(2);
    expect(saved.statements?.[0]?.start_char).toBe(12);
    expect(saved.statements?.[1]?.evidence).toEqual([
      {
        paragraphIndex: 3,
        timestampMs: 60000,
        speaker: 'SPEAKER_01',
        quote: 'I cannot sleep at all.',
      },
    ]);

    const updatedJob = verificationRepository.findVerificationJobById(job.id);
    expect(updatedJob?.processed_messages).toBe(1);
    expect(updatedJob?.total_statements).toBe(3);
    expect(updatedJob?.flagged_statements).toBe(1);
    expect(updatedJob?.omissions_count).toBe(1);
  });

  it('re-saving replaces prior statements (re-audit)', () => {
    const sessionId = insertSession('S1');
    const chatId = insertChat(sessionId);
    const msgId = insertMessage({
      chatId,
      sender: 'ai',
      text: 'Answer.',
      timestamp: T0,
    });
    const base = {
      messageId: msgId,
      chatId,
      sessionId,
      judgeModel: 'judge-1',
    } as const;
    verificationRepository.saveMessageVerificationResult({
      ...base,
      totalClaims: 2,
      statements: [
        {
          statementIndex: 0,
          kind: 'claim',
          exactQuote: 'a',
          normalizedClaim: 'a',
          verdict: 'supported',
          reasoning: 'ok',
        },
        {
          statementIndex: 1,
          kind: 'claim',
          exactQuote: 'b',
          normalizedClaim: 'b',
          verdict: 'supported',
          reasoning: 'ok',
        },
      ],
    });
    const resaved = verificationRepository.saveMessageVerificationResult({
      ...base,
      judgeModel: 'judge-2',
      totalClaims: 1,
      supportedClaims: 1,
      statements: [
        {
          statementIndex: 0,
          kind: 'claim',
          exactQuote: 'a',
          normalizedClaim: 'a',
          verdict: 'supported',
          reasoning: 'ok',
        },
      ],
    });
    expect(resaved.judge_model).toBe('judge-2');
    expect(resaved.statements).toHaveLength(1);
    const byChat = verificationRepository.findVerificationsByChatId(chatId);
    expect(byChat).toHaveLength(1);
    expect(byChat[0]?.statements).toHaveLength(1);
  });

  it('supports failed status without statements', () => {
    const sessionId = insertSession('S1');
    const chatId = insertChat(sessionId);
    const msgId = insertMessage({
      chatId,
      sender: 'ai',
      text: 'Answer.',
      timestamp: T0,
    });
    const saved = verificationRepository.saveMessageVerificationResult({
      messageId: msgId,
      chatId,
      sessionId,
      judgeModel: 'judge-1',
      status: 'failed',
      errorMessage: 'Judge JSON parse error',
    });
    expect(saved.status).toBe('failed');
    expect(saved.error_message).toBe('Judge JSON parse error');
    expect(saved.statements).toHaveLength(0);
  });
});

describe('findVerificationsBySessionId', () => {
  it('returns stats plus chronological breakdown', () => {
    const sessionId = insertSession('S1');
    const chatId = insertChat(sessionId);
    insertMessage({
      chatId,
      sender: 'user',
      text: 'Question?',
      timestamp: T0 - 1000,
    });
    const m1 = insertMessage({
      chatId,
      sender: 'ai',
      text: 'First.',
      timestamp: T0,
      model: 'model-a',
    });
    const m2 = insertMessage({
      chatId,
      sender: 'ai',
      text: 'Second.',
      timestamp: T0 + 1000,
      model: 'model-a',
    });
    verificationRepository.saveMessageVerificationResult({
      messageId: m1,
      chatId,
      sessionId,
      judgeModel: 'judge-1',
      totalClaims: 1,
      fabricatedClaims: 1,
      accuracyScore: 0,
      statements: [
        {
          statementIndex: 0,
          kind: 'claim',
          exactQuote: 'First',
          normalizedClaim: 'First.',
          verdict: 'fabricated',
          severity: 'critical',
          reasoning: 'Made up.',
        },
      ],
    });
    const detail =
      verificationRepository.findVerificationsBySessionId(sessionId);
    expect(detail.totalAiMessages).toBe(2);
    expect(detail.verifiedAiMessages).toBe(1);
    expect(detail.averageAccuracy).toBe(0);
    expect(detail.flaggedIssues).toBe(1);
    expect(detail.verifications.map((v) => v.message_id)).toEqual([m1]);
    void m2;
  });

  it('reports averageAccuracy on the 0-100 percent scale', () => {
    const sessionId = insertSession('Pct');
    const chatId = insertChat(sessionId);
    insertMessage({
      chatId,
      sender: 'user',
      text: 'Question?',
      timestamp: T0 - 1000,
    });
    const m1 = insertMessage({
      chatId,
      sender: 'ai',
      text: 'Mostly right.',
      timestamp: T0,
    });
    const m2 = insertMessage({
      chatId,
      sender: 'ai',
      text: 'Half right.',
      timestamp: T0 + 1000,
    });
    verificationRepository.saveMessageVerificationResult({
      messageId: m1,
      chatId,
      sessionId,
      judgeModel: 'judge-1',
      totalClaims: 4,
      supportedClaims: 3,
      partialClaims: 1,
      accuracyScore: 0.875,
    });
    verificationRepository.saveMessageVerificationResult({
      messageId: m2,
      chatId,
      sessionId,
      judgeModel: 'judge-1',
      totalClaims: 2,
      supportedClaims: 1,
      accuracyScore: 0.5,
    });
    const detail =
      verificationRepository.findVerificationsBySessionId(sessionId);
    // Mean of 0.875 and 0.5, percent-scaled: 68.75 (not 0.6875).
    expect(detail.averageAccuracy).toBeCloseTo(68.75, 10);
  });
});

describe('getGlobalVerificationAnalytics', () => {
  const seedAnalytics = () => {
    const s1 = insertSession('S1', 'completed', '2024-05-10');
    const c1 = insertChat(s1);
    insertMessage({
      chatId: c1,
      sender: 'user',
      text: 'Question one?',
      timestamp: T0 - 1000,
    });
    const m1 = insertMessage({
      chatId: c1,
      sender: 'ai',
      text: 'Claim one.',
      timestamp: T0,
      model: 'llama',
    });
    const m2 = insertMessage({
      chatId: c1,
      sender: 'ai',
      text: 'Claim two.',
      timestamp: T0 + DAY_MS,
      model: null,
    });
    const s2 = insertSession('S2', 'completed', '2024-05-11');
    const c2 = insertChat(s2);
    insertMessage({
      chatId: c2,
      sender: 'user',
      text: 'Question two?',
      timestamp: T0 - 1000,
    });
    const m3 = insertMessage({
      chatId: c2,
      sender: 'ai',
      text: 'Unverified here.',
      timestamp: T0,
      model: 'mistral',
    });
    verificationRepository.saveMessageVerificationResult({
      messageId: m1,
      chatId: c1,
      sessionId: s1,
      authoredModel: 'llama',
      judgeModel: 'judge-1',
      totalClaims: 4,
      supportedClaims: 3,
      partialClaims: 1,
      accuracyScore: 0.875,
    });
    verificationRepository.saveMessageVerificationResult({
      messageId: m2,
      chatId: c1,
      sessionId: s1,
      judgeModel: 'judge-1',
      totalClaims: 2,
      supportedClaims: 1,
      contradictedClaims: 1,
      omissionsCount: 1,
      accuracyScore: 1 / 3,
    });
    return { s1, s2, m3 };
  };

  it('computes KPIs, byModel, overTime, and sessionsSummary', () => {
    const { s1, s2 } = seedAnalytics();
    const stats = verificationRepository.getGlobalVerificationAnalytics();
    expect(stats.totalMessagesAudited).toBe(2);
    expect(stats.totalClaims).toBe(6);
    expect(stats.supportedClaims).toBe(4);
    expect(stats.partialClaims).toBe(1);
    expect(stats.contradictedClaims).toBe(1);
    expect(stats.fabricatedClaims).toBe(0);
    expect(stats.omissions).toBe(1);
    // Pooled: (4 + 0.5*1) / (6 + 1) * 100
    expect(stats.overallAccuracyPercent).toBeCloseTo((4.5 / 7) * 100);
    expect(stats.unverifiedMessagesCount).toBe(1);

    expect(stats.byModel.map((m) => m.model).sort()).toEqual([
      'Unknown Model',
      'llama',
    ]);
    const llama = stats.byModel.find((m) => m.model === 'llama');
    expect(llama?.messagesAudited).toBe(1);
    expect(llama?.accuracyPercent).toBeCloseTo((3.5 / 4) * 100);
    expect(llama?.averageAccuracyScore).toBeCloseTo(0.875);
    const unknown = stats.byModel.find((m) => m.model === 'Unknown Model');
    expect(unknown?.contradictionRate).toBeCloseTo(50);
    expect(unknown?.omissionsPerMessage).toBe(1);

    expect(stats.overTime.map((t) => t.date)).toEqual([
      '2024-05-10',
      '2024-05-11',
    ]);
    expect(stats.overTime[0]?.messagesAudited).toBe(1);

    const summaryS1 = stats.sessionsSummary.find((s) => s.sessionId === s1);
    const summaryS2 = stats.sessionsSummary.find((s) => s.sessionId === s2);
    expect(summaryS1?.totalAiMessages).toBe(2);
    expect(summaryS1?.verifiedAiMessages).toBe(2);
    expect(summaryS1?.isFullyVerified).toBe(true);
    // Mean of 0.875 and 1/3, percent-scaled (not 0-1).
    expect(summaryS1?.averageAccuracy).toBeCloseTo(
      ((0.875 + 1 / 3) / 2) * 100,
      10
    );
    expect(summaryS2?.isFullyVerified).toBe(false);
    expect(summaryS2?.averageAccuracy).toBeNull();
  });

  it('excludes sessions with no user messages from sessionsSummary', () => {
    const empty = insertSession('Empty');
    const emptyChat = insertChat(empty);
    insertMessage({
      chatId: emptyChat,
      sender: 'ai',
      text: 'Session "Empty" has been transcribed and is ready for analysis.',
      timestamp: T0,
      completionTokens: null,
    });
    const active = insertSession('Active');
    const activeChat = insertChat(active);
    insertMessage({
      chatId: activeChat,
      sender: 'user',
      text: 'How is the patient sleeping?',
      timestamp: T0,
    });
    insertMessage({
      chatId: activeChat,
      sender: 'ai',
      text: 'The patient sleeps well.',
      timestamp: T0 + 1000,
    });
    const stats = verificationRepository.getGlobalVerificationAnalytics();
    expect(stats.sessionsSummary.map((s) => s.sessionId)).toEqual([active]);
    expect(stats.unverifiedMessagesCount).toBe(1);
  });

  it('prefers authored_model over messages.model and honors filters', () => {
    const { s1 } = seedAnalytics();
    const filtered = verificationRepository.getGlobalVerificationAnalytics({
      sessionIds: [s1],
      model: 'llama',
    });
    expect(filtered.totalMessagesAudited).toBe(1);
    expect(filtered.byModel).toHaveLength(1);
    const dated = verificationRepository.getGlobalVerificationAnalytics({
      startDate: '2024-05-11',
      endDate: '2024-05-11',
    });
    expect(dated.totalMessagesAudited).toBe(1);
    expect(dated.overTime.map((t) => t.date)).toEqual(['2024-05-11']);
  });

  it('pools per-model rates across messages instead of summing percentages', () => {
    // 7 messages x 1 fabricated + 1 contradicted of 4 claims each.
    // Pooled: 7/28*100 = 25%. Summing per-message percentages
    // (25% x 7) would give 175% — the >100% bug.
    const sessionId = insertSession('S1');
    const chatId = insertChat(sessionId);
    for (let i = 0; i < 7; i++) {
      const msgId = insertMessage({
        chatId,
        sender: 'ai',
        text: `Audited response ${i}.`,
        timestamp: T0 + i * 1000,
        model: 'pool-model',
      });
      verificationRepository.saveMessageVerificationResult({
        messageId: msgId,
        chatId,
        sessionId,
        authoredModel: 'pool-model',
        judgeModel: 'judge-1',
        totalClaims: 4,
        supportedClaims: 2,
        contradictedClaims: 1,
        fabricatedClaims: 1,
        accuracyScore: 0.5,
      });
    }
    const stats = verificationRepository.getGlobalVerificationAnalytics();
    const pooled = stats.byModel.find((m) => m.model === 'pool-model');
    expect(pooled?.messagesAudited).toBe(7);
    expect(pooled?.totalClaims).toBe(28);
    expect(pooled?.fabricationRate).toBeCloseTo(25);
    expect(pooled?.contradictionRate).toBeCloseTo(25);
    for (const stat of stats.byModel) {
      expect(stat.fabricationRate).toBeGreaterThanOrEqual(0);
      expect(stat.fabricationRate).toBeLessThanOrEqual(100);
      expect(stat.contradictionRate).toBeGreaterThanOrEqual(0);
      expect(stat.contradictionRate).toBeLessThanOrEqual(100);
    }
  });

  it('returns zero rates (not NaN) for models with no claims', () => {
    const sessionId = insertSession('S1');
    const chatId = insertChat(sessionId);
    const msgId = insertMessage({
      chatId,
      sender: 'ai',
      text: 'Claim-free response.',
      timestamp: T0,
      model: 'empty-model',
    });
    verificationRepository.saveMessageVerificationResult({
      messageId: msgId,
      chatId,
      sessionId,
      authoredModel: 'empty-model',
      judgeModel: 'judge-1',
      totalClaims: 0,
      accuracyScore: 1,
    });
    const stats = verificationRepository.getGlobalVerificationAnalytics();
    const empty = stats.byModel.find((m) => m.model === 'empty-model');
    expect(empty?.fabricationRate).toBe(0);
    expect(empty?.contradictionRate).toBe(0);
    expect(empty?.accuracyPercent).toBe(100);
  });
});

describe('failed verification accounting', () => {
  const seedMixed = () => {
    const sessionId = insertSession('S1');
    const chatId = insertChat(sessionId);
    insertMessage({
      chatId,
      sender: 'user',
      text: 'Question?',
      timestamp: T0 - 1000,
    });
    const ok = insertMessage({
      chatId,
      sender: 'ai',
      text: 'Supported answer.',
      timestamp: T0,
      model: 'model-a',
    });
    const broken = insertMessage({
      chatId,
      sender: 'ai',
      text: 'Unverifiable answer.',
      timestamp: T0 + 1000,
      model: 'model-a',
    });
    verificationRepository.saveMessageVerificationResult({
      messageId: ok,
      chatId,
      sessionId,
      judgeModel: 'judge-1',
      totalClaims: 1,
      supportedClaims: 1,
      accuracyScore: 1,
    });
    verificationRepository.saveMessageVerificationResult({
      messageId: broken,
      chatId,
      sessionId,
      judgeModel: 'judge-1',
      status: 'failed',
      errorMessage: 'Judge JSON parse error',
    });
    return { sessionId, chatId, ok, broken };
  };

  it('excludes failed rows from verified counts and reports failedAiMessages', () => {
    const { sessionId } = seedMixed();
    const detail =
      verificationRepository.findVerificationsBySessionId(sessionId);
    expect(detail.totalAiMessages).toBe(2);
    expect(detail.verifiedAiMessages).toBe(1);
    expect(detail.failedAiMessages).toBe(1);

    const stats = verificationRepository.getGlobalVerificationAnalytics();
    expect(stats.totalMessagesAudited).toBe(1);
    expect(stats.failedMessagesCount).toBe(1);
    const summary = stats.sessionsSummary.find(
      (s) => s.sessionId === sessionId
    );
    expect(summary?.totalAiMessages).toBe(2);
    expect(summary?.verifiedAiMessages).toBe(1);
    expect(summary?.failedAiMessages).toBe(1);
    expect(summary?.isFullyVerified).toBe(false);
  });

  it('reports zero failed counts when nothing failed', () => {
    const sessionId = insertSession('S1');
    const chatId = insertChat(sessionId);
    insertMessage({
      chatId,
      sender: 'user',
      text: 'Question?',
      timestamp: T0 - 1000,
    });
    const msgId = insertMessage({
      chatId,
      sender: 'ai',
      text: 'Answer.',
      timestamp: T0,
    });
    verificationRepository.saveMessageVerificationResult({
      messageId: msgId,
      chatId,
      sessionId,
      judgeModel: 'judge-1',
      totalClaims: 1,
      supportedClaims: 1,
    });
    const detail =
      verificationRepository.findVerificationsBySessionId(sessionId);
    expect(detail.verifiedAiMessages).toBe(1);
    expect(detail.failedAiMessages).toBe(0);
    const stats = verificationRepository.getGlobalVerificationAnalytics();
    expect(stats.failedMessagesCount).toBe(0);
    expect(stats.sessionsSummary[0]?.failedAiMessages).toBe(0);
  });
});

describe('hasActiveVerificationJobs', () => {
  it('returns false when no jobs exist', () => {
    expect(verificationRepository.hasActiveVerificationJobs()).toBe(false);
  });

  // NOTE: 'canceling' is also matched by hasActiveVerificationJobs(), but no
  // 'canceling' row can be persisted yet (the V20 verification_jobs CHECK
  // constraint only allows pending/processing/completed/failed/canceled),
  // so only the storable active statuses are exercised here.
  it.each(['pending', 'processing'] as const)(
    'returns true when a job is %s',
    (status) => {
      const job = verificationRepository.createVerificationJob({
        scope: 'all_unverified',
      });
      if (status !== 'pending') {
        verificationRepository.updateJobStatus(job.id, status);
      }
      expect(verificationRepository.hasActiveVerificationJobs()).toBe(true);
    }
  );

  it.each(['completed', 'failed', 'canceled'] as const)(
    'returns false when all jobs are %s',
    (status) => {
      const job = verificationRepository.createVerificationJob({
        scope: 'all_unverified',
      });
      verificationRepository.updateJobStatus(job.id, status);
      expect(verificationRepository.hasActiveVerificationJobs()).toBe(false);
    }
  );
});

describe('resetAllVerifications', () => {
  it('deletes jobs as well as verifications and statements', () => {
    const sessionId = insertSession('S1');
    const chatId = insertChat(sessionId);
    const msgId = insertMessage({
      chatId,
      sender: 'ai',
      text: 'Answer.',
      timestamp: T0,
    });
    const job = verificationRepository.createVerificationJob({
      scope: 'all_unverified',
    });
    verificationRepository.saveMessageVerificationResult({
      messageId: msgId,
      chatId,
      sessionId,
      verificationJobId: job.id,
      judgeModel: 'judge-1',
      totalClaims: 1,
      supportedClaims: 1,
      statements: [
        {
          statementIndex: 0,
          kind: 'claim',
          exactQuote: 'Answer',
          normalizedClaim: 'Answer.',
          verdict: 'supported',
          reasoning: 'ok',
        },
      ],
    });
    const idle = verificationRepository.createVerificationJob({
      scope: 'all_unverified',
    });
    void idle;

    const result = verificationRepository.resetAllVerifications();
    expect(result).toEqual({
      deletedVerifications: 1,
      deletedStatements: 1,
      deletedJobs: 2,
      deletedReviews: 0,
    });
    expect(verificationRepository.findAllVerificationJobs()).toHaveLength(0);
    expect(
      verificationRepository.findVerificationsByChatId(chatId)
    ).toHaveLength(0);
    expect(
      verificationRepository.findAllMessageVerificationsForBackup()
    ).toHaveLength(0);
    expect(
      verificationRepository.findAllVerifiedStatementsForBackup()
    ).toHaveLength(0);
  });
});

describe('findFlaggedStatements', () => {
  const seedFlagged = () => {
    const sessionId = insertSession('S1');
    const chatId = insertChat(sessionId);
    const msgId = insertMessage({
      chatId,
      sender: 'ai',
      text: 'Aspirin cures anxiety and insomnia is irrelevant.',
      timestamp: T0,
      model: 'llama',
    });
    verificationRepository.saveMessageVerificationResult({
      messageId: msgId,
      chatId,
      sessionId,
      authoredModel: 'llama',
      judgeModel: 'judge-9',
      totalClaims: 2,
      supportedClaims: 1,
      fabricatedClaims: 1,
      accuracyScore: 0.5,
      statements: [
        {
          statementIndex: 0,
          kind: 'claim',
          exactQuote: 'Aspirin cures anxiety',
          normalizedClaim: 'Aspirin cures anxiety.',
          verdict: 'fabricated',
          severity: 'critical',
          reasoning: 'No transcript support for aspirin.',
        },
        {
          statementIndex: 1,
          kind: 'claim',
          exactQuote: 'insomnia is irrelevant',
          normalizedClaim: 'Insomnia is irrelevant.',
          verdict: 'supported',
          reasoning: 'Confirmed.',
        },
      ],
    });
    return { sessionId, chatId, msgId };
  };

  it('returns only problematic verdicts with joined context', () => {
    const { sessionId, chatId, msgId } = seedFlagged();
    const result = verificationRepository.findFlaggedStatements();
    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    expect(item?.verdict).toBe('fabricated');
    expect(item?.session_id).toBe(sessionId);
    expect(item?.chatId).toBe(chatId);
    expect(item?.message_id).toBe(msgId);
    expect(item?.sessionName).toBe('S1');
    expect(item?.authoredModel).toBe('llama');
    expect(item?.judgeModel).toBe('judge-9');
  });

  it('supports verdict, severity, model, session, search, and pagination filters', () => {
    const { sessionId } = seedFlagged();
    const supportedOnly = verificationRepository.findFlaggedStatements({
      verdicts: ['supported'],
    });
    expect(supportedOnly.total).toBe(1);
    expect(supportedOnly.items[0]?.verdict).toBe('supported');
    expect(
      verificationRepository.findFlaggedStatements({ verdicts: ['omission'] })
        .total
    ).toBe(0);
    expect(
      verificationRepository.findFlaggedStatements({ severities: ['low'] })
        .total
    ).toBe(0);
    expect(
      verificationRepository.findFlaggedStatements({ severities: ['critical'] })
        .total
    ).toBe(1);
    expect(
      verificationRepository.findFlaggedStatements({ authoredModel: 'mistral' })
        .total
    ).toBe(0);
    expect(
      verificationRepository.findFlaggedStatements({
        sessionId: sessionId + 999,
      }).total
    ).toBe(0);
    expect(
      verificationRepository.findFlaggedStatements({ search: 'aspirin' }).total
    ).toBe(1);
    expect(
      verificationRepository.findFlaggedStatements({ search: 'zzz-no-match' })
        .total
    ).toBe(0);
    const paged = verificationRepository.findFlaggedStatements({
      limit: 1,
      offset: 1,
    });
    expect(paged.total).toBe(1);
    expect(paged.items).toHaveLength(0);
  });

  it('filters flagged statements by client name', () => {
    seedFlagged();
    const otherSession = insertSession(
      'S2',
      'completed',
      '2024-05-11',
      'Other Client'
    );
    const otherChat = insertChat(otherSession);
    const otherMsg = insertMessage({
      chatId: otherChat,
      sender: 'ai',
      text: 'Insomnia cures anxiety.',
      timestamp: T0,
      model: 'llama',
    });
    verificationRepository.saveMessageVerificationResult({
      messageId: otherMsg,
      chatId: otherChat,
      sessionId: otherSession,
      authoredModel: 'llama',
      judgeModel: 'judge-9',
      totalClaims: 1,
      fabricatedClaims: 1,
      accuracyScore: 0,
      statements: [
        {
          statementIndex: 0,
          kind: 'claim',
          exactQuote: 'Insomnia cures anxiety',
          normalizedClaim: 'Insomnia cures anxiety.',
          verdict: 'fabricated',
          severity: 'high',
          reasoning: 'No transcript support.',
        },
      ],
    });

    expect(verificationRepository.findFlaggedStatements().total).toBe(2);
    const mine = verificationRepository.findFlaggedStatements({
      clientName: 'Client',
    });
    expect(mine.total).toBe(1);
    expect(mine.items[0]?.clientName).toBe('Client');
    const other = verificationRepository.findFlaggedStatements({
      clientName: 'Other Client',
    });
    expect(other.total).toBe(1);
    expect(other.items[0]?.clientName).toBe('Other Client');
    expect(
      verificationRepository.findFlaggedStatements({ clientName: 'Nobody' })
        .total
    ).toBe(0);
  });
});

describe('verification job outcome counters and phase snapshot', () => {
  it('defaults outcome counters to zero and phase to null on new jobs', () => {
    const job = verificationRepository.createVerificationJob({
      scope: 'all_unverified',
    });
    expect(job.succeeded_messages).toBe(0);
    expect(job.failed_messages).toBe(0);
    expect(job.skipped_messages).toBe(0);
    expect(job.current_phase).toBeNull();
    expect(job.current_message_id).toBeNull();
    expect(job.current_attempt).toBeNull();
    expect(job.phase_updated_at).toBeNull();
  });

  it('increments outcome counters without touching the finished-attempt total twice', () => {
    const job = verificationRepository.createVerificationJob({
      scope: 'all_unverified',
    });
    verificationRepository.incrementJobCounters(job.id, {
      succeededMessages: 2,
      failedMessages: 1,
    });
    const row = verificationRepository.findVerificationJobById(job.id);
    expect(row?.succeeded_messages).toBe(2);
    expect(row?.failed_messages).toBe(1);
    expect(row?.skipped_messages).toBe(0);
    // Outcome increments never move processed_messages (the per-message
    // save owns that write).
    expect(row?.processed_messages).toBe(0);
  });

  it('sets absolute outcome counts on terminal transitions', () => {
    const job = verificationRepository.createVerificationJob({
      scope: 'all_unverified',
    });
    verificationRepository.updateJobStatus(job.id, 'completed', {
      succeededMessages: 4,
      failedMessages: 1,
      skippedMessages: 0,
      errorMessage: 'Completed with errors: 4 of 5 checked, 1 failed',
    });
    const row = verificationRepository.findVerificationJobById(job.id);
    expect(row?.status).toBe('completed');
    expect(row?.succeeded_messages).toBe(4);
    expect(row?.failed_messages).toBe(1);
    expect(row?.error_message).toContain('Completed with errors');
  });

  it('writes and clears the live phase snapshot without touching status', () => {
    const job = verificationRepository.createVerificationJob({
      scope: 'all_unverified',
    });
    verificationRepository.updateJobStatus(job.id, 'processing');
    expect(
      verificationRepository.updateJobPhase(job.id, {
        currentPhase: 'generating',
        currentMessageId: 1914,
        currentAttempt: 1,
      })
    ).toBe(true);
    const live = verificationRepository.findVerificationJobById(job.id);
    expect(live?.status).toBe('processing');
    expect(live?.current_phase).toBe('generating');
    expect(live?.current_message_id).toBe(1914);
    expect(live?.current_attempt).toBe(1);
    expect(live?.phase_updated_at).not.toBeNull();

    expect(verificationRepository.clearJobPhase(job.id)).toBe(true);
    const terminal = verificationRepository.findVerificationJobById(job.id);
    expect(terminal?.current_phase).toBeNull();
    expect(terminal?.current_message_id).toBeNull();
    expect(terminal?.current_attempt).toBeNull();
    expect(terminal?.phase_updated_at).toBeNull();
  });

  it('derives current_message_preview from the in-flight message text', () => {
    const sessionId = insertSession('Preview Session');
    const chatId = insertChat(sessionId);
    const messageId = insertMessage({
      chatId,
      sender: 'ai',
      text: '### **SOAP Note**\n\n#### **S – Subjective**\nThe client opened the session describing mounting anxiety.',
      timestamp: T0,
    });

    const job = verificationRepository.createVerificationJob({
      scope: 'all_unverified',
    });
    expect(job.current_message_preview).toBeNull();

    verificationRepository.updateJobStatus(job.id, 'processing');
    verificationRepository.updateJobPhase(job.id, {
      currentPhase: 'generating',
      currentMessageId: messageId,
      currentAttempt: 1,
    });

    const expected = 'SOAP Note S – Subjective The client opened the…';
    expect(
      verificationRepository.findVerificationJobById(job.id)
        ?.current_message_preview
    ).toBe(expected);
    // The list reader hydrates the preview too (reload path).
    const listed = verificationRepository.findAllVerificationJobs(100);
    expect(
      listed.find((row) => row.id === job.id)?.current_message_preview
    ).toBe(expected);

    // Clearing the phase clears the derived preview (no extra column).
    verificationRepository.clearJobPhase(job.id);
    expect(
      verificationRepository.findVerificationJobById(job.id)
        ?.current_message_preview
    ).toBeNull();
  });

  it('maps a missing in-flight message to a null preview', () => {
    const job = verificationRepository.createVerificationJob({
      scope: 'all_unverified',
    });
    verificationRepository.updateJobPhase(job.id, {
      currentPhase: 'generating',
      currentMessageId: 424242,
      currentAttempt: 1,
    });
    const live = verificationRepository.findVerificationJobById(job.id);
    expect(live?.current_message_id).toBe(424242);
    expect(live?.current_message_preview).toBeNull();
  });
});

describe('message verification failure codes', () => {
  it('persists and re-saves the machine-readable error code', () => {
    const sessionId = insertSession('Failure Codes');
    const chatId = insertChat(sessionId);
    const userId = insertMessage({
      chatId,
      sender: 'user',
      text: 'Hi',
      timestamp: T0,
    });
    const aiId = insertMessage({
      chatId,
      sender: 'ai',
      text: 'The client takes Sertraline.',
      timestamp: T0 + 1000,
    });
    expect(userId).toBeGreaterThan(0);

    const job = verificationRepository.createVerificationJob({
      scope: 'single_chat',
      chatId,
    });
    verificationRepository.saveMessageVerificationResult({
      messageId: aiId,
      chatId,
      sessionId,
      verificationJobId: job.id,
      authoredModel: 'author-model',
      judgeModel: 'judge-model',
      status: 'failed',
      errorMessage: '[malformed_json] Judge returned invalid JSON',
      errorCode: 'malformed_json',
      promptTokens: 100,
      completionTokens: 20,
      durationMs: 1500,
      statements: [],
    });

    const byChat = verificationRepository.findVerificationsByChatId(chatId);
    expect(byChat).toHaveLength(1);
    expect(byChat[0]?.error_code).toBe('malformed_json');
    expect(byChat[0]?.error_message).toContain('[malformed_json]');

    // Re-saving without a code clears it (a later success must not inherit
    // a stale failure category).
    verificationRepository.saveMessageVerificationResult({
      messageId: aiId,
      chatId,
      sessionId,
      verificationJobId: job.id,
      authoredModel: 'author-model',
      judgeModel: 'judge-model',
      accuracyScore: 1.0,
      statements: [],
    });
    const after = verificationRepository.findVerificationsByChatId(chatId);
    expect(after[0]?.status).toBe('completed');
    expect(after[0]?.error_code).toBeNull();
  });
});

describe('findFailedVerificationsByJobId', () => {
  it('returns failed rows for one job with session names, excluding successes and other jobs', () => {
    const sessionId = insertSession(
      'Intake Session',
      'completed',
      '2024-05-10',
      'Jane Doe'
    );
    const chatId = insertChat(sessionId);
    insertMessage({ chatId, sender: 'user', text: 'Hi', timestamp: T0 });
    const failedMsg = insertMessage({
      chatId,
      sender: 'ai',
      text: 'The client takes Sertraline.',
      timestamp: T0 + 1000,
    });
    const okMsg = insertMessage({
      chatId,
      sender: 'ai',
      text: 'The client feels better.',
      timestamp: T0 + 2000,
    });
    const otherMsg = insertMessage({
      chatId,
      sender: 'ai',
      text: 'The client journals nightly.',
      timestamp: T0 + 3000,
    });

    const job = verificationRepository.createVerificationJob({
      scope: 'single_chat',
      chatId,
    });
    const otherJob = verificationRepository.createVerificationJob({
      scope: 'single_chat',
      chatId,
    });
    verificationRepository.saveMessageVerificationResult({
      messageId: failedMsg,
      chatId,
      sessionId,
      verificationJobId: job.id,
      authoredModel: 'author-model',
      judgeModel: 'judge-model',
      status: 'failed',
      errorMessage: '[empty_output] no output',
      errorCode: 'empty_output',
      promptTokens: 90,
      completionTokens: 0,
      durationMs: 1200,
      statements: [],
    });
    verificationRepository.saveMessageVerificationResult({
      messageId: okMsg,
      chatId,
      sessionId,
      verificationJobId: job.id,
      authoredModel: 'author-model',
      judgeModel: 'judge-model',
      accuracyScore: 1.0,
      statements: [],
    });
    verificationRepository.saveMessageVerificationResult({
      messageId: otherMsg,
      chatId,
      sessionId,
      verificationJobId: otherJob.id,
      authoredModel: 'author-model',
      judgeModel: 'judge-model',
      status: 'failed',
      errorMessage: '[provider_error] down',
      errorCode: 'provider_error',
      statements: [],
    });

    const failures = verificationRepository.findFailedVerificationsByJobId(
      job.id
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      messageId: failedMsg,
      chatId,
      sessionId,
      sessionName: 'Intake Session',
      clientName: 'Jane Doe',
      verificationJobId: job.id,
      judgeModel: 'judge-model',
      errorCode: 'empty_output',
      promptTokens: 90,
      durationMs: 1200,
    });

    expect(
      verificationRepository.findFailedVerificationsByJobId(otherJob.id)
    ).toHaveLength(1);
    expect(
      verificationRepository.findFailedVerificationsByJobId(999999)
    ).toHaveLength(0);
  });
});
