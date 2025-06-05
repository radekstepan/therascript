# Therascript ✨

Therascript is a comprehensive application designed to assist therapists by streamlining the process of analyzing therapy sessions. It allows users to upload audio recordings of sessions, which are then transcribed and made available for AI-powered chat analysis. This enables therapists to quickly gain insights, review key moments, and efficiently manage their session notes.

## Key Features

*   **Session Management:** Upload audio files, manage session metadata (client details, date, type, therapy modality), and view a history of all sessions.
*   **Audio Transcription:** Utilizes OpenAI's Whisper model (via a dedicated Docker service) to accurately transcribe session audio.
*   **AI-Powered Chat Analysis:**
    *   Interact with an AI (powered by local LLMs via Ollama) to ask questions about specific session transcripts.
    *   Engage in standalone AI chat sessions not tied to a specific therapy session.
*   **Full-Text Search:** Search across all chat messages and transcript paragraphs to quickly find relevant information.
*   **LLM Management:**
    *   View locally available Ollama models.
    *   Pull new models from the Ollama library.
    *   Set the active model and context size for analysis.
    *   Delete locally stored models.
    *   Unload models from memory to free up resources.
*   **User Interface:** A modern, responsive web UI built with React and Radix UI Themes for intuitive interaction.
*   **Dockerized Services:** Ollama and Whisper services are containerized for easy setup and management.
*   **Customizable Experience:** Includes theme selection (light, dark, system) and options for rendering AI responses (Markdown or plain text).
*   **Application Shutdown:** System control to gracefully shut down the application and its associated services.

## Technology Stack

*   **Frontend:**
    *   React 19, TypeScript
    *   Radix UI Themes & Primitives
    *   Tailwind CSS
    *   Tanstack Query (Server State Management)
    *   Jotai (UI State Management)
    *   React Router DOM (Routing)
    *   Webpack (Build Tool)
    *   Axios (API Client)
*   **Backend (API):**
    *   ElysiaJS (Node.js Framework)
    *   TypeScript
    *   SQLite (via `better-sqlite3`)
    *   `@dqbd/tiktoken` (Token counting)
*   **AI Services:**
    *   **Ollama:** For running local Large Language Models (LLMs).
    *   **Whisper (OpenAI):** For audio transcription (via a Python FastAPI service).
*   **Database:** SQLite
*   **Containerization:** Docker, Docker Compose
*   **Monorepo Management:** Lerna, Yarn Workspaces

## Project Structure

Therascript is a monorepo organized into several packages:

*   `packages/api`: The backend ElysiaJS server. Handles business logic, database interactions, and communication with Ollama and Whisper services.
*   `packages/ui`: The React-based frontend application that users interact with.
*   `packages/ollama`: Contains Docker configuration (`docker-compose.yml`) and management scripts for the Ollama service.
*   `packages/whisper`: Contains the Python FastAPI service for Whisper, its Dockerfile, and management scripts.
*   `packages/docker-utils`: Shared utilities for managing Docker containers, used by other packages.
*   `scripts/`: Contains root-level scripts for running the application in different modes (e.g., `run-dev.js`, `run-prod.js`).

## Prerequisites

Before you begin, ensure you have the following installed:

1.  **Node.js and Yarn:**
    *   It's recommended to use NVM (Node Version Manager) to manage Node.js versions.
    *   The required Node.js version is specified in `.nvmrc` (currently `23.10.0`).
        ```bash
        nvm install
        nvm use
        ```
    *   Yarn (Classic v1.x) is used as the package manager. Install it if you haven't: `npm install --global yarn`.
2.  **Docker and Docker Compose:**
    *   Docker Desktop for Windows/macOS or Docker Engine + Docker Compose plugin for Linux.
    *   Ensure the Docker daemon is running.
    *   On Windows (WSL), make sure to disable Resource Saver in Docker Desktop.
    *   On Linux, you might need to add your user to the `docker` group: `sudo usermod -aG docker $USER` (then log out and log back in).
3.  **NVIDIA GPU with CUDA (Recommended for AI Services):**
    *   For optimal performance with Ollama and Whisper, an NVIDIA GPU with CUDA drivers and the [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html) installed is highly recommended.
    *   Verify CUDA installation with `nvidia-smi`.
    *   Ollama and Whisper *can* run on CPU, but performance will be significantly slower.

## Setup and Installation

1.  **Install Node.js Version:**
    ```bash
    nvm use
    ```

2.  **Install Dependencies:**
    This will install dependencies for all packages in the monorepo.
    ```bash
    yarn install
    ```

3.  **Configure Environment Variables:**
    *   Copy the example environment file `.env.example` to:
        *   `.env.api.dev` (for local development with real services)
        *   `.env.api.mock` (for local development with mocked API/AI services)
        *   `.env.api.prod` (for production-like builds/runs)
    *   Adjust the variables in these files as needed for your setup (e.g., `OLLAMA_MODEL`, `WHISPER_MODEL`, paths, ports if necessary).
    *   Pay special attention to `APP_MODE` in each file.
    *   **Important:** Paths like `DB_PATH` and `DB_UPLOADS_DIR` in the `.env.api.*` files are relative to the `packages/api` directory.

4.  **Build All Packages:**
    This compiles TypeScript code for all packages.
    ```bash
    yarn build
    ```

## Running the Application

The application uses helper scripts (`scripts/run-dev.js` and `scripts/run-prod.js`) to manage the API, UI, and Docker services (Ollama, Whisper).

### Development Mode

This mode starts the API, UI (with hot-reloading), and ensures the Ollama and Whisper Docker containers are running. It uses settings from `.env.api.dev`.

```bash
yarn dev
```

*   **API Server:** Typically runs on `http://localhost:3001`.
*   **UI (Webpack Dev Server):** Typically runs on `http://localhost:3002`.
*   **Whisper Service:** Docker container, API on `http://localhost:8000`.
*   **Ollama Service:** Docker container, API on `http://localhost:11434`.

The first time you run `yarn dev`, Docker images for Whisper and Ollama will be pulled/built, which may take some time. You can monitor progress in Docker Desktop or via `docker ps` and `docker logs <container_name>`.

### Mock Development Mode

This mode is useful for frontend development if you don't need or cannot run the actual Ollama and Whisper services. The API will use mock implementations. It uses settings from `.env.api.mock`.

```bash
yarn dev:mock
```

*   **API Server (Mock Mode):** `http://localhost:3001`.
*   **UI (Webpack Dev Server):** `http://localhost:3002`.
*   Whisper and Ollama Docker containers are **not** started in this mode.

### Production-like Mode

This script builds all packages and then starts them in a production-like configuration using settings from `.env.api.prod`.

```bash
yarn start
```

This will:
1.  Build all packages (`yarn build`).
2.  Start the API server.
3.  Start the UI development server (for easy access, though in true production you'd serve static UI files).
4.  Ensure Ollama and Whisper Docker containers are running.

### Accessing the Application

Once running, the UI is typically accessible at `http://localhost:3002`.

## Docker Services & Models

*   **Ollama:**
    *   The `yarn dev` or `yarn start` scripts manage the Ollama Docker container (`ollama_server_managed`).
    *   You need to **pull LLM models** for Ollama to use. You can do this through the Therascript UI (Manage LLM modal) or via the command line:
        ```bash
        # Example: Pull Llama 3 8B model
        docker exec ollama_server_managed ollama pull llama3:8b
        # Example: Pull Gemma3 2B model (smaller, faster for dev)
        docker exec ollama_server_managed ollama pull gemma3:2b
        ```
    *   The default model used by the API is set in `.env.api.*` via `OLLAMA_MODEL`. Ensure this model is pulled.
*   **Whisper:**
    *   The `yarn dev` or `yarn start` scripts manage the Whisper Docker container (`therascript_whisper_service`).
    *   The Whisper model used for transcription is set in `.env.api.*` via `WHISPER_MODEL` (e.g., `base`, `tiny`, `small`, `medium`, `large-v3`). Models are downloaded automatically by the Whisper service on first use if not cached in its Docker volume.

## Environment Variables

Key environment variables are defined in `.env.example`. The most important for controlling behavior are:

*   `APP_MODE`: Set in `.env.api.*` files. Can be:
    *   `development`: Uses real Ollama and Whisper services.
    *   `production`: Uses real Ollama and Whisper services, with production-oriented settings.
    *   `mock`: API uses mock implementations for Ollama and Whisper.
*   `OLLAMA_MODEL`: The default/active LLM for Ollama.
*   `WHISPER_MODEL`: The Whisper model to use for transcriptions.
*   `CORS_ORIGIN`: The URL of the UI frontend.
*   `PORT`: Port for the API server.

## API Documentation

When the API server is running, Swagger UI documentation is available at:
`http://localhost:<API_PORT>/api/docs` (e.g., `http://localhost:3001/api/docs`).

## Available Scripts (from root `package.json`)

*   `yarn build`: Builds all packages.
*   `yarn build:api`: Builds only the API package.
*   `yarn build:ui`: Builds only the UI package.
*   `yarn dev`: Starts the full development environment.
*   `yarn dev:mock`: Starts development environment with mocked backend services.
*   `yarn start`: Starts the application in a production-like mode (builds first).
*   `yarn start:api:prod`: Builds and starts only the API in production mode.
*   `yarn start:whisper`: Builds and starts the Whisper service manager (used by `dev`/`start` scripts).
*   `yarn lint`: Lints all packages.
*   `yarn format`: Formats code in all packages using Prettier.
*   `yarn preload:db`: Deletes and re-initializes the development database with sample data (uses `.env.api.dev`).
*   `yarn clean`: Removes `node_modules` and build artifacts from all packages.
*   `yarn clean:dist`: Removes build artifacts (`dist`, `*.tsbuildinfo`) from all packages.

## Contributing

(Contributions are welcome! Please follow standard practices for pull requests, issue reporting, etc. - Placeholder for more detailed guidelines).

## License

This project is licensed under the MIT License. See the `LICENSE` file for details (implicitly, as no separate LICENSE file is present but `package.json` specifies MIT).
