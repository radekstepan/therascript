// packages/api/src/services/vllmService.mock.ts
import { Stream } from 'openai/streaming';
import type { ChatCompletionChunk } from 'openai/resources/chat/completions';
import type { BackendChatMessage, OllamaModelInfo } from '../types/index.js';
import config from '../config/index.js';

const MOCK_DELAY_MS = 800;
const MOCK_MODEL_NAME =
  process.env.MOCK_LLM_MODEL_NAME || 'mock-vllm-model:latest';

console.log('[Mock Service] Using Mock vLLM Service');

export async function listModels(): Promise<OllamaModelInfo[]> {
  return [
    {
      name: MOCK_MODEL_NAME,
      modified_at: new Date(),
      size: 123456789,
      digest: 'mock-digest',
      details: {
        format: 'gguf',
        family: 'mock-family',
        families: ['mock-family'],
        parameter_size: '7B',
        quantization_level: 'Q4_0',
      },
    },
  ];
}

export async function checkModelStatus(
  modelToCheck: string
): Promise<OllamaModelInfo | null | { status: 'unavailable' }> {
  if (modelToCheck === MOCK_MODEL_NAME) {
    return (await listModels())[0];
  }
  return null;
}

export async function streamChatResponse(
  contextTranscript: string | null,
  chatHistory: BackendChatMessage[]
): Promise<Stream<ChatCompletionChunk>> {
  const lastUserMessage =
    chatHistory[chatHistory.length - 1]?.text || 'No message found';
  const mockResponseText = `This is a mocked stream from vLLM in response to: "${lastUserMessage.substring(0, 50)}..."`;
  const words = mockResponseText.split(' ');

  const stream = new ReadableStream<ChatCompletionChunk>({
    async start(controller) {
      await new Promise((resolve) => setTimeout(resolve, MOCK_DELAY_MS / 4));
      for (let i = 0; i < words.length; i++) {
        const chunk: ChatCompletionChunk = {
          id: `chatcmpl-mock-${Date.now()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: MOCK_MODEL_NAME,
          choices: [
            {
              index: 0,
              delta: {
                content: words[i] + (i === words.length - 1 ? '' : ' '),
              },
              finish_reason: null,
            },
          ],
        };
        controller.enqueue(chunk);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      // Send final chunk with finish_reason
      const finalChunk: ChatCompletionChunk = {
        id: `chatcmpl-mock-${Date.now()}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: MOCK_MODEL_NAME,
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'stop',
          },
        ],
      };
      controller.enqueue(finalChunk);
      controller.close();
    },
  });

  return new Stream(async function* () {
    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  }, new AbortController());
}
