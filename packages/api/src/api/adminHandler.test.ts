// packages/api/src/api/adminHandler.test.ts
//
// Priority-4 coverage for the destructive admin paths. These endpoints
// wipe or rebuild all application data, so their contracts deserve
// pins:
//
//   - reindexElasticsearchService: only `completed` sessions contribute
//     transcript docs; ES index-delete failures are swallowed;
//     a critical failure returns errors instead of throwing.
//   - resetAllDataService: ES/SQLite/upload failures are aggregated
//     into `errors` (a partial failure still attempts every stage);
//     full success returns the reset confirmation.
//
// Reference: packages/api/src/api/adminHandler.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import tar from 'tar-stream';

const {
  mockDeleteIndex,
  mockInitializeIndices,
  mockBulkIndex,
  mockSessionRepo,
  mockTranscriptRepo,
  mockChatRepo,
  mockMessageRepo,
  mockVerificationRepo,
  mockDb,
  mockPrepareCalls,
  mockDeleteAllUploads,
} = vi.hoisted(() => {
  const mockPrepareCalls: Array<{ sql: string; args: unknown[] }> = [];
  return {
    mockDeleteIndex: vi.fn(),
    mockInitializeIndices: vi.fn(),
    mockBulkIndex: vi.fn(),
    mockSessionRepo: { findAll: vi.fn() },
    mockTranscriptRepo: { findParagraphsBySessionId: vi.fn() },
    mockChatRepo: {
      findChatsBySessionId: vi.fn(),
      findStandaloneChats: vi.fn(),
    },
    mockMessageRepo: { findMessagesByChatId: vi.fn() },
    mockVerificationRepo: {
      findAllJobsForBackup: vi.fn(),
      findAllMessageVerificationsForBackup: vi.fn(),
      findAllVerifiedStatementsForBackup: vi.fn(),
    },
    mockDb: {
      transaction: vi.fn((fn: () => void) => fn),
      exec: vi.fn(),
      pragma: vi.fn(),
      prepare: vi.fn((sql: string) => ({
        run: (...args: unknown[]) => {
          mockPrepareCalls.push({ sql, args });
          return { lastInsertRowid: 1, changes: 0 };
        },
      })),
    },
    mockPrepareCalls,
    mockDeleteAllUploads: vi.fn(),
  };
});

vi.mock('@therascript/elasticsearch-client', () => ({
  getElasticsearchClient: vi.fn(() => ({})),
  initializeIndices: (...args: unknown[]) => mockInitializeIndices(...args),
  deleteIndex: (...args: unknown[]) => mockDeleteIndex(...args),
  bulkIndexDocuments: (...args: unknown[]) => mockBulkIndex(...args),
  TRANSCRIPTS_INDEX: 'test-transcripts',
  MESSAGES_INDEX: 'test-messages',
}));

vi.mock('@therascript/config', () => ({
  default: { elasticsearch: { url: 'http://es-test:9200' } },
}));

vi.mock('@therascript/db', () => ({
  db: mockDb,
  schema: 'TEST SCHEMA',
  SYSTEM_PROMPT_TEMPLATES: {
    SESSION_CHAT: { title: 'system_prompt', text: 'a' },
    STANDALONE_CHAT: { title: 'system_standalone_prompt', text: 'b' },
    ANALYSIS_STRATEGIST: { title: 'system_analysis_strategist', text: 'c' },
    SHORT_PROMPT: { title: 'system_short_prompt_generator', text: 'd' },
    VERIFICATION_JUDGE: { title: 'system_verification_judge', text: 'e' },
  },
}));

vi.mock('@therascript/data', () => ({
  sessionRepository: mockSessionRepo,
  transcriptRepository: mockTranscriptRepo,
  chatRepository: mockChatRepo,
  messageRepository: mockMessageRepo,
  templateRepository: {},
  analysisRepository: {},
  verificationRepository: mockVerificationRepo,
}));

vi.mock('@therascript/services', () => ({
  deleteAllUploads: (...args: unknown[]) => mockDeleteAllUploads(...args),
  getUploadsDir: vi.fn(() => '/tmp/uploads'),
}));

const { reindexElasticsearchService, resetAllDataService, importDataService } =
  await import('./adminHandler.js');

const completedSession = {
  id: 1,
  status: 'completed',
  clientName: 'Jane Doe',
  sessionName: 'Intake',
  date: '2026-01-01',
  sessionType: 'Intake',
  therapy: 'CBT',
};

const queuedSession = { ...completedSession, id: 2, status: 'transcribing' };

beforeEach(() => {
  vi.clearAllMocks();
  mockPrepareCalls.length = 0;
  mockDeleteIndex.mockResolvedValue(undefined);
  mockInitializeIndices.mockResolvedValue(undefined);
  mockBulkIndex.mockResolvedValue(undefined);
  mockDeleteAllUploads.mockResolvedValue(undefined);
});

describe('reindexElasticsearchService', () => {
  const seedRepos = () => {
    mockSessionRepo.findAll.mockReturnValue([completedSession, queuedSession]);
    mockTranscriptRepo.findParagraphsBySessionId.mockImplementation(
      (sessionId: number) =>
        sessionId === 1
          ? [{ id: 0, timestamp: 0, text: 'Hello', speaker: 'Therapist' }]
          : []
    );
    mockChatRepo.findChatsBySessionId.mockReturnValue([]);
    mockChatRepo.findStandaloneChats.mockReturnValue([]);
    mockMessageRepo.findMessagesByChatId.mockReturnValue([]);
  };

  it('indexes transcript paragraphs only for completed sessions', async () => {
    seedRepos();
    const result = await reindexElasticsearchService();
    expect(result.transcriptsIndexed).toBe(1);
    expect(result.errors).toEqual([]);
    expect(result.message).toMatch(/Re-indexing complete/);
    // Paragraphs fetched only for the completed session.
    expect(mockTranscriptRepo.findParagraphsBySessionId).toHaveBeenCalledWith(
      1
    );
    expect(
      mockTranscriptRepo.findParagraphsBySessionId
    ).not.toHaveBeenCalledWith(2);
    // Bulk docs carry `${sessionId}_${paragraphId}` ids.
    expect(mockBulkIndex).toHaveBeenCalledWith(
      expect.anything(),
      'test-transcripts',
      [
        expect.objectContaining({
          id: '1_0',
          document: expect.objectContaining({
            session_id: 1,
            text: 'Hello',
            client_name: 'Jane Doe',
          }),
        }),
      ]
    );
  });

  it('indexes chat messages from session and standalone chats', async () => {
    mockSessionRepo.findAll.mockReturnValue([completedSession]);
    mockTranscriptRepo.findParagraphsBySessionId.mockReturnValue([]);
    mockChatRepo.findChatsBySessionId.mockReturnValue([{ id: 10 }]);
    mockChatRepo.findStandaloneChats.mockReturnValue([
      { id: 42, name: null, tags: null },
    ]);
    mockMessageRepo.findMessagesByChatId.mockImplementation((chatId: number) =>
      chatId === 10
        ? [
            {
              id: 5,
              chatId: 10,
              sender: 'user',
              text: 'Hi',
              timestamp: 123,
            },
          ]
        : [
            {
              id: 6,
              chatId: 42,
              sender: 'ai',
              text: 'Hello',
              timestamp: 124,
            },
          ]
    );

    const result = await reindexElasticsearchService();
    expect(result.messagesIndexed).toBe(2);
    const messageDocs = mockBulkIndex.mock.calls.find(
      ([, index]) => index === 'test-messages'
    )?.[2] as Array<{ id: string; document: Record<string, unknown> }>;
    expect(messageDocs.map((d) => d.id)).toEqual(['5', '6']);
    // Standalone-chat docs have null session linkage.
    expect(
      messageDocs.find((d) => d.id === '6')?.document.session_id
    ).toBeNull();
  });

  it('swallows index-deletion failures and still re-indexes', async () => {
    seedRepos();
    mockDeleteIndex.mockRejectedValue(new Error('index missing'));
    const result = await reindexElasticsearchService();
    expect(result.errors).toEqual([]);
    expect(result.transcriptsIndexed).toBe(1);
    expect(mockInitializeIndices).toHaveBeenCalledTimes(1);
  });

  it('returns errors instead of throwing on critical failure', async () => {
    mockSessionRepo.findAll.mockImplementation(() => {
      throw new Error('DB locked');
    });
    const result = await reindexElasticsearchService();
    expect(result.message).toMatch(/failed critically/);
    expect(result.errors).toEqual(['DB locked']);
  });
});

describe('resetAllDataService', () => {
  it('resets ES, SQLite, and uploads, returning the success message', async () => {
    const result = await resetAllDataService();
    expect(result).toEqual({
      message:
        'Application data and search index have been reset successfully.',
      errors: [],
    });
    expect(mockInitializeIndices).toHaveBeenCalledTimes(1);
    expect(mockDb.exec).toHaveBeenCalled();
    // The schema version is never downgraded by a reset.
    expect(mockDb.pragma).not.toHaveBeenCalled();
    expect(mockDeleteAllUploads).toHaveBeenCalledTimes(1);
  });

  it('wipes verification tables children-first and leaves the schema intact', async () => {
    await resetAllDataService();
    const execSql = mockDb.exec.mock.calls.map(
      (call: unknown[]) => call[0] as string
    );
    // Verification tables are wiped along with all other user data.
    const statementsIdx = execSql.findIndex((sql: string) =>
      sql.includes('DELETE FROM verified_statements')
    );
    const verificationsIdx = execSql.findIndex((sql: string) =>
      sql.includes('DELETE FROM message_verifications')
    );
    const jobsIdx = execSql.findIndex((sql: string) =>
      sql.includes('DELETE FROM verification_jobs')
    );
    const messagesIdx = execSql.findIndex((sql: string) =>
      sql.includes('DELETE FROM messages')
    );
    const sessionsIdx = execSql.findIndex((sql: string) =>
      sql.includes('DELETE FROM sessions')
    );
    expect(statementsIdx).toBeGreaterThanOrEqual(0);
    expect(verificationsIdx).toBeGreaterThanOrEqual(0);
    expect(jobsIdx).toBeGreaterThanOrEqual(0);
    // Children are deleted before their parents (foreign keys are ON).
    expect(statementsIdx).toBeLessThan(verificationsIdx);
    expect(verificationsIdx).toBeLessThan(jobsIdx);
    expect(verificationsIdx).toBeLessThan(messagesIdx);
    expect(messagesIdx).toBeLessThan(sessionsIdx);
    // AUTOINCREMENT counters restart so a fresh start begins at id 1.
    expect(
      execSql.some((sql: string) => sql.includes('DELETE FROM sqlite_sequence'))
    ).toBe(true);
    // No user-data table is ever dropped or rebuilt, so verification
    // tables (and every other table) stay queryable after a reset; the
    // only DROP allowed targets the legacy schema_metadata table.
    for (const sql of execSql) {
      expect(sql).not.toMatch(/CREATE TABLE/i);
      expect(sql).not.toMatch(/ALTER TABLE/i);
      if (/DROP TABLE/i.test(sql)) {
        expect(sql).toMatch(/schema_metadata/);
      }
    }
  });

  it('preserves system templates while deleting user templates', async () => {
    await resetAllDataService();
    const templateWipe = mockPrepareCalls.find(({ sql }) =>
      sql.includes('DELETE FROM templates')
    );
    expect(templateWipe).toBeDefined();
    expect(templateWipe?.sql).toMatch(/WHERE title NOT IN/);
    expect(templateWipe?.args).toEqual(
      expect.arrayContaining([
        'system_prompt',
        'system_standalone_prompt',
        'system_analysis_strategist',
        'system_short_prompt_generator',
        'system_verification_judge',
      ])
    );
  });

  it('aggregates failures from every stage without stopping', async () => {
    mockInitializeIndices.mockRejectedValue(new Error('ES down'));
    mockDb.exec.mockImplementation(() => {
      throw new Error('SQL failure');
    });
    mockDeleteAllUploads.mockRejectedValue(new Error('disk failure'));

    const result = await resetAllDataService();
    expect(result.message).toMatch(/Failed to reset/);
    expect(result.errors).toHaveLength(3);
    expect(result.errors.join('\n')).toMatch(/ES down/);
    expect(result.errors.join('\n')).toMatch(/SQL failure/);
    expect(result.errors.join('\n')).toMatch(/disk failure/);
    // Every stage was still attempted.
    expect(mockDeleteAllUploads).toHaveBeenCalledTimes(1);
  });
});

describe('importDataService message model round-trip (Task 10)', () => {
  // Backup payloads every import test needs; messages and verification
  // files are supplied per test.
  const baseEntries = (): Record<string, unknown> => ({
    'sessions.json': [
      {
        id: 1,
        fileName: 'session.mp3',
        clientName: 'Jane Doe',
        sessionName: 'Intake',
        date: '2026-01-01',
        sessionType: 'Intake',
        therapy: 'CBT',
        audioPath: null,
        status: 'completed',
        whisperJobId: null,
        transcriptTokenCount: 10,
      },
    ],
    'chats.json': [
      { id: 7, sessionId: 1, timestamp: 100, name: null, tags: null },
    ],
    'templates.json': [],
    'transcript_paragraphs.json': [],
    'analysis_jobs.json': [],
    'analysis_job_sessions.json': [],
    'intermediate_summaries.json': [],
  });

  const buildBackupFile = async (
    entries: Record<string, unknown>
  ): Promise<File> => {
    const pack = tar.pack();
    for (const [name, value] of Object.entries(entries)) {
      pack.entry({ name }, JSON.stringify(value));
    }
    pack.finalize();
    const chunks: Buffer[] = [];
    for await (const chunk of pack) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    return new File(chunks, 'backup.tar');
  };

  // The import path ends with a re-index; keep it empty.
  const seedReindexRepos = () => {
    mockSessionRepo.findAll.mockReturnValue([]);
    mockChatRepo.findChatsBySessionId.mockReturnValue([]);
    mockChatRepo.findStandaloneChats.mockReturnValue([]);
    mockMessageRepo.findMessagesByChatId.mockReturnValue([]);
    mockTranscriptRepo.findParagraphsBySessionId.mockReturnValue([]);
  };

  const messageInserts = () =>
    mockPrepareCalls.filter(({ sql }) =>
      sql.startsWith('INSERT INTO messages (')
    );

  it('round-trips author-model metadata for checked and unchecked messages', async () => {
    seedReindexRepos();
    const file = await buildBackupFile({
      ...baseEntries(),
      'messages.json': [
        {
          id: 11,
          chatId: 7,
          sender: 'user',
          text: 'Hi',
          timestamp: 101,
          promptTokens: null,
          completionTokens: null,
          model: null,
        },
        {
          id: 12,
          chatId: 7,
          sender: 'ai',
          text: 'Hello',
          timestamp: 102,
          promptTokens: 5,
          completionTokens: 6,
          model: 'llama-3.1-8b',
        },
        {
          id: 13,
          chatId: 7,
          sender: 'ai',
          text: 'Follow-up',
          timestamp: 103,
          promptTokens: 7,
          completionTokens: 8,
          model: 'mistral-7b-instruct',
        },
      ],
      'verification_jobs.json': [
        {
          id: 3,
          status: 'completed',
          scope: 'single_chat',
          session_ids_json: '[1]',
          chat_id: 7,
          skip_verified: true,
          total_messages: 1,
          processed_messages: 1,
          total_statements: 1,
          flagged_statements: 0,
          omissions_count: 0,
          created_at: 200,
          completed_at: 201,
          error_message: null,
          model_name: 'judge-v1',
          context_size: 8192,
          thinking_budget: 512,
          temperature: 0.3,
          top_p: 0.9,
          repeat_penalty: 1.1,
          num_gpu_layers: 20,
          llm_base_url: 'http://localhost:1234',
        },
      ],
      // Message 12 is checked; message 13 is unchecked.
      'message_verifications.json': [
        {
          id: 4,
          message_id: 12,
          chat_id: 7,
          session_id: 1,
          verification_job_id: 3,
          authored_model: 'llama-3.1-8b',
          judge_model: 'judge-v1',
          status: 'completed',
          total_claims: 1,
          supported_claims: 1,
          partial_claims: 0,
          contradicted_claims: 0,
          fabricated_claims: 0,
          omissions_count: 0,
          accuracy_score: 1,
          summary_assessment: 'All supported',
          prompt_tokens: 10,
          completion_tokens: 20,
          duration_ms: 100,
          verified_at: 202,
          error_message: null,
        },
      ],
      'verified_statements.json': [],
    });

    const result = await importDataService(file);
    expect(result.message).toMatch(/Import successful/);

    const inserts = messageInserts();
    expect(inserts).toHaveLength(3);
    for (const { sql } of inserts) {
      expect(sql).toContain('model');
    }
    // Model attribution survives the restore for both the checked and
    // the unchecked message, so a forced re-audit reports the real
    // author instead of Unknown Model.
    expect(inserts.map(({ args }) => args[6])).toEqual([
      null,
      'llama-3.1-8b',
      'mistral-7b-instruct',
    ]);
    // Token counts are preserved alongside the model.
    expect(inserts[1].args.slice(4, 6)).toEqual([5, 6]);

    // The checked message's audit snapshot survives alongside it.
    const mvInsert = mockPrepareCalls.find(({ sql }) =>
      sql.startsWith('INSERT INTO message_verifications (')
    );
    expect(mvInsert?.args[4]).toBe('llama-3.1-8b');
  });

  it('imports pre-feature backups that omit the model field', async () => {
    seedReindexRepos();
    const file = await buildBackupFile({
      ...baseEntries(),
      'messages.json': [
        {
          id: 21,
          chatId: 7,
          sender: 'user',
          text: 'Hi',
          timestamp: 101,
          promptTokens: null,
          completionTokens: null,
        },
        {
          id: 22,
          chatId: 7,
          sender: 'ai',
          text: 'Old answer',
          timestamp: 102,
          promptTokens: 3,
          completionTokens: 4,
        },
      ],
    });

    const result = await importDataService(file);
    expect(result.message).toMatch(/Import successful/);

    const inserts = messageInserts();
    expect(inserts).toHaveLength(2);
    expect(inserts.map(({ args }) => args[6])).toEqual([null, null]);
    expect(inserts[1].args.slice(4, 6)).toEqual([3, 4]);
  });
});

describe('importDataService interrupted verification jobs (Task 11)', () => {
  // A backup taken while audits were running contains pending/processing
  // rows, but the restore target has an empty queue with no worker
  // processing them. Restoring those statuses verbatim would leave
  // permanently active rows that hasActiveVerificationJobs() blocks new
  // audits and verification resets on. The import must reconcile them
  // into a terminal, recoverable state instead.
  const baseEntries = (): Record<string, unknown> => ({
    'sessions.json': [
      {
        id: 1,
        fileName: 'session.mp3',
        clientName: 'Jane Doe',
        sessionName: 'Intake',
        date: '2026-01-01',
        sessionType: 'Intake',
        therapy: 'CBT',
        audioPath: null,
        status: 'completed',
        whisperJobId: null,
        transcriptTokenCount: 10,
      },
    ],
    'chats.json': [
      { id: 7, sessionId: 1, timestamp: 100, name: null, tags: null },
    ],
    'messages.json': [],
    'templates.json': [],
    'transcript_paragraphs.json': [],
    'analysis_jobs.json': [],
    'analysis_job_sessions.json': [],
    'intermediate_summaries.json': [],
    'message_verifications.json': [],
    'verified_statements.json': [],
  });

  const buildBackupFile = async (
    entries: Record<string, unknown>
  ): Promise<File> => {
    const pack = tar.pack();
    for (const [name, value] of Object.entries(entries)) {
      pack.entry({ name }, JSON.stringify(value));
    }
    pack.finalize();
    const chunks: Buffer[] = [];
    for await (const chunk of pack) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    return new File(chunks, 'backup.tar');
  };

  const seedReindexRepos = () => {
    mockSessionRepo.findAll.mockReturnValue([]);
    mockChatRepo.findChatsBySessionId.mockReturnValue([]);
    mockChatRepo.findStandaloneChats.mockReturnValue([]);
    mockMessageRepo.findMessagesByChatId.mockReturnValue([]);
    mockTranscriptRepo.findParagraphsBySessionId.mockReturnValue([]);
  };

  const verificationJobInserts = () =>
    mockPrepareCalls.filter(({ sql }) =>
      sql.startsWith('INSERT INTO verification_jobs (')
    );

  const makeJob = (id: number, status: string) => ({
    id,
    status,
    scope: 'all_unverified',
    session_ids_json: '[1]',
    chat_id: null,
    skip_verified: true,
    total_messages: 2,
    processed_messages: 1,
    total_statements: 0,
    flagged_statements: 0,
    omissions_count: 0,
    created_at: 200,
    completed_at: null,
    error_message: null,
    model_name: 'judge-v1',
    context_size: 8192,
    thinking_budget: 512,
    temperature: 0.3,
    top_p: 0.9,
    repeat_penalty: 1.1,
    num_gpu_layers: 20,
    llm_base_url: 'http://localhost:1234',
  });

  it('restores pending and processing jobs as failed with a restoration explanation', async () => {
    seedReindexRepos();
    const file = await buildBackupFile({
      ...baseEntries(),
      'verification_jobs.json': [
        makeJob(1, 'pending'),
        makeJob(2, 'processing'),
      ],
    });

    const result = await importDataService(file);
    expect(result.message).toMatch(/Import successful/);

    const inserts = verificationJobInserts();
    expect(inserts).toHaveLength(2);
    // INSERT column order: status is args[0], succeeded/failed/skipped
    // args[7..9], completed_at args[14], error_message args[15].
    for (const { args } of inserts) {
      expect(args[0]).toBe('failed');
      expect(args[14]).toEqual(expect.any(Number));
      expect(args[15]).toMatch(/interrupted by backup restore/i);
    }
    // No restored row may remain active: the hasActiveVerificationJobs()
    // guard (pending/processing/canceling) must not block new audits.
    for (const { args } of inserts) {
      expect(['pending', 'processing', 'canceling']).not.toContain(args[0]);
    }
  });

  it('restores terminal jobs verbatim', async () => {
    seedReindexRepos();
    const file = await buildBackupFile({
      ...baseEntries(),
      'verification_jobs.json': [
        { ...makeJob(3, 'completed'), completed_at: 300 },
        {
          ...makeJob(4, 'failed'),
          completed_at: 301,
          error_message: 'Judge model timed out',
        },
        { ...makeJob(5, 'canceled'), completed_at: 302 },
      ],
    });

    const result = await importDataService(file);
    expect(result.message).toMatch(/Import successful/);

    const inserts = verificationJobInserts();
    expect(inserts).toHaveLength(3);
    expect(inserts.map(({ args }) => args[0])).toEqual([
      'completed',
      'failed',
      'canceled',
    ]);
    // Untouched rows keep their original completion metadata.
    expect(inserts[0].args[14]).toBe(300);
    expect(inserts[0].args[15]).toBeNull();
    expect(inserts[1].args[15]).toBe('Judge model timed out');
    expect(inserts[2].args[14]).toBe(302);
    // Pre-V21 backups lack outcome counters: restored as zeros.
    for (const { args } of inserts) {
      expect(args[7]).toBe(0);
      expect(args[8]).toBe(0);
      expect(args[9]).toBe(0);
    }
  });
});
