# Ollama Dockerized Chat Client (Node.js/TypeScript)

This project provides a Dockerized environment for running an Ollama LLM server and a simple Node.js/TypeScript command-line interface (CLI) client to interact with it.

It allows you to:
- Easily set up Ollama in a container.
- Chat with various Ollama models via a terminal interface.
- Select models, define system prompts, and set context sizes for new chats.
- Persist chat conversations and resume them later.
- Manage Ollama models (download, list, remove) via Docker commands.
- Persist downloaded Ollama models using a Docker volume.

## Features

-   **Dockerized Ollama:** Runs the official `ollama/ollama` image.
-   **TypeScript Node.js Client:** A CLI application (`app` service) to interact with the Ollama API.
-   **Chat Management:** Start new chats, specify parameters (model, system prompt, context size).
-   **Chat Persistence:** Saves conversations to a JSON file (`chat_data/chat_history.json`) using a Docker volume.
-   **Resume Chat:** Load and continue previous conversations.
-   **Model Persistence:** Downloaded Ollama models are stored in a Docker volume (`ollama_data`).
-   **Model Listing:** CLI option to list locally available Ollama models.
-   **Demo Model:** Includes configuration pointing to a small default model (`orca-mini:3b-q4_1`) for quick testing.
-   **GPU Support (Optional):** Configuration included (commented out) for using NVIDIA GPUs via `docker-compose.yml`.

## Prerequisites

-   [Docker](https://docs.docker.com/get-docker/) installed.
-   [Docker Compose](https://docs.docker.com/compose/install/) installed (usually included with Docker Desktop).
-   **(Optional for GPU)** NVIDIA GPU, compatible drivers, and the [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html) installed.


## Setup and Running

1.  **Clone or Download:** Get the project files onto your local machine.
2.  **Create Data Directory:** In the project root, create the directory for chat history persistence:
    ```bash
    mkdir chat_data
    ```
3.  **Build and Start Services:** Open a terminal in the project root directory (where `docker-compose.yml` is located) and run:
    ```bash
    docker compose up --build -d
    ```
    *   `--build` ensures the Node.js app image is built.
    *   `-d` runs the containers in detached mode (in the background).
    *   **(GPU Users):** Uncomment the `deploy` section in `docker-compose.yml` before running `up`.

4.  **Download Initial Model:** Ollama needs models! Pull the small demo model (or any other model you prefer) *inside* the Ollama container:
    ```bash
    # Pull the default demo model (orca-mini, ~1.7GB)
    docker compose exec ollama ollama pull orca-mini:3b-q4_1

    # Or pull another model, e.g., llama3 (~4.7GB)
    # docker compose exec ollama ollama pull llama3:8b
    ```
    Wait for the download to complete.

5.  **Interact with the Chat Client:** Attach to the running `app` container's interactive terminal:
    ```bash
    docker compose attach app
    ```
    You should see the main menu of the chat application. Follow the prompts to start or resume chats.

6.  **Detaching/Stopping:**
    *   To detach from the interactive session without stopping the container: Press `Ctrl+P` then `Ctrl+Q`.
    *   To stop and remove the containers: `docker compose down`

## How it Works: API Interaction

The `app` service (Node.js client) communicates with the `ollama` service using Ollama's REST API over the internal Docker network (`http://ollama:11434`).

The primary interactions are:

1.  **Listing Models (`GET /api/tags`)**
    *   **Request:** The client sends a simple GET request to `http://ollama:11434/api/tags`.
    *   **Response:** Ollama returns a JSON object containing a list of locally available models.
        ```json
        {
          "models": [
            {
              "name": "orca-mini:3b-q4_1",
              "modified_at": "...",
              "size": 1743165070,
              "digest": "..."
            },
            {
              "name": "llama3:8b",
              // ... other model details
            }
          ]
        }
        ```
    *   **Usage:** Used by the client's "List Local Models" option and when selecting a model for a new chat.

2.  **Generating Chat Completions (`POST /api/chat`)**
    *   **Request:** When the user sends a message in the chat interface, the `app` sends a POST request to `http://ollama:11434/api/chat` with a JSON payload like this:
        ```json
        {
          "model": "orca-mini:3b-q4_1", // The model selected for this chat
          "messages": [
            // The *entire* conversation history up to this point
            // Including the optional system prompt first
            {
              "role": "system", // Optional: Only if a system prompt was set
              "content": "You are a helpful assistant."
            },
            {
              "role": "user",
              "content": "Hello there!"
            },
            {
              "role": "assistant",
              "content": "Hi! How can I help you today?"
            },
            {
              "role": "user",
              "content": "Tell me a joke." // The latest user message
            }
            // ... potentially more messages
          ],
          "stream": false, // This client waits for the full response
          "options": {
            // Optional parameters set for the chat session
            "num_ctx": 2048 // Example: context window size
            // Other options like temperature, top_k, etc., could be added here
          }
        }
        ```
        *Key Point:* The `messages` array contains the full chat history for context. The roles (`system`, `user`, `assistant`) tell the model the flow of the conversation.

    *   **Response:** Ollama processes the request and sends back a JSON response containing the assistant's reply:
        ```json
        {
          "model": "orca-mini:3b-q4_1",
          "created_at": "...",
          "message": {
            "role": "assistant",
            "content": "Why don't scientists trust atoms? Because they make up everything!" // The generated response
          },
          "done": true, // Indicates the response is complete (since stream=false)
          "total_duration": 5111288833, // Optional performance metrics
          "load_duration": 2296041,
          "prompt_eval_count": 26,
          "prompt_eval_duration": 165101000,
          "eval_count": 19,
          "eval_duration": 4941233000
        }
        ```
    *   **Usage:** The client extracts the `content` from the `message` object in the response and displays it to the user as the "Assistant" reply. Both the user's message and the assistant's response are then saved to the `chat_history.json` file for that chat session.

## Model Management

You manage Ollama models using `docker compose exec`:

-   **List downloaded models:**
    ```bash
    docker compose exec ollama ollama list
    ```
-   **Pull (download) a new model:** Find models on the [Ollama Library](https://ollama.com/library).
    ```bash
    docker compose exec ollama ollama pull <model_name>:<tag>
    # Example: docker compose exec ollama ollama pull phi3:mini
    ```
-   **Remove a downloaded model:**
    ```bash
    docker compose exec ollama ollama rm <model_name>:<tag>
    # Example: docker compose exec ollama ollama rm orca-mini:3b-q4_1
    ```

## Upgrading

-   **Upgrading Ollama:**
    1.  Pull the latest official image: `docker pull ollama/ollama:latest`
    2.  Stop the current services: `docker compose down`
    3.  Restart using the new image: `docker compose up -d` (Your models in the `ollama_data` volume will be preserved).

-   **Upgrading Node.js Client Libraries:**
    1.  Update the desired versions in `app/package.json`.
    2.  Rebuild the `app` image and restart: `docker compose up --build -d`

## Usage (CLI)

After running `docker compose attach app`:

1.  **Main Menu:** You'll see options:
    *   `1. Start New Chat`
    *   `2. Resume Existing Chat`
    *   `3. List Local Models`
    *   `4. Exit`
2.  **Starting a New Chat:**
    *   Select option `1`.
    *   You'll be prompted to select an available model or enter a custom one.
    *   Optionally enter a system prompt (e.g., "You are a pirate assistant").
    *   Optionally enter a context size (default is 2048).
    *   The chat session begins.
3.  **Resuming a Chat:**
    *   Select option `2`.
    *   A list of previous chats (ID, Model, Date, Message Count) will be shown.
    *   Enter the number corresponding to the chat you want to resume.
    *   The chat session resumes, showing the last few messages for context.
4.  **Chatting:**
    *   Type your message after the `You:` prompt and press Enter.
    *   Wait for the `Assistant:` response.
    *   Type `/exit` to end the current chat session and return to the main menu.
5.  **Listing Models:**
    *   Select option `3` to see the models currently downloaded within the Ollama container.
6.  **Exiting:**
    *   Select option `4` from the main menu to close the client connection and stop the script (the containers will keep running if started with `-d`).
