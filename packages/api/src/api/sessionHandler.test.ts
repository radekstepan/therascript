// packages/api/src/api/sessionHandler.test.ts
//
// Priority-2 coverage for the session transcript mutation handlers —
// the paths the transcript-edit UI and RenameSpeakersModal exercise:
//
//   - renameSpeakersHandler      (PATCH /api/sessions/:id/speakers)
//   - updateParagraphSpeakerHandler (per-paragraph speaker edit)
//   - updateSessionMetadata      (PATCH /api/sessions/:id, speaker preservation)
//   - updateTranscriptParagraph  (PATCH /api/sessions/:id/transcript)
//   - deleteTranscriptParagraph  (DELETE /api/sessions/:id/transcript/:index)
//
// Reference: packages/api/src/api/sessionHandler.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BadRequestError, NotFoundError } from '../errors.js';

const {
  mockSessionRepo,
  mockTranscriptRepo,
  mockChatRepo,
  mockMessageRepo,
  mockEsUpdateByQuery,
  mockGetAudioAbsolutePath,
} = vi.hoisted(() => ({
  mockSessionRepo: {
    findById: vi.fn(),
    updateMetadata: vi.fn(),
  },
  mockTranscriptRepo: {
    findParagraphsBySessionId: vi.fn(),
    updateParagraphText: vi.fn(),
    deleteParagraphByIndex: vi.fn(),
    updateParagraphSpeaker: vi.fn(),
    renameSpeaker: vi.fn(),
  },
  mockChatRepo: {
    findChatsBySessionId: vi.fn(),
  },
  mockMessageRepo: {
    findMessagesByChatId: vi.fn(),
  },
  mockEsUpdateByQuery: vi.fn(),
  mockGetAudioAbsolutePath: vi.fn(),
}));

vi.mock('@therascript/config', () => ({
  default: { elasticsearch: { url: 'http://es-test:9200' } },
}));

vi.mock('@therascript/data', () => ({
  sessionRepository: mockSessionRepo,
  chatRepository: mockChatRepo,
  transcriptRepository: mockTranscriptRepo,
  messageRepository: mockMessageRepo,
}));

vi.mock('@therascript/services', () => ({
  deleteUploadedAudioFile: vi.fn(),
  saveUploadedAudio: vi.fn(),
  calculateTokenCount: vi.fn(() => 10),
  getAudioAbsolutePath: mockGetAudioAbsolutePath,
}));

vi.mock('@therascript/elasticsearch-client', () => ({
  getElasticsearchClient: vi.fn(() => ({
    updateByQuery: mockEsUpdateByQuery,
  })),
  TRANSCRIPTS_INDEX: 'test-transcripts',
  MESSAGES_INDEX: 'test-messages',
  bulkIndexDocuments: vi.fn(),
  indexDocument: vi.fn(),
  deleteByQuery: vi.fn(),
  deleteDocument: vi.fn(),
}));

const {
  renameSpeakersHandler,
  updateParagraphSpeakerHandler,
  updateSessionMetadata,
  updateTranscriptParagraph,
  deleteTranscriptParagraph,
  getSessionAudioAvailability,
} = await import('./sessionHandler.js');
const { bulkIndexDocuments, indexDocument, deleteDocument } = await import(
  '@therascript/elasticsearch-client'
);
const { calculateTokenCount } = await import('@therascript/services');

const completedSession = {
  id: 1,
  status: 'completed',
  clientName: 'Jane Doe',
  sessionName: 'Intake',
  date: '2026-01-01',
  sessionType: null,
  therapy: null,
};

const transcribingSession = { ...completedSession, status: 'transcribing' };

const paragraphs = [
  { id: 0, timestamp: 0, text: 'Hello there', speaker: 'SPEAKER_00' },
  { id: 1, timestamp: 2000, text: 'I feel anxious', speaker: 'SPEAKER_01' },
];

const ctx = (overrides: Record<string, unknown> = {}) => ({
  sessionData: completedSession,
  body: undefined,
  params: {},
  set: {},
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockEsUpdateByQuery.mockResolvedValue({});
});

describe('renameSpeakersHandler', () => {
  it('rejects a non-array body', async () => {
    await expect(
      renameSpeakersHandler(ctx({ body: { from: 'A', to: 'B' } }) as any)
    ).rejects.toThrow(BadRequestError);
  });

  it('rejects entries with empty from/to', async () => {
    await expect(
      renameSpeakersHandler(
        ctx({ body: [{ from: 'SPEAKER_00', to: '  ' }] }) as any
      )
    ).rejects.toThrow(BadRequestError);
  });

  it('returns "No changes needed" without touching the DB when every rename is a no-op', async () => {
    const set: Record<string, unknown> = {};
    const result = await renameSpeakersHandler(
      ctx({
        body: [{ from: 'SPEAKER_00', to: 'SPEAKER_00' }],
        set,
      }) as any
    );
    expect(set.status).toBe(200);
    expect(result).toEqual({ message: 'No changes needed.' });
    expect(mockTranscriptRepo.renameSpeaker).not.toHaveBeenCalled();
  });

  it('renames each speaker in SQLite and Elasticsearch', async () => {
    const set: Record<string, unknown> = {};
    const result = await renameSpeakersHandler(
      ctx({
        body: [
          { from: 'SPEAKER_00', to: 'Therapist' },
          { from: 'SPEAKER_01', to: 'Client' },
        ],
        set,
      }) as any
    );
    expect(set.status).toBe(200);
    expect(mockTranscriptRepo.renameSpeaker).toHaveBeenCalledWith(
      1,
      'SPEAKER_00',
      'Therapist'
    );
    expect(mockTranscriptRepo.renameSpeaker).toHaveBeenCalledWith(
      1,
      'SPEAKER_01',
      'Client'
    );
    expect(mockEsUpdateByQuery).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      message: 'Speaker labels updated for session 1.',
    });
  });
});

describe('updateParagraphSpeakerHandler', () => {
  it('rejects a non-numeric paragraph index', async () => {
    await expect(
      updateParagraphSpeakerHandler(
        ctx({
          params: { paragraphIndex: 'abc' },
          body: { speaker: 'X' },
        }) as any
      )
    ).rejects.toThrow(BadRequestError);
  });

  it('rejects a negative paragraph index', async () => {
    await expect(
      updateParagraphSpeakerHandler(
        ctx({ params: { paragraphIndex: '-1' }, body: { speaker: 'X' } }) as any
      )
    ).rejects.toThrow(BadRequestError);
  });

  it('rejects an empty speaker', async () => {
    await expect(
      updateParagraphSpeakerHandler(
        ctx({
          params: { paragraphIndex: '0' },
          body: { speaker: '   ' },
        }) as any
      )
    ).rejects.toThrow(BadRequestError);
  });

  it('rejects edits on a session that is not completed', async () => {
    await expect(
      updateParagraphSpeakerHandler(
        ctx({
          sessionData: transcribingSession,
          params: { paragraphIndex: '0' },
          body: { speaker: 'Therapist' },
        }) as any
      )
    ).rejects.toThrow(BadRequestError);
  });

  it('rejects when the paragraph does not exist', async () => {
    mockTranscriptRepo.updateParagraphSpeaker.mockReturnValue(false);
    await expect(
      updateParagraphSpeakerHandler(
        ctx({
          params: { paragraphIndex: '7' },
          body: { speaker: 'Therapist' },
        }) as any
      )
    ).rejects.toThrow(BadRequestError);
  });

  it('updates the speaker and survives an Elasticsearch failure (non-fatal ES)', async () => {
    mockTranscriptRepo.updateParagraphSpeaker.mockReturnValue(true);
    mockEsUpdateByQuery.mockRejectedValueOnce(new Error('ES down'));
    const set: Record<string, unknown> = {};
    const result = await updateParagraphSpeakerHandler(
      ctx({
        params: { paragraphIndex: '1' },
        body: { speaker: '  Client  ' },
        set,
      }) as any
    );
    expect(set.status).toBe(200);
    expect(mockTranscriptRepo.updateParagraphSpeaker).toHaveBeenCalledWith(
      1,
      1,
      'Client'
    );
    expect(result).toMatchObject({ message: expect.stringContaining('1') });
  });
});

describe('updateTranscriptParagraph', () => {
  it('rejects edits on a session that is not completed', async () => {
    await expect(
      updateTranscriptParagraph(
        ctx({
          sessionData: transcribingSession,
          body: { paragraphIndex: 0, newText: 'New text' },
        }) as any
      )
    ).rejects.toThrow(BadRequestError);
  });

  it('rejects an unknown paragraph index', async () => {
    mockTranscriptRepo.findParagraphsBySessionId.mockReturnValue(paragraphs);
    await expect(
      updateTranscriptParagraph(
        ctx({ body: { paragraphIndex: 9, newText: 'New text' } }) as any
      )
    ).rejects.toThrow('Invalid paragraph index');
  });

  it('short-circuits when the text is unchanged (no DB write)', async () => {
    mockTranscriptRepo.findParagraphsBySessionId.mockReturnValue(paragraphs);
    const set: Record<string, unknown> = {};
    const result = await updateTranscriptParagraph(
      ctx({
        body: { paragraphIndex: 0, newText: '  Hello there  ' },
        set,
      }) as any
    );
    expect(set.status).toBe(200);
    expect(result).toEqual(paragraphs);
    expect(mockTranscriptRepo.updateParagraphText).not.toHaveBeenCalled();
  });

  it('updates the paragraph, token count, and ES document on change', async () => {
    const updated = [
      { ...paragraphs[0], text: 'Hello there, edited' },
      paragraphs[1],
    ];
    mockTranscriptRepo.findParagraphsBySessionId
      .mockReturnValueOnce(paragraphs)
      .mockReturnValueOnce(updated);
    mockTranscriptRepo.updateParagraphText.mockReturnValue(true);
    const set: Record<string, unknown> = {};
    const result = await updateTranscriptParagraph(
      ctx({
        body: { paragraphIndex: 0, newText: 'Hello there, edited' },
        set,
      }) as any
    );
    expect(set.status).toBe(200);
    expect(mockTranscriptRepo.updateParagraphText).toHaveBeenCalledWith(
      1,
      0,
      'Hello there, edited'
    );
    expect(mockSessionRepo.updateMetadata).toHaveBeenCalledWith(1, {
      transcriptTokenCount: 10,
    });
    expect(indexDocument).toHaveBeenCalledWith(
      expect.anything(),
      'test-transcripts',
      '1_0',
      expect.objectContaining({
        text: 'Hello there, edited',
        speaker: 'SPEAKER_00',
      })
    );
    expect(result).toEqual(updated);
  });

  it('indexes speaker as null when the paragraph has no speaker label', async () => {
    const noSpeakerParagraphs = [
      { id: 0, timestamp: 0, text: 'Hello there' },
      paragraphs[1],
    ];
    const updated = [
      { id: 0, timestamp: 0, text: 'Hello there, edited' },
      paragraphs[1],
    ];
    mockTranscriptRepo.findParagraphsBySessionId
      .mockReturnValueOnce(noSpeakerParagraphs)
      .mockReturnValueOnce(updated);
    mockTranscriptRepo.updateParagraphText.mockReturnValue(true);
    const set: Record<string, unknown> = {};
    await updateTranscriptParagraph(
      ctx({
        body: { paragraphIndex: 0, newText: 'Hello there, edited' },
        set,
      }) as any
    );
    expect(indexDocument).toHaveBeenCalledWith(
      expect.anything(),
      'test-transcripts',
      '1_0',
      expect.objectContaining({ speaker: null })
    );
  });

  it('includes the speaker prefix when recomputing the token count (Task 11)', async () => {
    const updated = [
      { ...paragraphs[0], text: 'Hello there, edited' },
      paragraphs[1],
    ];
    mockTranscriptRepo.findParagraphsBySessionId
      .mockReturnValueOnce(paragraphs)
      .mockReturnValueOnce(updated);
    mockTranscriptRepo.updateParagraphText.mockReturnValue(true);
    const set: Record<string, unknown> = {};
    await updateTranscriptParagraph(
      ctx({
        body: { paragraphIndex: 0, newText: 'Hello there, edited' },
        set,
      }) as any
    );
    // Must match the default prompt injection format (`Speaker: text`).
    expect(calculateTokenCount).toHaveBeenCalledWith(
      'SPEAKER_00: Hello there, edited\n\nSPEAKER_01: I feel anxious'
    );
  });

  it('omits the speaker prefix for paragraphs without a speaker label (Task 11)', async () => {
    const noSpeakerParagraphs = [{ id: 0, timestamp: 0, text: 'Hello there' }];
    const updated = [{ id: 0, timestamp: 0, text: 'Hello there, edited' }];
    mockTranscriptRepo.findParagraphsBySessionId
      .mockReturnValueOnce(noSpeakerParagraphs)
      .mockReturnValueOnce(updated);
    mockTranscriptRepo.updateParagraphText.mockReturnValue(true);
    const set: Record<string, unknown> = {};
    await updateTranscriptParagraph(
      ctx({
        body: { paragraphIndex: 0, newText: 'Hello there, edited' },
        set,
      }) as any
    );
    expect(calculateTokenCount).toHaveBeenCalledWith('Hello there, edited');
  });
});

describe('updateSessionMetadata', () => {
  it('preserves the speaker field when re-indexing transcripts', async () => {
    mockSessionRepo.findById.mockReturnValue(completedSession);
    mockSessionRepo.updateMetadata.mockReturnValue({
      ...completedSession,
      clientName: 'John Smith',
    });
    mockTranscriptRepo.findParagraphsBySessionId.mockReturnValue(paragraphs);
    mockChatRepo.findChatsBySessionId.mockReturnValue([]);
    const set: Record<string, unknown> = {};
    const result = await updateSessionMetadata(
      ctx({ body: { clientName: 'John Smith' }, set }) as any
    );
    expect(set.status).toBe(200);
    expect(result).toMatchObject({ clientName: 'John Smith' });
    expect(bulkIndexDocuments).toHaveBeenCalledWith(
      expect.anything(),
      'test-transcripts',
      [
        expect.objectContaining({
          id: '1_0',
          document: expect.objectContaining({ speaker: 'SPEAKER_00' }),
        }),
        expect.objectContaining({
          id: '1_1',
          document: expect.objectContaining({ speaker: 'SPEAKER_01' }),
        }),
      ]
    );
  });

  it('indexes speaker as null for paragraphs without a speaker label', async () => {
    mockSessionRepo.findById.mockReturnValue(completedSession);
    mockSessionRepo.updateMetadata.mockReturnValue({
      ...completedSession,
      sessionName: 'Follow-up',
    });
    mockTranscriptRepo.findParagraphsBySessionId.mockReturnValue([
      { id: 0, timestamp: 0, text: 'Hello there' },
    ]);
    mockChatRepo.findChatsBySessionId.mockReturnValue([]);
    const set: Record<string, unknown> = {};
    await updateSessionMetadata(
      ctx({ body: { sessionName: 'Follow-up' }, set }) as any
    );
    expect(bulkIndexDocuments).toHaveBeenCalledWith(
      expect.anything(),
      'test-transcripts',
      [
        expect.objectContaining({
          id: '1_0',
          document: expect.objectContaining({ speaker: null }),
        }),
      ]
    );
  });
});

describe('deleteTranscriptParagraph', () => {
  it('rejects a non-numeric index', async () => {
    await expect(
      deleteTranscriptParagraph(ctx({ params: { paragraphIndex: 'x' } }) as any)
    ).rejects.toThrow(BadRequestError);
  });

  it('rejects a negative index', async () => {
    await expect(
      deleteTranscriptParagraph(
        ctx({ params: { paragraphIndex: '-2' } }) as any
      )
    ).rejects.toThrow(BadRequestError);
  });

  it('rejects deletes on a session that is not completed', async () => {
    await expect(
      deleteTranscriptParagraph(
        ctx({
          sessionData: transcribingSession,
          params: { paragraphIndex: '0' },
        }) as any
      )
    ).rejects.toThrow(BadRequestError);
  });

  it('throws NotFoundError when the paragraph does not exist', async () => {
    mockTranscriptRepo.deleteParagraphByIndex.mockReturnValue(false);
    await expect(
      deleteTranscriptParagraph(ctx({ params: { paragraphIndex: '5' } }) as any)
    ).rejects.toThrow(NotFoundError);
  });

  it('deletes the paragraph, refreshes the token count, and removes the ES doc', async () => {
    mockTranscriptRepo.deleteParagraphByIndex.mockReturnValue(true);
    mockTranscriptRepo.findParagraphsBySessionId.mockReturnValue([
      paragraphs[1],
    ]);
    const set: Record<string, unknown> = {};
    const result = await deleteTranscriptParagraph(
      ctx({ params: { paragraphIndex: '0' }, set }) as any
    );
    expect(set.status).toBe(200);
    expect(mockTranscriptRepo.deleteParagraphByIndex).toHaveBeenCalledWith(
      1,
      0
    );
    expect(deleteDocument).toHaveBeenCalledWith(
      expect.anything(),
      'test-transcripts',
      '1_0'
    );
    expect(result).toEqual([paragraphs[1]]);
  });

  it('includes the speaker prefix when recomputing the token count (Task 11)', async () => {
    mockTranscriptRepo.deleteParagraphByIndex.mockReturnValue(true);
    mockTranscriptRepo.findParagraphsBySessionId.mockReturnValue([
      paragraphs[1],
    ]);
    const set: Record<string, unknown> = {};
    await deleteTranscriptParagraph(
      ctx({ params: { paragraphIndex: '0' }, set }) as any
    );
    expect(calculateTokenCount).toHaveBeenCalledWith(
      'SPEAKER_01: I feel anxious'
    );
  });
});

describe('getSessionAudioAvailability', () => {
  // Real temp files so the existence check runs for real; only the
  // relative->absolute path resolution is mocked.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-avail-'));
  const existingFile = path.join(tmpDir, 'present.mp3');
  fs.writeFileSync(existingFile, 'fake-audio');

  it('reports available when the referenced file exists on disk', () => {
    mockGetAudioAbsolutePath.mockReturnValue(existingFile);
    const set: Record<string, unknown> = {};
    const result = getSessionAudioAvailability(
      ctx({
        sessionData: { ...completedSession, audioPath: 'present.mp3' },
        set,
      }) as any
    );
    expect(set.status).toBe(200);
    expect(result).toEqual({ available: true });
  });

  it('reports missing for a stale path whose file no longer exists', () => {
    mockGetAudioAbsolutePath.mockReturnValue(
      path.join(tmpDir, 'externally-deleted.mp3')
    );
    const set: Record<string, unknown> = {};
    const result = getSessionAudioAvailability(
      ctx({
        sessionData: { ...completedSession, audioPath: 'stale.mp3' },
        set,
      }) as any
    );
    expect(set.status).toBe(200);
    expect(result).toEqual({ available: false });
  });

  it('reports missing when the session has no audio path', () => {
    mockGetAudioAbsolutePath.mockReturnValue(null);
    const set: Record<string, unknown> = {};
    const result = getSessionAudioAvailability(
      ctx({
        sessionData: { ...completedSession, audioPath: null },
        set,
      }) as any
    );
    expect(set.status).toBe(200);
    expect(result).toEqual({ available: false });
    expect(mockGetAudioAbsolutePath).toHaveBeenCalledWith(null);
  });
});
