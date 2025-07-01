// packages/api/src/services/vllmService.ts
import config from '../config/index.js';
import type { BackendChatMessage } from '../types/index.js';
import type { Stream } from 'openai/streaming';
import type { ChatCompletionChunk } from 'openai/resources/chat/completions';
import type * as RealService from './vllmService.real.js';
import type * as MockService from './vllmService.mock.js';

interface VllmServiceInterface {
  listModels: () => Promise<any[]>;
  checkModelStatus: (
    modelToCheck: string
  ) => Promise<any | null | { status: 'unavailable' }>;
  streamChatResponse: (
    contextTranscript: string | null,
    chatHistory: BackendChatMessage[]
  ) => Promise<Stream<ChatCompletionChunk>>;
}

let service: VllmServiceInterface;

if (config.server.appMode === 'mock') {
  const mockModule = await import('./vllmService.mock.js');
  service = mockModule;
} else {
  const realModule = await import('./vllmService.real.js');
  service = realModule;
}

export const listModels = service.listModels;
export const checkModelStatus = service.checkModelStatus;
export const streamChatResponse = service.streamChatResponse;
