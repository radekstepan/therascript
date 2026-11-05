// packages/ui/src/utils/therapistNotes.test.ts
import { describe, it, expect } from 'vitest';
import {
  normalizeTherapistNote,
  isChatStaleForTherapistNote,
} from './therapistNotes';

describe('normalizeTherapistNote', () => {
  it('returns null for missing or blank notes', () => {
    for (const v of [null, undefined, '', '   ', '\n\t ']) {
      expect(normalizeTherapistNote(v)).toBeNull();
    }
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeTherapistNote('  hello  ')).toBe('hello');
  });
});

describe('isChatStaleForTherapistNote', () => {
  const user = (timestamp: number) => ({ sender: 'user', timestamp });
  const ai = (timestamp: number) => ({ sender: 'ai', timestamp });

  it('is false when there is no note', () => {
    for (const note of [null, undefined, '', '   ']) {
      expect(isChatStaleForTherapistNote(note, Date.now(), [user(1000)])).toBe(
        false
      );
    }
  });

  it('is false when the note was cleared, even with a stale timestamp', () => {
    expect(isChatStaleForTherapistNote(null, 2000, [user(1000)])).toBe(false);
  });

  it('is false for chats without user turns (new or AI-welcome-only)', () => {
    expect(isChatStaleForTherapistNote('note', 2000, [])).toBe(false);
    expect(isChatStaleForTherapistNote('note', 2000, null)).toBe(false);
    expect(isChatStaleForTherapistNote('note', 2000, [ai(1000)])).toBe(false);
  });

  it('is false when the note predates the first question', () => {
    expect(
      isChatStaleForTherapistNote('note', 1000, [user(2000), ai(3000)])
    ).toBe(false);
  });

  it('is true when the note was saved after the first question', () => {
    expect(
      isChatStaleForTherapistNote('note', 3000, [user(1000), ai(2000)])
    ).toBe(true);
  });

  it('is true when the note save shares the first-question millisecond', () => {
    expect(isChatStaleForTherapistNote('note', 1000, [user(1000)])).toBe(true);
  });

  it('is true when the revision is unknown but turns already exist', () => {
    expect(isChatStaleForTherapistNote('note', null, [user(1000)])).toBe(true);
    expect(isChatStaleForTherapistNote('note', undefined, [user(1000)])).toBe(
      true
    );
  });
});
