// src/services/ollamaService.ts
import ollama, { ChatResponse, Message } from 'ollama';
import config from '../config/index.js'; // ADDED .js
import { BackendChatMessage } from '../types/index.js'; // ADDED .js

console.log(`[OllamaService] Using Ollama host: ${config.ollama.baseURL} (or OLLAMA_HOST env var)`);

const SYSTEM_PROMPT = `You are an AI assistant analyzing a therapy session transcript. Context transcript and chat history will follow. Answer user questions based *only* on this provided information. Be concise. If the answer isn't present, state that clearly. Do not invent information. Refer to participants as "Therapist" and "Patient" unless names are explicitly clear in the transcript.`;

export const generateChatResponse = async (
  contextTranscript: string,
  chatHistory: BackendChatMessage[]
): Promise<string> => {
  if (!contextTranscript && chatHistory.length <= 1) {
      console.warn("[OllamaService] Called with empty transcript and minimal history.");
      return "I need more context or a transcript to analyze.";
  }
   if (!chatHistory || chatHistory.length === 0) {
      console.error("[OllamaService] generateChatResponse called with empty chat history.");
      throw new Error("Internal Error: Cannot generate response without chat history.");
  }

  console.log(`[OllamaService] Generating response (model: ${config.ollama.model})...`);

  const messages: Message[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `CONTEXT TRANSCRIPT:\n"""\n${contextTranscript || 'No transcript.'}\n"""\n\nCHAT HISTORY:` },
    ...chatHistory.map((msg): Message => ({ role: msg.sender === 'ai' ? 'assistant' : 'user', content: msg.text })),
  ];

  console.log(`[OllamaService] Sending ${messages.length} messages to Ollama.`);

  try {
    const response: ChatResponse = await ollama.chat({
      model: config.ollama.model,
      messages: messages,
      stream: false,
      keep_alive: config.ollama.keepAlive,
      // host: config.ollama.baseURL, // Explicit host if needed
    });

     if (!response?.message?.content) throw new Error('Invalid response structure from AI.');

    const durationInfo = response.total_duration ? `(${(response.total_duration / 1e9).toFixed(2)}s)` : '';
    console.log(`[OllamaService] Response received ${durationInfo}.`);
    return response.message.content.trim();

  } catch (error) {
    console.error('[OllamaService] Error:', error);
    if (error instanceof Error) {
        const isBrowser = typeof window !== 'undefined'; // Basic check
        const connectionError = isBrowser ? error.message.includes('Failed to fetch') : (error as NodeJS.ErrnoException).code === 'ECONNREFUSED';
        if (connectionError) throw new Error(`Connection refused: Could not connect to Ollama at ${config.ollama.baseURL}.`);
        if (error.message.includes('model') && (error.message.includes('not found') || error.message.includes('missing'))) throw new Error(`Ollama model '${config.ollama.model}' not found.`);
        if (error.name === 'TimeoutError' || error.message.includes('timeout')) throw new Error('AI service request timed out.');
    }
    throw new Error('Failed to get response from AI service.');
  }
};
