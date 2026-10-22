// packages/api/src/services/jobQueueService.test.ts
//
// Task-7 coverage for deterministic verification queue identity:
//
//   - addVerificationJob submits under a deterministic BullMQ `jobId`
//     derived from the SQLite row id, so re-submitting the same row (e.g.
//     after an ambiguous submission failure) returns the existing queued
//     job instead of duplicating work.
//   - isVerificationJobQueued resolves queue presence via that same id,
//     which the handler uses to reconcile a rejected submission.
//
// Reference: packages/api/src/services/jobQueueService.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockQueueAdd, mockQueueGetJob, MockQueue } = vi.hoisted(() => {
  const mockQueueAdd = vi.fn();
  const mockQueueGetJob = vi.fn();
  // The module under test constructs one Queue per queue name at import;
  // all instances share these spies (tests only invoke verification ops).
  class MockQueue {
    add = mockQueueAdd;
    getJob = mockQueueGetJob;
    getJobs = vi.fn().mockResolvedValue([]);
    close = vi.fn().mockResolvedValue(undefined);
  }
  return { mockQueueAdd, mockQueueGetJob, MockQueue };
});

vi.mock('bullmq', () => ({
  Queue: MockQueue,
}));

vi.mock('@therascript/queue', () => ({
  redisConnection: {},
  TRANSCRIPTION_QUEUE_NAME: 'transcription-jobs',
  ANALYSIS_QUEUE_NAME: 'analysis-jobs',
  VERIFICATION_QUEUE_NAME: 'verification-jobs',
}));

const {
  addVerificationJob,
  isVerificationJobQueued,
  getVerificationQueueJobId,
} = await import('./jobQueueService.js');

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('addVerificationJob deterministic queue identity', () => {
  it('submits under a deterministic jobId derived from the DB row id', async () => {
    mockQueueAdd.mockResolvedValue({ id: 'verification-7' });

    await addVerificationJob({ jobId: 7 });

    expect(mockQueueAdd).toHaveBeenCalledTimes(1);
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'process-verification',
      { jobId: 7 },
      expect.objectContaining({ jobId: 'verification-7' })
    );
    expect(getVerificationQueueJobId(7)).toBe('verification-7');
  });

  it('reuses the same queue id for the same row so retries cannot duplicate work', async () => {
    mockQueueAdd.mockResolvedValue({ id: 'verification-7' });

    await addVerificationJob({ jobId: 7 });
    await addVerificationJob({ jobId: 7 });
    await addVerificationJob({ jobId: 8 });

    const submittedIds = mockQueueAdd.mock.calls.map(
      (call) => (call[2] as { jobId: string }).jobId
    );
    // BullMQ dedupes `add` on `jobId` (returns the existing job), so the
    // retried submission for row 7 lands on the same queue job while a
    // different row gets its own identity.
    expect(submittedIds).toEqual([
      'verification-7',
      'verification-7',
      'verification-8',
    ]);
  });
});

describe('isVerificationJobQueued', () => {
  it('returns true when the deterministic queue job exists', async () => {
    mockQueueGetJob.mockResolvedValue({ id: 'verification-7' });

    await expect(isVerificationJobQueued(7)).resolves.toBe(true);
    expect(mockQueueGetJob).toHaveBeenCalledWith('verification-7');
  });

  it('returns false when the queue holds no such job', async () => {
    mockQueueGetJob.mockResolvedValue(undefined);

    await expect(isVerificationJobQueued(7)).resolves.toBe(false);
    expect(mockQueueGetJob).toHaveBeenCalledWith('verification-7');
  });
});
