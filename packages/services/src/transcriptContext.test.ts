import { describe, it, expect } from 'vitest';
import {
  buildTranscriptSessionNote,
  buildTherapistNotesBlock,
} from './transcriptContext.js';

describe('buildTranscriptSessionNote', () => {
  it('states the explicit speaker count when >= 2', () => {
    const note = buildTranscriptSessionNote(2);
    expect(note).toContain('2 speakers');
    expect(note).toContain('specified at upload');
  });

  it('falls back to unknown when diarization was disabled', () => {
    for (const v of [0, 1, null, undefined]) {
      const note = buildTranscriptSessionNote(v);
      expect(note).toContain('not specified at upload');
      expect(note).toContain('number of distinct voices is unknown');
    }
  });

  it('always includes the pure-text disclaimer', () => {
    for (const v of [2, 0, null]) {
      const note = buildTranscriptSessionNote(v);
      expect(note).toContain('pure text');
      expect(note).toContain('no non-verbal communication');
      // The disclaimer names emotional states only as examples of what
      // must not be invented — it never asserts anyone felt that way.
      expect(note).toContain('Do not infer emotions');
      expect(note).toContain('unless they are explicitly stated');
    }
  });

  it('treats therapist notes as extra information, not transcript content', () => {
    const note = buildTranscriptSessionNote(3);
    expect(note).toContain('THERAPIST NOTES block before the transcript');
    expect(note).toContain('therapist may also add observations');
    expect(note).toContain('extra information');
    expect(note).toContain('explicit spoken content');
  });
});

describe('buildTherapistNotesBlock', () => {
  it('returns an empty string when there is no note', () => {
    for (const v of [null, undefined, '', '   ', '\n\t ']) {
      expect(buildTherapistNotesBlock(v)).toBe('');
    }
  });

  it('wraps the trimmed note in a delimited block', () => {
    const block = buildTherapistNotesBlock('  Patient seemed tired today.  ');
    expect(block).toContain('THERAPIST NOTES');
    expect(block).toContain('Patient seemed tired today.');
    expect(block).not.toContain('  Patient');
    expect(block).toContain('"""');
    expect(block).toContain('not spoken transcript content');
  });
});
