import { describe, it, expect } from 'vitest';
import {
  extractVisibleAnswer,
  prepareLlmChatMessages,
  MERGED_USER_TURN_SEPARATOR,
} from './thinking.js';
import type { BackendChatMessage } from '@therascript/domain';

const msg = (
  sender: BackendChatMessage['sender'],
  text: string,
  id = 1
): BackendChatMessage => ({ id, chatId: 1, sender, text, timestamp: 0 });

describe('thinking.extractVisibleAnswer', () => {
  it('returns plain answers unchanged', () => {
    expect(extractVisibleAnswer('Just a normal sentence.')).toBe(
      'Just a normal sentence.'
    );
    expect(extractVisibleAnswer('')).toBe('');
  });

  it('removes a complete think block', () => {
    expect(
      extractVisibleAnswer('<think>internal reasoning</think>Visible answer.')
    ).toBe('Visible answer.');
  });

  it('removes multiple and multiline blocks', () => {
    const input =
      'First<think>reason one\nline two</think>Second<think>reason two</think>Third';
    expect(extractVisibleAnswer(input)).toBe('First Second Third');
  });

  it('handles mixed tag casing', () => {
    expect(extractVisibleAnswer('<THINK>loud reasoning</THINK>Answer.')).toBe(
      'Answer.'
    );
    expect(extractVisibleAnswer('<Think>Mixed</tHiNk>Answer.')).toBe('Answer.');
  });

  it('preserves answer text surrounding blocks without joining words', () => {
    expect(extractVisibleAnswer('Hello <think>reasoning</think> world')).toBe(
      'Hello  world'
    );
    expect(extractVisibleAnswer('Hello<think>r</think>world')).toBe(
      'Hello world'
    );
  });

  it('removes an unclosed opening block through the end of the text', () => {
    expect(extractVisibleAnswer('Answer <think>interrupted reasoning')).toBe(
      'Answer '
    );
    expect(extractVisibleAnswer('<think>only reasoning, no answer')).toBe('');
  });

  it('returns empty for reasoning-only text', () => {
    expect(extractVisibleAnswer('<think>only reasoning</think>').trim()).toBe(
      ''
    );
  });

  it('is safe under repeated application', () => {
    const input = 'A<think>x</think>B <THINK>y</THINK> C<think>unclosed';
    const once = extractVisibleAnswer(input);
    expect(extractVisibleAnswer(once)).toBe(once);
    expect(once).toBe('A B  C');
  });

  it('does not touch ordinary untagged prose', () => {
    const prose = 'The patient thinks about thinking deeply.';
    expect(extractVisibleAnswer(prose)).toBe(prose);
  });
});

describe('thinking.prepareLlmChatMessages', () => {
  it('extracts visible answers from assistant messages', () => {
    const out = prepareLlmChatMessages([
      msg('user', 'How is the patient?'),
      msg('ai', '<think>reasoning</think>The patient improved.', 2),
    ]);
    expect(out).toHaveLength(2);
    expect(out[1]!.text).toBe('The patient improved.');
  });

  it('omits assistant messages that become empty after extraction', () => {
    const out = prepareLlmChatMessages([
      msg('user', 'First question'),
      msg('ai', '<think>reasoning only</think>', 2),
      msg('user', 'Second question', 3),
    ]);
    // Adjacent user turns merge into one; no question is discarded.
    expect(out).toHaveLength(1);
    expect(out[0]!.sender).toBe('user');
    expect(out[0]!.text).toBe(
      `First question${MERGED_USER_TURN_SEPARATOR}Second question`
    );
  });

  it('drops leading assistant welcome messages before the first user turn', () => {
    const out = prepareLlmChatMessages([
      msg('ai', 'Welcome! Ask me anything.', 1),
      msg('user', 'Hello', 2),
      msg('ai', 'Hi there.', 3),
    ]);
    expect(out.map((m) => m.sender)).toEqual(['user', 'ai']);
    expect(out[0]!.text).toBe('Hello');
  });

  it('preserves system messages and user text verbatim', () => {
    const transcriptQuote = 'Patient said: <think>not a tag</think> literally';
    const out = prepareLlmChatMessages([
      msg('system', 'Be helpful.'),
      msg('user', transcriptQuote, 2),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]!.text).toBe('Be helpful.');
    expect(out[1]!.text).toBe(transcriptQuote);
  });

  it('does not mutate the input objects', () => {
    const ai = msg('ai', '<think>r</think>Answer', 2);
    const originalText = ai.text;
    const out = prepareLlmChatMessages([msg('user', 'Q'), ai]);
    expect(ai.text).toBe(originalText);
    expect(out[1]!.text).toBe('Answer');
    expect(out[1]).not.toBe(ai);
  });

  it('is idempotent', () => {
    const input = [
      msg('ai', 'Welcome', 1),
      msg('user', 'Q1', 2),
      msg('ai', '<think>r</think>A1', 3),
      msg('ai', '<think>empty</think>', 4),
      msg('user', 'Q2', 5),
    ];
    const once = prepareLlmChatMessages(input);
    const twice = prepareLlmChatMessages(once);
    expect(twice).toEqual(once);
  });

  it('handles a session-shaped history with stored thinking (chat-18 style fixture)', () => {
    // Synthetic fixture shaped like a long session chat: welcome + several
    // turns with stored <think> envelopes, ending in a fresh user question.
    const input = [
      msg('system', 'You are a helpful assistant.', 0),
      msg('ai', 'Hello! I can answer questions about this session.', 1),
      msg('user', 'Summarize the opening.', 2),
      msg(
        'ai',
        '<think>Let me recall the opening.</think>The session opened with a check-in.',
        3
      ),
      msg('user', 'What technique was used?', 4),
      msg(
        'ai',
        '<think>Scanning transcript.</think>Cognitive restructuring was used.',
        5
      ),
      msg('user', 'Any homework assigned?', 6),
    ];
    const out = prepareLlmChatMessages(input);
    const combined = out.map((m) => m.text).join('\n');
    expect(combined).not.toContain('<think>');
    expect(combined).not.toContain('Let me recall');
    expect(combined).not.toContain('Scanning transcript');
    expect(combined).toContain('The session opened with a check-in.');
    expect(combined).toContain('Cognitive restructuring was used.');
    expect(combined).toContain('Any homework assigned?');
    // Welcome dropped; system + 3 user + 2 assistant = 6.
    expect(out).toHaveLength(6);
    expect(out[0]!.sender).toBe('system');
    expect(out[1]!.sender).toBe('user');
  });

  it('keeps every user question when all assistant replies are reasoning-only', () => {
    const out = prepareLlmChatMessages([
      msg('user', 'Q1', 1),
      msg('ai', '<think>r1</think>', 2),
      msg('user', 'Q2', 3),
      msg('ai', '<think>r2</think>', 4),
      msg('user', 'Q3', 5),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toContain('Q1');
    expect(out[0]!.text).toContain('Q2');
    expect(out[0]!.text).toContain('Q3');
  });
});
