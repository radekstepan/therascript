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

const {
  mockDeleteIndex,
  mockInitializeIndices,
  mockBulkIndex,
  mockSessionRepo,
  mockTranscriptRepo,
  mockChatRepo,
  mockMessageRepo,
  mockDb,
  mockDeleteAllUploads,
} = vi.hoisted(() => ({
  mockDeleteIndex: vi.fn(),
  mockInitializeIndices: vi.fn(),
  mockBulkIndex: vi.fn(),
  mockSessionRepo: { findAll: vi.fn() },
  mockTranscriptRepo: { findParagraphsBySessionId: vi.fn() },
  mockChatRepo: { findChatsBySessionId: vi.fn(), findStandaloneChats: vi.fn() },
  mockMessageRepo: { findMessagesByChatId: vi.fn() },
  mockDb: {
    transaction: vi.fn((fn: () => void) => fn),
    exec: vi.fn(),
    pragma: vi.fn(),
  },
  mockDeleteAllUploads: vi.fn(),
}));

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
}));

vi.mock('@therascript/data', () => ({
  sessionRepository: mockSessionRepo,
  transcriptRepository: mockTranscriptRepo,
  chatRepository: mockChatRepo,
  messageRepository: mockMessageRepo,
  templateRepository: {},
  analysisRepository: {},
}));

vi.mock('@therascript/services', () => ({
  deleteAllUploads: (...args: unknown[]) => mockDeleteAllUploads(...args),
  getUploadsDir: vi.fn(() => '/tmp/uploads'),
}));

const { reindexElasticsearchService, resetAllDataService } = await import(
  './adminHandler.js'
);

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
    expect(mockDb.pragma).toHaveBeenCalledWith('user_version = 3');
    expect(mockDeleteAllUploads).toHaveBeenCalledTimes(1);
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
