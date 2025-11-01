import { describe, it, expect, vi } from 'vitest';
import axios from 'axios';

vi.mock('axios', () => ({
  default: { post: vi.fn(), isAxiosError: (e: any) => !!e || false },
}));

import { sendChatRequest } from './ollamaClient.js';

const payload = {
  model: 'mymodel',
  messages: [{ role: 'user', content: 'hi' }],
} as any;

describe('ollamaClient.sendChatRequest', () => {
  it('returns response data on success', async () => {
    const spyLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      (axios as any).post.mockResolvedValue({
        data: {
          model: 'mymodel',
          done: true,
          message: { role: 'assistant', content: 'ok' },
        },
      });
      await expect(sendChatRequest({ ...payload })).resolves.toMatchObject({
        model: 'mymodel',
        done: true,
      });
    } finally {
      spyLog.mockRestore();
    }
  });

  it('throws helpful error on ECONNREFUSED', async () => {
    const spyLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    const spyErr = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const err = new Error('refused') as any;
      err.code = 'ECONNREFUSED';
      (axios as any).isAxiosError = () => true;
      (axios as any).post.mockRejectedValue(err);
      await expect(sendChatRequest({ ...payload })).rejects.toThrow(
        /Failed to get response from Ollama/
      );
    } finally {
      spyErr.mockRestore();
      spyLog.mockRestore();
    }
  });

  it('throws helpful error on 404 model not found', async () => {
    const spyLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    const spyErr = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const err = {
        response: { status: 404, data: { error: 'model not found' } },
      } as any;
      (axios as any).isAxiosError = () => true;
      (axios as any).post.mockRejectedValue(err);
      await expect(sendChatRequest({ ...payload })).rejects.toThrow(
        /Failed to get response from Ollama/
      );
    } finally {
      spyErr.mockRestore();
      spyLog.mockRestore();
    }
  });
});
