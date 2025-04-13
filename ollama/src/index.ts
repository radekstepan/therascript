import * as chatManager from './chatManager';
import * as dockerManager from './dockerManager';
import { OllamaMessage } from './ollamaClient'; // Import the interface

// Configuration
const TARGET_MODEL = 'llama3.2:1b'; // The model we want to ensure is available
const DEFAULT_SYSTEM_PROMPT = "You are a helpful assistant.";
const CONTEXT_SIZE = 2048;

async function runExample() {
    console.log("--- Starting Programmatic Ollama Example ---");

    // 1. Ensure Ollama Docker Container is Running
    try {
        await dockerManager.ensureOllamaRunning();
    } catch (error) {
        console.error("❌ Failed to start or verify Ollama Docker container. Aborting example.");
        console.error("   Please ensure Docker is running and correctly configured.");
        return; // Stop execution if Docker isn't ready
    }

    // 2. Ensure Target Model is Pulled
    try {
        const modelPulled = await dockerManager.isModelPulled(TARGET_MODEL);
        if (!modelPulled) {
            console.warn(`⚠️ Target model "${TARGET_MODEL}" not found. Attempting to pull...`);
            await dockerManager.pullModel(TARGET_MODEL);
        } else {
            console.log(`✅ Target model "${TARGET_MODEL}" is available.`);
        }
    } catch (error) {
        console.error(`❌ Failed to ensure model "${TARGET_MODEL}" is available. Aborting example.`);
        return;
    }

    // --- Scenario 1: Start and Interact with a New Chat ---
    console.log("\n--- SCENARIO 1: New Chat ---");
    const newChatId = chatManager.startNewChat(
        TARGET_MODEL,
        DEFAULT_SYSTEM_PROMPT,
        CONTEXT_SIZE
    );
    console.log(`Started new chat with ID: ${newChatId}`);

    // Send first message
    let userMessage1 = "Hello! Can you tell me the capital of France?";
    console.log(`\nSending message 1: "${userMessage1}"`);
    let response1 = await chatManager.sendMessage(newChatId, userMessage1);

    if (response1) {
        console.log(`Assistant Response 1: "${response1.content}"`);
    } else {
        console.log("Assistant Response 1: Failed to get response.");
    }

    // Send second message (demonstrates context)
    if (response1) { // Only proceed if first exchange was successful
        let userMessage2 = "Thanks! What about the capital of Spain?";
        console.log(`\nSending message 2: "${userMessage2}"`);
        let response2 = await chatManager.sendMessage(newChatId, userMessage2);

        if (response2) {
            console.log(`Assistant Response 2: "${response2.content}"`);
        } else {
            console.log("Assistant Response 2: Failed to get response.");
        }
    }

    // Clean up the in-memory chat session (optional)
    // chatManager.endChat(newChatId);

    // --- Scenario 2: Simulate Resuming a Chat ---
    console.log("\n--- SCENARIO 2: Simulate Resumed Chat ---");

    // Define the 'history' you would have loaded from your storage
    const fakePreviousMessages: OllamaMessage[] = [
        // Note: System prompt can be omitted here if provided to startNewChat
        { role: "user", content: "What is the chemical symbol for water?" },
        { role: "assistant", content: "The chemical symbol for water is H₂O." },
        { role: "user", content: "And for table salt?"},
        { role: "assistant", content: "The chemical symbol for table salt (sodium chloride) is NaCl."}
    ];

    const resumedChatId = chatManager.startNewChat(
        TARGET_MODEL,
        "You are a chemistry tutor.", // Different system prompt for this 'resumed' chat
        CONTEXT_SIZE,
        fakePreviousMessages // Pass the previous messages
    );
    console.log(`Initialized 'resumed' chat with ID: ${resumedChatId}`);
    console.log("Initial 'resumed' messages provided:", fakePreviousMessages);


    // Send a new message to the 'resumed' chat
    let userMessage3 = "What elements make up H₂O?";
    console.log(`\nSending message 3 (to resumed chat): "${userMessage3}"`);
    let response3 = await chatManager.sendMessage(resumedChatId, userMessage3);

    if (response3) {
        console.log(`Assistant Response 3: "${response3.content}"`);
    } else {
        console.log("Assistant Response 3: Failed to get response.");
    }

    // You can retrieve the full conversation history from memory if needed
    const finalConversation = chatManager.getChat(resumedChatId);
    if (finalConversation) {
        console.log("\nFull 'resumed' conversation history (in-memory):");
        console.log(JSON.stringify(finalConversation.messages, null, 2));
    }

    // Clean up the in-memory chat session (optional)
    // chatManager.endChat(resumedChatId);

    console.log("\n--- Example Finished ---");

    // Optional: Stop the Docker container when the script finishes
    // console.log("Stopping Ollama container...");
    // await dockerManager.stopOllamaService();
}

// --- Main Execution ---
runExample()
    .then(() => {
        console.log("\nScript completed successfully.");
        // process.exit(0); // Exit cleanly if needed, or let it fall through
    })
    .catch(err => {
        console.error("\n--- An error occurred during the example execution ---");
        console.error(err);
        process.exit(1); // Exit with error code
    });
    