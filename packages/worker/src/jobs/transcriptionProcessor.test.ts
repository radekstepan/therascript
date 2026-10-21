// packages/worker/src/jobs/transcriptionProcessor.test.ts
//
// Priority-1 coverage for the transcription worker ("The Ears"):
//   1. `groupSegmentsIntoParagraphs` — the pure function that turns raw
//      WhisperX segments into speaker-labelled paragraphs for SQLite + ES.
//      Previously unexported and untested; every session transcript flows
//      through it.
//   2. The processor's failure contracts: invalid payload, missing session,
//      WHISPER_BUSY mapping, and the missing-diarization guard.
//
// Reference: packages/worker/src/jobs/transcriptionProcessor.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Readable } from 'stream';
import type { WhisperSegment } from '@therascript/domain';

vi.mock('@therascript/config', () => ({
  default: {
    whisper: {
      apiUrl: 'http://whisper-test:8000',
      model: 'test-model',
      inactivityTimeoutMs: 600000,
    },
    elasticsearch: { url: 'http://es-test:9200' },
  },
}));

vi.mock('@therascript/data', () => ({
  sessionRepository: {
    findById: vi.fn(),
    updateMetadata: vi.fn(),
  },
  transcriptRepository: {
    insertParagraphs: vi.fn(),
  },
  messageRepository: {
    addMessage: vi.fn(),
  },
  chatRepository: {
    createChat: vi.fn(),
  },
  usageRepository: {
    insertUsageLog: vi.fn(),
  },
}));

vi.mock('@therascript/services', () => ({
  calculateTokenCount: vi.fn(() => 42),
  getAudioAbsolutePath: vi.fn((p: string) => p),
}));

vi.mock('@therascript/elasticsearch-client', () => ({
  getElasticsearchClient: vi.fn(() => ({})),
  indexDocument: vi.fn(),
  bulkIndexDocuments: vi.fn(),
  TRANSCRIPTS_INDEX: 'test-transcripts',
  MESSAGES_INDEX: 'test-messages',
}));

const mockAxiosGet = vi.fn();
const mockAxiosPost = vi.fn();
vi.mock('axios', () => ({
  default: {
    get: (...args: unknown[]) => mockAxiosGet(...args),
    post: (...args: unknown[]) => mockAxiosPost(...args),
  },
}));

vi.mock('form-data', () => ({
  default: class FakeFormData {
    append() {}
    getHeaders() {
      return {};
    }
  },
}));

vi.mock('fs', () => ({
  default: {
    createReadStream: vi.fn(() => Readable.from(['fake-audio'])),
  },
}));

const { default: processTranscriptionJob, groupSegmentsIntoParagraphs } =
  await import('./transcriptionProcessor.js');
const { sessionRepository, messageRepository, chatRepository } = await import(
  '@therascript/data'
);
const { calculateTokenCount } = await import('@therascript/services');

const seg = (
  start: number,
  end: number,
  text: string,
  speaker?: string
): WhisperSegment => ({
  start,
  end,
  text,
  ...(speaker !== undefined ? { speaker } : {}),
});

const silent = () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
};

beforeEach(() => {
  vi.clearAllMocks();
  silent();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('groupSegmentsIntoParagraphs', () => {
  it('returns [] for empty or missing input', () => {
    expect(groupSegmentsIntoParagraphs([])).toEqual([]);
  });

  it('packs a single segment into one paragraph with a rounded timestamp', () => {
    const out = groupSegmentsIntoParagraphs([seg(1.2345, 2.0, 'Hello world')]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: 0,
      timestamp: 1235,
      text: 'Hello world',
    });
  });

  it('merges adjacent same-speaker segments', () => {
    const out = groupSegmentsIntoParagraphs([
      seg(0, 1, 'Hello', 'SPEAKER_00'),
      seg(1.1, 2, 'there', 'SPEAKER_00'),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      text: 'Hello there',
      speaker: 'SPEAKER_00',
    });
  });

  it('splits on speaker change with sequential ids', () => {
    const out = groupSegmentsIntoParagraphs([
      seg(0, 1, 'Hi, how are you?', 'SPEAKER_00'),
      seg(1.1, 2, 'I am anxious.', 'SPEAKER_01'),
      seg(2.1, 3, 'Tell me more.', 'SPEAKER_00'),
    ]);
    expect(out).toHaveLength(3);
    expect(out.map((p) => p.id)).toEqual([0, 1, 2]);
    expect(out.map((p) => p.speaker)).toEqual([
      'SPEAKER_00',
      'SPEAKER_01',
      'SPEAKER_00',
    ]);
  });

  it('splits same-speaker segments on a time gap over 1s', () => {
    const out = groupSegmentsIntoParagraphs([
      seg(0, 1, 'First thought', 'SPEAKER_00'),
      seg(2.5, 3, 'Much later thought', 'SPEAKER_00'),
    ]);
    expect(out).toHaveLength(2);
    expect(out[1].timestamp).toBe(2500);
  });

  it('keeps same-speaker segments together across a small gap without punctuation', () => {
    const out = groupSegmentsIntoParagraphs([
      seg(0, 1, 'I have been feeling', 'SPEAKER_00'),
      seg(1.3, 2, 'anxious lately', 'SPEAKER_00'),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe('I have been feeling anxious lately');
  });

  it('splits on terminal punctuation when the gap exceeds 500ms', () => {
    const out = groupSegmentsIntoParagraphs([
      seg(0, 1, 'I feel fine.', 'SPEAKER_00'),
      seg(1.6, 2.2, 'Actually, not really.', 'SPEAKER_00'),
    ]);
    expect(out).toHaveLength(2);
  });

  it('does not split on punctuation when the gap is 500ms or less', () => {
    const out = groupSegmentsIntoParagraphs([
      seg(0, 1, 'I feel fine.', 'SPEAKER_00'),
      seg(1.4, 2.2, 'Actually, not really.', 'SPEAKER_00'),
    ]);
    expect(out).toHaveLength(1);
  });

  it('drops empty and whitespace-only segments', () => {
    const out = groupSegmentsIntoParagraphs([
      seg(0, 1, '   ', 'SPEAKER_00'),
      seg(1.1, 2, 'Real content', 'SPEAKER_00'),
      seg(2.1, 3, '', 'SPEAKER_00'),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe('Real content');
  });

  it('handles segments without speaker labels (diarization off)', () => {
    const out = groupSegmentsIntoParagraphs([
      seg(0, 1, 'Hello'),
      seg(1.1, 2, 'world'),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].speaker).toBeUndefined();
  });

  it('starts each paragraph timestamp at its first segment', () => {
    const out = groupSegmentsIntoParagraphs([
      seg(10, 11, 'First', 'SPEAKER_00'),
      seg(30, 31, 'Second', 'SPEAKER_00'),
    ]);
    expect(out.map((p) => p.timestamp)).toEqual([10000, 30000]);
  });
});

describe('transcription worker — processor failure contracts', () => {
  const fakeJob = (data: unknown) =>
    ({
      data,
      updateProgress: vi.fn().mockResolvedValue(undefined),
    }) as any;

  const fakeSession = {
    id: 1,
    audioPath: '/audio/test.mp3',
    clientName: 'Jane Doe',
    sessionName: 'Intake',
    date: '2026-01-01',
    sessionType: null,
    therapy: null,
  };

  it('rejects an invalid payload before touching the database', async () => {
    await expect(processTranscriptionJob(fakeJob({}))).rejects.toThrow(
      'Invalid transcription job payload'
    );
    expect(sessionRepository.findById).not.toHaveBeenCalled();
  });

  it('rejects a negative sessionId payload', async () => {
    await expect(
      processTranscriptionJob(fakeJob({ sessionId: -1 }))
    ).rejects.toThrow('Invalid transcription job payload');
  });

  it('throws when the session does not exist', async () => {
    vi.mocked(sessionRepository.findById).mockReturnValue(undefined as any);
    await expect(
      processTranscriptionJob(fakeJob({ sessionId: 999, numSpeakers: 0 }))
    ).rejects.toThrow('Session 999 not found.');
  });

  it('maps WHISPER_BUSY to a retryable message and marks the session failed', async () => {
    vi.mocked(sessionRepository.findById).mockReturnValue(fakeSession as any);
    mockAxiosGet.mockResolvedValueOnce({ data: { status: 'ok' } }); // health
    mockAxiosPost.mockResolvedValueOnce({
      status: 202,
      data: { job_id: 'whisper-1' },
    });
    mockAxiosGet.mockResolvedValueOnce({
      data: {
        job_id: 'whisper-1',
        status: 'failed',
        error: 'WHISPER_BUSY: another job running',
      },
    });

    await expect(
      processTranscriptionJob(fakeJob({ sessionId: 1, numSpeakers: 0 }))
    ).rejects.toThrow('Transcription server is busy');

    expect(sessionRepository.updateMetadata).toHaveBeenCalledWith(1, {
      status: 'failed',
      errorMessage: expect.stringContaining('busy'),
    });
  });

  it('rejects completed jobs whose segments all lack speaker labels when diarization was requested', async () => {
    vi.mocked(sessionRepository.findById).mockReturnValue(fakeSession as any);
    // numSpeakers >= 2 → diarization readiness gate (not plain health)
    mockAxiosGet.mockResolvedValueOnce({ data: { ready: true } });
    mockAxiosPost.mockResolvedValueOnce({
      status: 202,
      data: { job_id: 'whisper-2' },
    });
    mockAxiosGet.mockResolvedValueOnce({
      data: {
        job_id: 'whisper-2',
        status: 'completed',
        result: {
          text: 'hello',
          language: 'en',
          segments: [seg(0, 1, 'hello')],
        },
      },
    });

    await expect(
      processTranscriptionJob(fakeJob({ sessionId: 1, numSpeakers: 2 }))
    ).rejects.toThrow('without diarization');
  });

  it('times out a hung Whisper job whose progress never changes', async () => {
    const { default: testConfig } = await import('@therascript/config');
    const originalTimeout = testConfig.whisper.inactivityTimeoutMs;
    // Shrink the timeout so the test only needs a few 5s polls.
    testConfig.whisper.inactivityTimeoutMs = 10000;
    vi.mocked(sessionRepository.findById).mockReturnValue(fakeSession as any);
    mockAxiosGet.mockImplementation(async (url: unknown) => {
      if (String(url).includes('/status/')) {
        return {
          data: {
            job_id: 'whisper-hung',
            status: 'processing',
            progress: 50,
            message: 'working',
          },
        };
      }
      return { data: { status: 'ok' } }; // health check
    });
    mockAxiosPost.mockResolvedValueOnce({
      status: 202,
      data: { job_id: 'whisper-hung' },
    });

    vi.useFakeTimers();
    try {
      const run = processTranscriptionJob(
        fakeJob({ sessionId: 1, numSpeakers: 0 })
      );
      const assertion = expect(run).rejects.toThrow('timed out due to');
      // Drive the 5s poll loop forward; the 10s inactivity timeout trips
      // after a few polls with unchanging progress/status/message.
      for (let i = 0; i < 10; i++) {
        await vi.advanceTimersByTimeAsync(5000);
      }
      await assertion;

      expect(sessionRepository.updateMetadata).toHaveBeenCalledWith(1, {
        status: 'failed',
        errorMessage: expect.stringContaining('timed out'),
      });
    } finally {
      vi.useRealTimers();
      testConfig.whisper.inactivityTimeoutMs = originalTimeout;
      mockAxiosGet.mockReset();
    }
  });
});

describe('transcription worker — transcript token accounting (Task 11)', () => {
  const fakeJob = (data: unknown) =>
    ({
      data,
      updateProgress: vi.fn().mockResolvedValue(undefined),
    }) as any;

  const fakeSession = {
    id: 1,
    audioPath: '/audio/test.mp3',
    clientName: 'Jane Doe',
    sessionName: 'Intake',
    date: '2026-01-01',
    sessionType: null,
    therapy: null,
  };

  it('includes the speaker prefix in the text passed to calculateTokenCount', async () => {
    vi.mocked(sessionRepository.findById).mockReturnValue(fakeSession as any);
    vi.mocked(chatRepository.createChat).mockReturnValue({ id: 10 } as any);
    vi.mocked(messageRepository.addMessage).mockReturnValue({
      id: 99,
      timestamp: 123,
    } as any);
    mockAxiosGet.mockResolvedValueOnce({ data: { ready: true } }); // diarization check
    mockAxiosPost.mockResolvedValueOnce({
      status: 202,
      data: { job_id: 'whisper-3' },
    });
    mockAxiosGet.mockResolvedValueOnce({
      data: {
        job_id: 'whisper-3',
        status: 'completed',
        duration: 60,
        result: {
          text: 'hello hi',
          language: 'en',
          segments: [
            seg(0, 1, 'Hello there', 'SPEAKER_00'),
            seg(1.1, 2, 'I feel anxious', 'SPEAKER_01'),
          ],
        },
      },
    });

    await processTranscriptionJob(fakeJob({ sessionId: 1, numSpeakers: 2 }));

    // Must match the default prompt injection format (`Speaker: text`).
    expect(calculateTokenCount).toHaveBeenCalledWith(
      'SPEAKER_00: Hello there\n\nSPEAKER_01: I feel anxious'
    );
    expect(sessionRepository.updateMetadata).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ transcriptTokenCount: 42 })
    );
  });

  it('counts plain text when segments carry no speaker labels', async () => {
    vi.mocked(sessionRepository.findById).mockReturnValue(fakeSession as any);
    vi.mocked(chatRepository.createChat).mockReturnValue({ id: 10 } as any);
    vi.mocked(messageRepository.addMessage).mockReturnValue({
      id: 99,
      timestamp: 123,
    } as any);
    mockAxiosGet.mockResolvedValueOnce({ data: { status: 'ok' } }); // health
    mockAxiosPost.mockResolvedValueOnce({
      status: 202,
      data: { job_id: 'whisper-4' },
    });
    mockAxiosGet.mockResolvedValueOnce({
      data: {
        job_id: 'whisper-4',
        status: 'completed',
        duration: 30,
        result: {
          text: 'hello world',
          language: 'en',
          segments: [seg(0, 1, 'Hello'), seg(1.1, 2, 'world')],
        },
      },
    });

    await processTranscriptionJob(fakeJob({ sessionId: 1, numSpeakers: 0 }));

    expect(calculateTokenCount).toHaveBeenCalledWith('Hello world');
  });
});
