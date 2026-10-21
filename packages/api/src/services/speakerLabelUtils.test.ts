import { describe, it, expect } from 'vitest';

import { stripSpeakerLabelsFromHistory } from './speakerLabelUtils.js';

describe('speakerLabelUtils.stripSpeakerLabelsFromHistory', () => {
  it('strips line-start SPEAKER_\\d+ labels (stale history)', () => {
    expect(
      stripSpeakerLabelsFromHistory(
        'SPEAKER_00: Hello there\nSPEAKER_01: I feel anxious'
      )
    ).toBe('Hello there\nI feel anxious');
  });

  it('preserves prose labels like Summary:, Note:, Example:, Question:', () => {
    const prose =
      'Summary: the patient reports anxiety.\nNote: follow up next week.\nExample: breathing exercises.\nQuestion: how often?';
    expect(stripSpeakerLabelsFromHistory(prose)).toBe(prose);
  });

  it('preserves mid-line SPEAKER_\\d+ mentions and capitalized words', () => {
    const text = 'As SPEAKER_00 said, John: hello is quoted mid-line.';
    expect(stripSpeakerLabelsFromHistory(text)).toBe(text);
  });

  it('preserves line-start capitalized words that are not diarization labels', () => {
    const text = 'John: quoted line-start name stays\nTherapist: also stays';
    expect(stripSpeakerLabelsFromHistory(text)).toBe(text);
  });

  it('leaves text without labels untouched', () => {
    expect(stripSpeakerLabelsFromHistory('plain text')).toBe('plain text');
    expect(stripSpeakerLabelsFromHistory('')).toBe('');
  });
});
