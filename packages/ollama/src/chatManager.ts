import {
  OllamaMessage,
  OllamaChatOptions,
  sendChatRequest,
  OllamaChatRequest,
} from './ollamaClient.js';

// Interface for a single chat conversation (remains the same)
interface ChatConversation {
  id: string;
  model: string;
  systemPrompt?: string;
  contextSize?: number;
  createdAt: string;
  messages: OllamaMessage[];
}

// Interface for the structure of the history store (in-memory)
interface ChatHistory {
  [chatId: string]: ChatConversation;
}

// History is now just an in-memory object
// TODO store in the DB instead
let history: ChatHistory = {};

/**
 * Starts a new chat session in memory.
 * @param model The Ollama model to use.
 * @param systemPrompt Optional system prompt.
 * @param contextSize Optional context window size.
 * @param initialMessages Optional array of messages to start the conversation with (for simulating resuming).
 * @returns The unique ID of the new chat session.
 */
export function startNewChat(
  model: string,
  systemPrompt?: string,
  contextSize?: number,
  initialMessages?: OllamaMessage[]
): string {
  const chatId = `chat_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  // Use provided initial messages or start with system prompt if given
  const messages: OllamaMessage[] = initialMessages ? [...initialMessages] : [];
  if (!initialMessages && systemPrompt) {
    // Add system prompt only if no initial messages were provided and a prompt exists
    messages.push({ role: 'system', content: systemPrompt });
  } else if (
    initialMessages &&
    systemPrompt &&
    !initialMessages.some((m) => m.role === 'system')
  ) {
    // If initial messages are provided but lack a system prompt, prepend it
    messages.unshift({ role: 'system', content: systemPrompt });
  }

  history[chatId] = {
    id: chatId,
    model: model,
    systemPrompt: systemPrompt, // Store for reference, even if added to messages
    contextSize: contextSize,
    createdAt: new Date().toISOString(),
    messages: messages,
  };
  console.log(
    `✨ Started/Initialized in-memory chat (ID: ${chatId}) with model: ${model}`
  );
  return chatId;
}

/**
 * Gets a list of active in-memory chat IDs and basic info.
 * @returns Array of chat session summaries.
 */
export function listActiveChats(): {
  id: string;
  model: string;
  createdAt: string;
  messageCount: number;
}[] {
  return Object.values(history)
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
    .map((chat) => ({
      id: chat.id,
      model: chat.model,
      createdAt: chat.createdAt,
      messageCount: chat.messages.length, // Count all messages in memory
    }));
}

/**
 * Retrieves a specific chat conversation from memory.
 * @param chatId The ID of the chat to retrieve.
 * @returns The chat conversation object or undefined if not found.
 */
export function getChat(chatId: string): ChatConversation | undefined {
  return history[chatId];
}

/**
 * Removes a chat session from memory.
 * @param chatId The ID of the chat to remove.
 */
export function endChat(chatId: string): void {
  if (history[chatId]) {
    delete history[chatId];
    console.log(`🗑️ Ended in-memory chat session (ID: ${chatId}).`);
  }
}

/**
 * Adds a user message to an in-memory chat session and gets the model's response.
 * Updates the in-memory message list for the session.
 * @param chatId The ID of the active chat session.
 * @param userMessage The user's message content.
 * @returns The assistant's response message object, or null if an error occurred.
 */
export async function sendMessage(
  chatId: string,
  userMessage: string
): Promise<OllamaMessage | null> {
  const conversation = history[chatId];
  if (!conversation) {
    console.error(`❌ In-memory chat with ID ${chatId} not found.`);
    return null;
  }

  // Add user message to in-memory history
  conversation.messages.push({ role: 'user', content: userMessage });

  // Prepare the request payload
  const options: OllamaChatOptions = {};
  if (conversation.contextSize) {
    options.num_ctx = conversation.contextSize;
  }

  const requestPayload: OllamaChatRequest = {
    model: conversation.model,
    messages: conversation.messages, // Send the current in-memory history
    options: Object.keys(options).length > 0 ? options : undefined,
  };

  try {
    const response = await sendChatRequest(requestPayload); // Call the API client

    // Add assistant's response to in-memory history
    if (response.message) {
      conversation.messages.push(response.message);
      // No saving needed
      return response.message;
    } else {
      console.error('❌ Ollama response did not contain a message.');
      return null;
    }
  } catch (error) {
    // Error is logged in sendChatRequest
    console.error(`❌ Message sending failed for chat ${chatId}.`);
    // Remove the user message we optimistically added from in-memory list
    conversation.messages.pop();
    return null;
  }
}
