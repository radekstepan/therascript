import { describe, it, expect, vi } from 'vitest';
import {
  cleanLlmOutput,
  isNodeError,
  createSessionListDTO,
  extractJsonObject,
  parseJsonObjectFromLlm,
  withBackoff,
  streamWithRetry,
} from './helpers.js';
import type { BackendSession } from '@therascript/domain';

describe('helpers.cleanLlmOutput', () => {
  it('removes known tokens and preserves formatting', () => {
    const input = `Hello <|end_of_turn|> world\n\n<start_of_turn>user  [INST]  Text </s>  `;
    const out = cleanLlmOutput(input);
    expect(out).toBe('Hello  world\n\n    Text');
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

describe('helpers.extractJsonObject', () => {
  it('extracts a fenced ```json block', () => {
    const text = '```json\n{"a": 1}\n```';
    const out = extractJsonObject(text);
    expect(out.complete).toBe(true);
    expect(JSON.parse(out.json)).toEqual({ a: 1 });
  });

  it('extracts a fenced ``` block without the json language tag', () => {
    const text = '```\n{"a": 2}\n```';
    const out = extractJsonObject(text);
    expect(out.complete).toBe(true);
    expect(JSON.parse(out.json)).toEqual({ a: 2 });
  });

  it('extracts bare JSON with leading prose', () => {
    const text = 'Sure! Here is the strategy:\n{"a": 3}';
    const out = extractJsonObject(text);
    expect(out.complete).toBe(true);
    expect(JSON.parse(out.json)).toEqual({ a: 3 });
  });

  it('extracts JSON with trailing prose', () => {
    const text = '{"a": 4}\nLet me know if you need more.';
    const out = extractJsonObject(text);
    expect(out.complete).toBe(true);
    expect(JSON.parse(out.json)).toEqual({ a: 4 });
  });

  it('strips inline <think> blocks before extracting', () => {
    const text = '<think>The user wants JSON. Let me draft.</think>{"a": 5}';
    const out = extractJsonObject(text);
    expect(out.complete).toBe(true);
    expect(JSON.parse(out.json)).toEqual({ a: 5 });
  });

  it('strips <tool_call> XML before extracting', () => {
    const text = '<tool_call>ignore me</tool_call>{"a": 6}';
    const out = extractJsonObject(text);
    expect(out.complete).toBe(true);
    expect(JSON.parse(out.json)).toEqual({ a: 6 });
  });

  it('is string-aware: ignores braces inside JSON strings', () => {
    const text = '{"a": "this { is not nested }", "b": 7}';
    const out = extractJsonObject(text);
    expect(out.complete).toBe(true);
    expect(JSON.parse(out.json)).toEqual({ a: 'this { is not nested }', b: 7 });
  });

  it('handles escaped quotes inside strings', () => {
    const text = '{"a": "he said \\"hi\\"", "b": 8}';
    const out = extractJsonObject(text);
    expect(out.complete).toBe(true);
    expect(JSON.parse(out.json)).toEqual({ a: 'he said "hi"', b: 8 });
  });

  it('returns complete: false for truncated JSON (no closing brace)', () => {
    const text = '{"a": 9';
    const out = extractJsonObject(text);
    expect(out.complete).toBe(false);
    expect(out.json).toBe('{"a": 9');
  });

  it('returns empty for input with no JSON object', () => {
    const text = 'no json here at all';
    const out = extractJsonObject(text);
    expect(out.json).toBe('');
    expect(out.complete).toBe(false);
  });
});

describe('helpers.parseJsonObjectFromLlm', () => {
  it('parses a well-formed fenced block', () => {
    const parsed = parseJsonObjectFromLlm<{ x: number }>(
      '```json\n{"x": 1}\n```'
    );
    expect(parsed).toEqual({ x: 1 });
  });

  it('parses prose-prefixed bare JSON', () => {
    const parsed = parseJsonObjectFromLlm<{ x: number }>(
      'Here you go: {"x": 2}'
    );
    expect(parsed).toEqual({ x: 2 });
  });

  it('returns null for truncated JSON', () => {
    const parsed = parseJsonObjectFromLlm('{"x": 3');
    expect(parsed).toBeNull();
  });

  it('throws with the raw snippet on malformed JSON', () => {
    expect(() => parseJsonObjectFromLlm('{"x": }')).toThrow(
      /JSON parse failed/
    );
  });
});

describe('helpers.withBackoff', () => {
  it('returns the result on the first successful attempt', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const out = await withBackoff(fn, { retries: 2 });
    expect(out).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and returns the eventual success', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom1'))
      .mockRejectedValueOnce(new Error('boom2'))
      .mockResolvedValue('ok');
    const out = await withBackoff(fn, {
      retries: 2,
      baseDelayMs: 1,
      jitterMs: 0,
    });
    expect(out).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws the last error when all attempts fail', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('e1'))
      .mockRejectedValueOnce(new Error('e2'))
      .mockRejectedValueOnce(new Error('e3'));
    await expect(
      withBackoff(fn, { retries: 2, baseDelayMs: 1, jitterMs: 0 })
    ).rejects.toThrow('e3');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe('helpers.streamWithRetry', () => {
  async function* makeStream<T>(
    items: T[]
  ): AsyncGenerator<T, { ret: number }> {
    for (const i of items) yield i;
    return { ret: 42 };
  }

  async function* failingFirst() {
    throw new Error('first call fails');
    yield 'never';
    return { ret: 0 };
  }

  async function* okStream() {
    yield 'a';
    yield 'b';
    return { ret: 1 };
  }

  it('returns the inner generator output when first call succeeds', async () => {
    const out: string[] = [];
    let ret: { ret: number } | undefined;
    const g = streamWithRetry(() => makeStream<string>(['x', 'y']), {
      retries: 0,
    });
    let step = await g.next();
    while (!step.done) {
      out.push(step.value);
      step = await g.next();
    }
    ret = step.value;
    expect(out).toEqual(['x', 'y']);
    expect(ret).toEqual({ ret: 42 });
  });

  it('retries on first-call failure and succeeds with the next factory call', async () => {
    let call = 0;
    const g = streamWithRetry(
      () => {
        call++;
        return call === 1 ? failingFirst() : okStream();
      },
      { retries: 2, baseDelayMs: 1, jitterMs: 0 }
    );
    const out: string[] = [];
    let step = await g.next();
    while (!step.done) {
      out.push(step.value);
      step = await g.next();
    }
    expect(out).toEqual(['a', 'b']);
    expect(step.value).toEqual({ ret: 1 });
    expect(call).toBe(2);
  });

  it('throws when all retries fail', async () => {
    let calls = 0;
    const g = streamWithRetry(
      () => {
        calls++;
        return failingFirst();
      },
      { retries: 1, baseDelayMs: 1, jitterMs: 0 }
    );
    await expect(g.next()).rejects.toThrow('first call fails');
    expect(calls).toBe(2);
  });

  it('invokes onRetry on each failed attempt', async () => {
    let call = 0;
    const onRetry = vi.fn();
    const g = streamWithRetry(
      () => {
        call++;
        return call === 1 ? failingFirst() : okStream();
      },
      { retries: 1, baseDelayMs: 1, jitterMs: 0, onRetry }
    );
    // drain
    for await (const _ of g) {
      void _;
    }
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0]![0]).toBeInstanceOf(Error);
    expect(onRetry.mock.calls[0]![1]).toBe(1);
  });
});
