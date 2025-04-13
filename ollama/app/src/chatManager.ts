import * as fs from 'fs/promises';
import * as path from 'path';
import { OllamaMessage, OllamaChatOptions, sendChatRequest, OllamaChatRequest } from './ollamaClient';

const HISTORY_DIR = path.join(__dirname, '..', 'data'); // Point to the mounted volume dir
const HISTORY_FILE = path.join(HISTORY_DIR, 'chat_history.json');

// Interface for a single chat conversation
interface ChatConversation {
    id: string;
    model: string;
    systemPrompt?: string; // Optional system prompt
    contextSize?: number; // Optional context size override
    createdAt: string;
    messages: OllamaMessage[];
}

// Interface for the structure of the history file
interface ChatHistory {
    [chatId: string]: ChatConversation;
}

let history: ChatHistory = {};

// Ensure the history directory exists
async function ensureHistoryDir() {
    try {
        await fs.access(HISTORY_DIR);
    } catch (error) {
         console.log(`Data directory (${HISTORY_DIR}) not found, creating...`);
        await fs.mkdir(HISTORY_DIR, { recursive: true });
    }
}

// Load chat history from the JSON file
export async function loadHistory(): Promise<void> {
    await ensureHistoryDir();
    try {
        const data = await fs.readFile(HISTORY_FILE, 'utf-8');
        history = JSON.parse(data) as ChatHistory;
        console.log(`📚 Loaded ${Object.keys(history).length} conversations from ${HISTORY_FILE}`);
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            console.log(`No chat history file found at ${HISTORY_FILE}. Starting fresh.`);
            history = {};
        } else {
            console.error("❌ Error loading chat history:", error);
            history = {}; // Start with empty history on error
        }
    }
}

// Save chat history to the JSON file
async function saveHistory(): Promise<void> {
     await ensureHistoryDir();
    try {
        const data = JSON.stringify(history, null, 2); // Pretty print JSON
        await fs.writeFile(HISTORY_FILE, data, 'utf-8');
        // console.log(`💾 Chat history saved to ${HISTORY_FILE}`);
    } catch (error) {
        console.error("❌ Error saving chat history:", error);
    }
}

// Start a new chat session
export function startNewChat(model: string, systemPrompt?: string, contextSize?: number): string {
    const chatId = `chat_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const initialMessages: OllamaMessage[] = [];
    if (systemPrompt) {
        initialMessages.push({ role: 'system', content: systemPrompt });
    }

    history[chatId] = {
        id: chatId,
        model: model,
        systemPrompt: systemPrompt,
        contextSize: contextSize,
        createdAt: new Date().toISOString(),
        messages: initialMessages,
    };
    console.log(`✨ Started new chat (ID: ${chatId}) with model: ${model}`);
    saveHistory(); // Save immediately after creating
    return chatId;
}

// Get a list of existing chat IDs and their models/start dates
export function listChats(): { id: string; model: string; createdAt: string; messageCount: number }[] {
    return Object.values(history)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) // Sort newest first
        .map(chat => ({
            id: chat.id,
            model: chat.model,
            createdAt: chat.createdAt,
            messageCount: chat.messages.filter(m => m.role === 'user' || m.role === 'assistant').length // Count user/assistant messages
        }));
}


// Get a specific chat conversation
export function getChat(chatId: string): ChatConversation | undefined {
    return history[chatId];
}

// Add a message to a chat and get the model's response
export async function sendMessage(chatId: string, userMessage: string): Promise<OllamaMessage | null> {
    const conversation = history[chatId];
    if (!conversation) {
        console.error(`❌ Chat with ID ${chatId} not found.`);
        return null;
    }

    // Add user message to history
    conversation.messages.push({ role: 'user', content: userMessage });

    // Prepare the request payload
    const options: OllamaChatOptions = {};
    if (conversation.contextSize) {
        options.num_ctx = conversation.contextSize;
    }

    const requestPayload: OllamaChatRequest = {
        model: conversation.model,
        messages: conversation.messages, // Send the *entire* history
        options: Object.keys(options).length > 0 ? options : undefined,
    };

    try {
        const response = await sendChatRequest(requestPayload);

        // Add assistant's response to history
        if (response.message) {
            conversation.messages.push(response.message);
            saveHistory(); // Save after successful interaction
            return response.message;
        } else {
             console.error("❌ Ollama response did not contain a message.");
             // Rollback user message? Or keep it? Let's keep it for now.
             saveHistory(); // Save anyway to record the attempt
             return null;
        }
    } catch (error) {
        console.error(`❌ Failed to get response for chat ${chatId}:`, error);
         // Remove the user message we optimistically added if the request failed
         conversation.messages.pop();
        // Don't save history here as the interaction failed
        return null;
    }
}
