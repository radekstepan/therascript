// @vitest-environment jsdom
// packages/ui/src/components/SessionView/SessionContent.test.tsx
//
// Paragraph deep-links (`#paragraph-<id>`) from Fact Check evidence must
// flip small screens to the Transcript tab so the scroll lands; any other
// hash (or none) leaves the active tab alone.
import { describe, it, expect } from 'vitest';
import { shouldActivateTranscriptTab } from './SessionContent';

describe('shouldActivateTranscriptTab', () => {
  it('activates for paragraph deep-links', () => {
    expect(shouldActivateTranscriptTab('#paragraph-14')).toBe(true);
  });

  it('ignores empty, missing, and unrelated hashes', () => {
    expect(shouldActivateTranscriptTab('')).toBe(false);
    expect(shouldActivateTranscriptTab(null)).toBe(false);
    expect(shouldActivateTranscriptTab(undefined)).toBe(false);
    expect(shouldActivateTranscriptTab('#top')).toBe(false);
    expect(shouldActivateTranscriptTab('paragraph-14')).toBe(false);
  });
});
