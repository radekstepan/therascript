# Therascript ✨

Therascript is a self-hosted application designed to help therapists analyze recorded therapy sessions using AI. It leverages local transcription (Whisper) and large language models (Ollama) to provide insights, summaries, and answers to questions about session content.

**Core Idea:** Upload session audio, get a transcript, chat with an AI about the transcript, and manage sessions/chats efficiently – all within your own environment.

## Key Features 🚀

*   **Audio Upload:** Upload session audio files (e.g., MP3) with associated metadata (client name, session type, date, etc.).
*   **AI Transcription:** Utilizes a local [Whisper](https://github.com/openai/whisper) service (via Docker) for audio-to-text transcription.
*   **Transcript Viewing & Editing:** Displays the generated transcript, broken into paragraphs with timestamps. Allows editing individual paragraphs.
*   **Session-Based AI Chat:** Interact with a local LLM (via [Ollama](https://ollama.com/)) to ask questions specifically about the content of a transcribed session.
*   **Standalone AI Chat:** Engage in general chat conversations with the configured LLM, independent of any specific session.
*   **Full-Text Search:** Search across all chat messages and transcript paragraphs using SQLite FTS5.
*   **Local LLM Management:** View, pull, delete, and set the active Ollama model directly through the UI.
*   **Docker Container Management:** View the status of dependent Docker services (Ollama, Whisper) via the UI.
*   **System Controls (Optional):** Initiate a system shutdown (requires specific server-side configuration).
*   **Data Persistence:** Session metadata, chat history, and transcripts are stored locally in an SQLite database. Audio files are stored on the local filesystem.
*   **Self-Hosted & Local:** Designed to run entirely on your own hardware, keeping sensitive session data private.

## Architecture Overview 🏗️

Therascript is structured as a monorepo managed by Lerna/Yarn Workspaces. Key packages include:

*   **`packages/api`**: (Backend - ElysiaJS/Node.js/TypeScript)
    *   Handles all core logic: database operations (SQLite via `better-sqlite3`), session/chat/message/transcript management, file uploads.
    *   Interacts with Ollama and Whisper services via their respective APIs.
    *   Provides the REST API consumed by the frontend.
    *   Manages FTS indexing and search queries.
    *   Includes Swagger UI for API documentation.
*   **`packages/ui`**: (Frontend - React/TypeScript/Webpack)
    *   Provides the user interface using Radix UI Themes, Tanstack Query (server state), and Jotai (UI state).
    *   Handles user interactions, data display, and API calls.
*   **`packages/whisper`**: (Transcription Service - Python/FastAPI/Docker)
    *   Runs OpenAI Whisper in a Docker container.
    *   Exposes a simple API for the `api` package to submit transcription jobs and check status.
    *   Leverages GPU if available via Docker configuration.
*   **`packages/ollama`**: (LLM Service Definition - Docker Compose)
    *   Defines the Docker Compose configuration for running the Ollama service.
    *   Interaction logic resides in `packages/api`.
*   **`packages/system`**: (System Management Scripts - Node.js/TypeScript)
    *   Provides scripts for optional `systemd` service setup (autostart) and system shutdown triggers, primarily for Linux deployments.
*   **`scripts/`**: Contains helper scripts for development (e.g., `run-dev.js`).

## Technology Stack 🛠️

*   **Backend:** Node.js, ElysiaJS, TypeScript, SQLite (`better-sqlite3`), Axios, Dockerode
*   **Frontend:** React 19, TypeScript, Webpack, Radix UI Themes, Tanstack Query, Jotai, Axios, Tailwind CSS
*   **AI Transcription:** Python, FastAPI, OpenAI Whisper, Uvicorn, Docker
*   **AI Chat:** Ollama (run via Docker)
*   **Monorepo:** Lerna, Yarn Workspaces
*   **Containerization:** Docker, Docker Compose

## Getting Started 🏁

### Prerequisites

*   **Node.js:** Version specified in `.nvmrc` (currently 23.10.0). Using [NVM](https://github.com/nvm-sh/nvm) is recommended.
*   **Yarn:** Yarn Classic (v1.x) is used as the package manager. (`npm install -g yarn`)
*   **Docker:** Required to run Ollama and Whisper services. Install [Docker Engine](https://docs.docker.com/engine/install/).
*   **Docker Compose:** Usually included with Docker Desktop, or install separately ([Docker Compose CLI plugin](https://docs.docker.com/compose/install/)).
*   **(Optional but Recommended for Performance)** **NVIDIA GPU & Drivers:** For significantly faster Whisper transcription and Ollama inference.
*   **(Optional for GPU)** **NVIDIA Container Toolkit:** Required for Docker to access the GPU. ([Installation Guide](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html))
*   **Operating System:**
    *   Linux is recommended, especially if using the `systemd` features or GPU acceleration.
    *   macOS/Windows: Should work for basic functionality (CPU-based AI), but `systemd` scripts and potentially GPU passthrough might require adjustments or alternatives.

### Installation

1.  **Clone the Repository:**
    ```bash
    git clone https://your-repository-url/therascript.git # Replace with actual URL
    cd therascript
    ```

2.  **Set Node.js Version (if using NVM):**
    ```bash
    nvm use
    ```

3.  **Install Dependencies:**
    ```bash
    yarn install
    ```
    This command installs dependencies for all packages in the monorepo.

### Environment Setup

Configuration is managed via `.env` files located in the **root** of the project. These files are loaded by Node.js using the `--env-file` flag specified in the `package.json` scripts.

1.  **Copy the Example:** Copy the `.env.example` file to create environment-specific files:
    *   `.env.api.dev` (for `yarn dev`)
    *   `.env.api.mock` (for `yarn dev:mock`)
    *   `.env.api.prod` (for `yarn start`)

    ```bash
    cp .env.example .env.api.dev
    cp .env.example .env.api.mock
    cp .env.example .env.api.prod
    ```

2.  **Review and Customize `.env.api.dev`:**
    *   Open `.env.api.dev`.
    *   **Crucially, verify paths:** `DB_PATH`, `DB_UPLOADS_DIR` are relative to the `packages/api` directory *even though the `.env` file is in the root*. The defaults (`./data/...`) should work out-of-the-box if you run from the root.
    *   Ensure `OLLAMA_BASE_URL` and `WHISPER_API_URL` point to the correct localhost ports (`http://localhost:11434` and `http://localhost:8000` by default).
    *   Choose appropriate `OLLAMA_MODEL` and `WHISPER_MODEL` values for development (smaller models like `gemma:2b`, `llama3:8b` or `phi3:mini` for Ollama and `tiny` or `base` for Whisper are faster).
    *   Set `CORS_ORIGIN` to the UI development server URL (default: `http://localhost:3002`).

3.  **Review `.env.api.mock`:**
    *   Ensure `APP_MODE=mock` is set.
    *   Other URLs/paths are less critical as services are mocked, but ensure `CORS_ORIGIN` matches the UI dev server.

4.  **Review `.env.api.prod`:**
    *   **SECURITY:** For production, ensure `CORS_ORIGIN` is set to your actual frontend domain.
    *   Use **absolute paths** for `DB_PATH` and `DB_UPLOADS_DIR` pointing to appropriate locations on your server (ensure the user running the API process has write permissions).
    *   Configure production-level `OLLAMA_MODEL` and `WHISPER_MODEL` (e.g., `large-v3` for Whisper).
    *   Adjust `OLLAMA_CHAT_KEEP_ALIVE` based on server RAM.
    *   Set `NODE_ENV=production`.
    *   Set `APP_MODE=production`.

### Initial Model Setup

Before running the application, especially in `dev` or `prod` mode, you need the AI models downloaded:

1.  **Start Docker Services (Temporary):** You can temporarily start the services to pull models:
    ```bash
    # Run from project root
    docker compose -f docker-compose.yml up -d whisper # Starts Whisper
    docker compose -f packages/ollama/docker-compose.yml up -d ollama # Starts Ollama
    ```

2.  **Pull Ollama Model:** Pull the model specified in your `.env.api.dev` (or `.env.api.prod`) file. Find models on the [Ollama Library](https://ollama.com/library).
    ```bash
    # Example: docker compose -f packages/ollama/docker-compose.yml exec ollama ollama pull llama3:8b
    docker compose -f packages/ollama/docker-compose.yml exec ollama ollama pull <your_ollama_model>:<tag>
    ```

3.  **Whisper Model:** The Whisper service (`server.py`) downloads the specified model (`WHISPER_MODEL` from `.env`) automatically on its first run/transcription request. Ensure the `whisper_models` volume defined in the root `docker-compose.yml` persists (`/root/.cache` inside the container).

4.  **Stop Temporary Services:**
    ```bash
    docker compose -f packages/ollama/docker-compose.yml down
    docker compose -f docker-compose.yml down
    ```
    The `yarn dev` script will manage starting these services correctly.

## Running the Application 🏃‍♀️

Run commands from the **project root directory**.

### Development Mode

This starts the API, UI dev server (with HMR), and dependent Docker services (Ollama, Whisper). Uses `.env.api.dev`.

```bash
yarn dev
