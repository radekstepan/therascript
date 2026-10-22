import { describe, it, expect } from 'vitest';
import { formatMessagePreview } from './messagePreview.js';

describe('formatMessagePreview', () => {
  it('strips markdown and truncates to ~9 words with an ellipsis', () => {
    expect(
      formatMessagePreview(
        '### **SOAP Note**\n\n#### **S – Subjective**\nThe client opened the session describing mounting anxiety.'
      )
    ).toBe('SOAP Note S – Subjective The client opened the…');
  });

  it('returns short text untouched', () => {
    expect(
      formatMessagePreview('The client takes Sertraline every morning.')
    ).toBe('The client takes Sertraline every morning.');
  });

  it('strips think blocks, bullets, and collapses whitespace', () => {
    expect(
      formatMessagePreview(
        '<think>private reasoning</think>- First   item\n* Second item'
      )
    ).toBe('First item Second item');
    expect(formatMessagePreview('<think>unclosed reasoning')).toBe('');
    expect(formatMessagePreview('   ')).toBe('');
    expect(formatMessagePreview('')).toBe('');
  });

  it('caps long single-line text at ~60 characters', () => {
    const preview = formatMessagePreview(
      'Supercalifragilisticexpialidocious antidisestablishmentarianism floccinaucinihilipilification pneumonoultramicroscopicsilicovolcanoconiosis'
    );
    expect(preview.endsWith('…')).toBe(true);
    expect(preview.length).toBeLessThanOrEqual(61);
  });

  it('honors explicit word and character budgets', () => {
    expect(formatMessagePreview('one two three four five', 3, 60)).toBe(
      'one two three…'
    );
    expect(formatMessagePreview('one two three four five', 9, 7)).toBe(
      'one two…'
    );
  });
});
