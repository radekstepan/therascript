import * as readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import * as chatManager from './chatManager';
import { listLocalModels } from './ollamaClient';

const rl = readline.createInterface({ input, output });

const DEFAULT_MODEL = 'llama3.2:1b';     // Set the new default model
const DEFAULT_CONTEXT_SIZE = 2048; // Keep or adjust as needed

async function selectModel(): Promise<string> {
    console.log("\n🔍 Fetching available local models...");
    const models = await listLocalModels();
    if (!models || models.length === 0) {
        console.warn(`⚠️ No local models found. Using default: ${DEFAULT_MODEL}`);
        console.warn(`   You need to pull models first. Try:`);
        console.warn(`   docker-compose exec ollama ollama pull ${DEFAULT_MODEL}`);
        // We'll proceed with the default, Ollama might download it on first use if configured,
        // but explicitly pulling is better.
        return DEFAULT_MODEL;
    }

    console.log("Available models:");
    models.forEach((model, index) => {
        console.log(`${index + 1}. ${model}`);
    });
    console.log(`${models.length + 1}. Use default: ${DEFAULT_MODEL}`);
    console.log(`${models.length + 2}. Enter custom model name`);

    while (true) {
        const choice = await rl.question(`Select a model (1-${models.length + 2}): `);
        const choiceNum = parseInt(choice, 10);

        if (choiceNum >= 1 && choiceNum <= models.length) {
            return models[choiceNum - 1];
        } else if (choiceNum === models.length + 1) {
            return DEFAULT_MODEL;
        } else if (choiceNum === models.length + 2) {
             const customModel = await rl.question("Enter custom model name (e.g., llama3:8b-instruct): ");
             if (customModel.trim()) {
                 return customModel.trim();
             } else {
                console.log("Invalid name, please try again.");
             }
        }
        else {
            console.log("Invalid choice, please try again.");
        }
    }
}

async function startNewChatSession() {
    console.log("\n--- Starting New Chat ---");
    const model = await selectModel();
    const systemPrompt = await rl.question("Enter a system prompt (optional, press Enter to skip): ");
    const contextSizeStr = await rl.question(`Enter context size (optional, default: ${DEFAULT_CONTEXT_SIZE}): `);
    const contextSize = parseInt(contextSizeStr, 10) || DEFAULT_CONTEXT_SIZE;

    const chatId = chatManager.startNewChat(model, systemPrompt || undefined, contextSize);
    console.log(`\nChat started with ID: ${chatId}`);
    await chatLoop(chatId);
}

async function resumeChatSession() {
    console.log("\n--- Resuming Chat ---");
    const chats = chatManager.listChats();

    if (chats.length === 0) {
        console.log("No previous chats found.");
        return;
    }

    console.log("Available chats:");
    chats.forEach((chat, index) => {
        console.log(`${index + 1}. ID: ${chat.id} (Model: ${chat.model}, Started: ${new Date(chat.createdAt).toLocaleString()}, Messages: ${chat.messageCount})`);
    });

    while (true) {
        const choice = await rl.question(`Select a chat to resume (1-${chats.length}) or 'q' to cancel: `);
        if (choice.toLowerCase() === 'q') return;

        const choiceNum = parseInt(choice, 10);
        if (choiceNum >= 1 && choiceNum <= chats.length) {
            const selectedChat = chats[choiceNum - 1];
            console.log(`\nResuming chat ${selectedChat.id} with model ${selectedChat.model}`);
            // Print last few messages for context?
            const conversation = chatManager.getChat(selectedChat.id);
            if (conversation?.messages) {
                console.log("--- Previous Messages ---");
                conversation.messages.slice(-4).forEach(msg => { // Show last 4 messages
                     console.log(`${msg.role === 'user' ? 'You' : 'Assistant'}: ${msg.content.substring(0,100)}${msg.content.length > 100 ? '...' : ''}`);
                });
                 console.log("-----------------------");
            }
            await chatLoop(selectedChat.id);
            return; // Exit resume selection once chat loop finishes
        } else {
            console.log("Invalid choice.");
        }
    }
}

async function chatLoop(chatId: string) {
    console.log("\nEnter your message. Type '/exit' to return to the main menu.");
    const conversation = chatManager.getChat(chatId);
    if (!conversation) {
         console.error("Chat session not found internally. Returning to menu.");
         return;
    }
    console.log(`Chatting with: ${conversation.model} (Context Size: ${conversation.contextSize || 'Default'})`)
    if(conversation.systemPrompt) {
        console.log(`System Prompt: ${conversation.systemPrompt}`);
    }


    while (true) {
        const userInput = await rl.question("You: ");
        if (userInput.toLowerCase() === '/exit') {
            break;
        }
         if (!userInput.trim()) {
            continue; // Ignore empty input
        }

        const assistantMessage = await chatManager.sendMessage(chatId, userInput);

        if (assistantMessage) {
            console.log(`Assistant: ${assistantMessage.content}`);
        } else {
            console.log("Assistant: (No response received or error occurred)");
            // Optional: Offer to retry or exit?
        }
    }
    console.log(`\nExiting chat ${chatId}. Returning to main menu.`);
}

async function mainMenu() {
    await chatManager.loadHistory(); // Load history at the start

    while (true) {
        console.log("\n--- Main Menu ---");
        console.log("1. Start New Chat");
        console.log("2. Resume Existing Chat");
        console.log("3. List Local Models");
        console.log("4. Exit");

        const choice = await rl.question("Choose an option: ");

        switch (choice) {
            case '1':
                await startNewChatSession();
                break;
            case '2':
                await resumeChatSession();
                break;
            case '3':
                 console.log("\n🔍 Fetching available local models...");
                 const models = await listLocalModels();
                 if (models && models.length > 0) {
                     console.log("Available models:", models.join(', '));
                 } else {
                     console.log("No local models found or Ollama not reachable.");
                     console.log("   Try: docker-compose exec ollama ollama list");
                     console.log("   And: docker-compose exec ollama ollama pull <model_name>");
                 }
                break;
            case '4':
                console.log("Goodbye!");
                rl.close();
                return; // Exit the loop and the program
            default:
                console.log("Invalid choice, please try again.");
                break;
        }
    }
}

// Start the application
mainMenu().catch(err => {
    console.error("An unexpected error occurred:", err);
    rl.close();
});
