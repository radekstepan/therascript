import { describe, it, expect } from 'vitest';
import {
  cleanLlmOutput,
  isNodeError,
  createSessionListDTO,
} from './helpers.js';
import type { BackendSession } from '@therascript/domain';

describe('helpers.cleanLlmOutput', () => {
  it('removes known tokens and trims/normalizes whitespace', () => {
    const input = `Hello <|end_of_turn|> world\n\n<start_of_turn>user  [INST]  Text </s>  `;
    const out = cleanLlmOutput(input);
    expect(out).toBe('Hello world Text');
  });

  it('is idempotent for clean strings', () => {
    const input = 'Just a normal sentence.';
    expect(cleanLlmOutput(input)).toBe(input);
  });
});

describe('helpers.isNodeError', () => {
  it('returns true for Error with code', () => {
    const err: any = new Error('boom');
    err.code = 'ENOENT';
    expect(isNodeError(err)).toBe(true);
  });

  it('returns false for non-error values', () => {
    expect(isNodeError({})).toBe(false);
    expect(isNodeError('x')).toBe(false);
  });
});

describe('helpers.createSessionListDTO', () => {
  it('omits chats and preserves other fields', () => {
    const session: BackendSession = {
      id: 1,
      fileName: 'a',
      clientName: 'c',
      sessionName: 's',
      date: '2020-01-01',
      sessionType: 'type',
      therapy: 't',
      status: 'done',
      whisperJobId: null,
      audioPath: null,
      transcriptTokenCount: 123,
      chats: [{ id: 1, sessionId: 1, timestamp: 0, name: 'n', tags: null }],
    } as any;
    const dto = createSessionListDTO(session);
    expect(dto).toMatchObject({
      id: 1,
      fileName: 'a',
      transcriptTokenCount: 123,
    });
  });
});
