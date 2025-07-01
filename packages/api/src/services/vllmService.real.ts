// packages/api/src/services/vllmService.real.ts
import OpenAI from 'openai';
import type {
  ChatCompletionChunk,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';
import { Stream } from 'openai/streaming';
import config from '../config/index.js';
import { InternalServerError, BadRequestError, ApiError } from '../errors.js';
import type { BackendChatMessage, OllamaModelInfo } from '../types/index.js';

const SYSTEM_PROMPT = `You are an AI assistant analyzing a therapy session transcript. You will be provided with the transcript context and chat history. Answer user questions based *only* on the provided information. Be concise. If the answer isn't present, state that clearly. Do not invent information. Refer to participants as "Therapist" and "Patient" unless names are explicitly clear in the transcript.`;
const STANDALONE_SYSTEM_PROMPT = `You are a helpful AI assistant. Answer the user's questions directly and concisely.`;

let vllmClient: OpenAI;

function getVllmClient(): OpenAI {
  if (!vllmClient) {
    vllmClient = new OpenAI({
      baseURL: config.vllm.baseURL,
      apiKey: config.vllm.apiKey,
    });
    console.log(
      `[vLLM Service] OpenAI client initialized for vLLM at ${config.vllm.baseURL}`
    );
  }
  return vllmClient;
}

export async function listModels(): Promise<OllamaModelInfo[]> {
  const client = getVllmClient();
  try {
    const response = await client.models.list();
    // Map vLLM's response to our internal OllamaModelInfo type for compatibility
    return response.data.map(
      (model) =>
        ({
          name: model.id,
          modified_at: new Date(model.created * 1000), // vLLM uses 'created' unix timestamp
          size: 0, // vLLM API doesn't provide size
          digest: '', // Not provided
          details: {
            // Mock details as they are not available via standard OpenAI API
            format: 'unknown',
            family: 'unknown',
            families: null,
            parameter_size: 'unknown',
            quantization_level: 'unknown',
          },
        }) as OllamaModelInfo
    );
  } catch (error) {
    console.error('[vLLM Service] Error fetching models:', error);
    throw new InternalServerError('Failed to list models from vLLM service.');
  }
}

export async function checkModelStatus(
  modelToCheck: string
): Promise<OllamaModelInfo | null | { status: 'unavailable' }> {
  try {
    const models = await listModels();
    const foundModel = models.find((m) => m.name === modelToCheck);
    return foundModel || null;
  } catch (error) {
    if (error instanceof OpenAI.APIConnectionError) {
      return { status: 'unavailable' };
    }
    console.error(
      `[vLLM Service] Error checking status for model ${modelToCheck}:`,
      error
    );
    return null;
  }
}

export async function streamChatResponse(
  contextTranscript: string | null,
  chatHistory: BackendChatMessage[]
): Promise<Stream<ChatCompletionChunk>> {
  const client = getVllmClient();
  const isStandalone = contextTranscript === null;
  const messages: ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: isStandalone ? STANDALONE_SYSTEM_PROMPT : SYSTEM_PROMPT,
    },
    ...chatHistory.map(
      (msg): ChatCompletionMessageParam => ({
        role: msg.sender === 'ai' ? 'assistant' : 'user',
        content: msg.text,
      })
    ),
  ];
  if (!isStandalone) {
    messages.splice(1, 0, {
      role: 'user',
      content: `CONTEXT TRANSCRIPT:\n"""\n${contextTranscript}\n"""\n\nBased on the transcript above and the following chat history, answer the user's question.`,
    });
  }

  try {
    const stream = await client.chat.completions.create({
      model: config.vllm.model,
      messages: messages,
      stream: true,
    });
    return stream;
  } catch (error: any) {
    console.error('[vLLM Service] Error initiating chat stream:', error);
    if (error instanceof OpenAI.APIError) {
      if (error.status === 404) {
        throw new BadRequestError(
          `Model '${config.vllm.model}' not found on the vLLM server.`
        );
      }
    }
    throw new InternalServerError(
      'Failed to initiate stream from AI service.',
      error
    );
  }
}
