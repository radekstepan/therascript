import {
  VllmMessage,
  VllmMessageParam,
  sendChatRequest,
} from './vllmClient.js';

// Interface for a single chat conversation
interface ChatConversation {
  id: string;
  model: string;
  createdAt: string;
  messages: VllmMessageParam[];
}

// In-memory store for all active chat conversations
interface ChatHistory {
  [chatId: string]: ChatConversation;
}

let history: ChatHistory = {};

/**
 * Starts a new chat session in memory.
 * @param model The vLLM model to use (must match the one the server is running).
 * @param systemPrompt Optional system prompt to initialize the conversation.
 * @returns The unique ID of the new chat session.
 */
export function startNewChat(model: string, systemPrompt?: string): string {
  const chatId = `chat_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  const messages: VllmMessageParam[] = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }

  history[chatId] = {
    id: chatId,
    model: model,
    createdAt: new Date().toISOString(),
    messages: messages,
  };
  console.log(
    `💬 Started new in-memory chat (ID: ${chatId}) with model: ${model}`
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
      messageCount: chat.messages.length,
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
 * Adds a user message to a chat session and gets the model's response.
 * Updates the in-memory message list for the session.
 * @param chatId The ID of the active chat session.
 * @param userMessage The user's message content.
 * @returns The assistant's response message object, or null if an error occurred.
 */
export async function sendMessage(
  chatId: string,
  userMessage: string
): Promise<VllmMessage | null> {
  const conversation = history[chatId];
  if (!conversation) {
    console.error(`❌ Chat with ID ${chatId} not found.`);
    return null;
  }

  // Add user message to history
  conversation.messages.push({ role: 'user', content: userMessage });

  try {
    // Call the vLLM client to get the model's response
    const response = await sendChatRequest({
      model: conversation.model,
      messages: conversation.messages,
    });

    const assistantMessage = response.choices[0]?.message;

    if (assistantMessage) {
      // Add assistant's response to history
      conversation.messages.push(assistantMessage);
      return assistantMessage;
    } else {
      console.error('❌ vLLM response did not contain a valid message.');
      return null;
    }
  } catch (error) {
    console.error(`❌ Message sending failed for chat ${chatId}.`);
    // Remove the user message we optimistically added
    conversation.messages.pop();
    return null;
  }
}
