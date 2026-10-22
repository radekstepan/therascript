import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { configureDb, run, closeDb } from '@therascript/db';
import { sessionRepository } from './sessionRepository.js';
import { verificationRepository } from './verificationRepository.js';

const T0 = Date.UTC(2024, 4, 10, 12, 0, 0);

let tmpDir: string;

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

const insertMessage = (opts: {
  chatId: number;
  sender: 'user' | 'ai';
  text: string;
}): number => {
  const info = run(
    `INSERT INTO messages (chatId, sender, text, timestamp, promptTokens, completionTokens, duration, isTruncated, model)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    opts.chatId,
    opts.sender,
    opts.text,
    T0,
    null,
    opts.sender === 'ai' ? 10 : null,
    null,
    0,
    null
  );
  return info.lastInsertRowid as number;
};

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-repo-test-'));
  configureDb({ dbPath: path.join(tmpDir, 'test.db'), isDev: false });
  // Trigger lazy DB init (migrations + template seeding).
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

describe('findAllWithChatCounts factCheckedChatCount', () => {
  it('counts chats with at least one completed verification', () => {
    const sessionId = insertSession('S1');
    const verifiedChat = insertChat(sessionId);
    insertMessage({ chatId: verifiedChat, sender: 'user', text: 'Q?' });
    const ai1 = insertMessage({
      chatId: verifiedChat,
      sender: 'ai',
      text: 'A1.',
    });
    const ai2 = insertMessage({
      chatId: verifiedChat,
      sender: 'ai',
      text: 'A2.',
    });
    const plainChat = insertChat(sessionId);
    insertMessage({ chatId: plainChat, sender: 'user', text: 'Q?' });
    insertMessage({ chatId: plainChat, sender: 'ai', text: 'A.' });

    // Two completed verifications in one chat count once (DISTINCT).
    for (const messageId of [ai1, ai2]) {
      verificationRepository.saveMessageVerificationResult({
        messageId,
        chatId: verifiedChat,
        sessionId,
        judgeModel: 'judge-1',
        totalClaims: 1,
        supportedClaims: 1,
        accuracyScore: 1,
      });
    }

    const rows = sessionRepository.findAllWithChatCounts();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.chatCount).toBe(2);
    expect(rows[0]?.factCheckedChatCount).toBe(1);
  });

  it('ignores failed verifications and unverified sessions', () => {
    const failedSession = insertSession('Failed');
    const failedChat = insertChat(failedSession);
    insertMessage({ chatId: failedChat, sender: 'user', text: 'Q?' });
    const ai = insertMessage({ chatId: failedChat, sender: 'ai', text: 'A.' });
    verificationRepository.saveMessageVerificationResult({
      messageId: ai,
      chatId: failedChat,
      sessionId: failedSession,
      judgeModel: 'judge-1',
      status: 'failed',
      errorMessage: 'boom',
    });
    insertSession('Empty');

    const rows = sessionRepository.findAllWithChatCounts();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.factCheckedChatCount).toBe(0);
    }
    expect(rows.find((r) => r.sessionName === 'Failed')?.chatCount).toBe(1);
  });
});
