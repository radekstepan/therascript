# Therascript ✨

Therascript is a comprehensive application designed to assist therapists by streamlining the process of analyzing therapy sessions. It allows users to upload audio recordings of sessions, which are then transcribed and made available for AI-powered chat analysis. This enables therapists to quickly gain insights, review key moments, and efficiently manage their session notes.

![Screenshot](screenshot.png)

## Key Features

*   **Session Management:** Upload audio files, manage session metadata (client details, date, type, therapy modality), and view a history of all sessions.
*   **Audio Transcription:** Utilizes OpenAI's Whisper model (via a dedicated Docker service) to accurately transcribe session audio.
*   **AI-Powered Chat Analysis:**
    *   Interact with an AI (powered by local LLMs via Ollama) to ask questions about specific session transcripts.
    *   Engage in standalone AI chat sessions not tied to a specific therapy session.
*   **Full-Text Search:** Search across all chat messages and transcript paragraphs to quickly find relevant information using Elasticsearch.
*   **LLM Management:**
    *   View locally available Ollama models.
    *   Pull new models from the Ollama library.
    *   Set the active model and context size for analysis.
    *   Delete locally stored models.
    *   Unload models from memory to free up resources.
*   **User Interface:** A modern, responsive web UI built with React and Radix UI Themes for intuitive interaction.
*   **Dockerized Services:** Ollama, Whisper, and Elasticsearch services are containerized for easy setup and management.
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
*   **Search Service:** Elasticsearch
*   **Database:** SQLite
*   **Containerization:** Docker, Docker Compose
*   **Monorepo Management:** Lerna, Yarn Workspaces

## Project Structure

Therascript is a monorepo organized into several packages:

*   `packages/api`: The backend ElysiaJS server. Handles business logic, database interactions, and communication with Ollama, Whisper, and Elasticsearch services.
*   `packages/ui`: The React-based frontend application that users interact with.
*   `packages/ollama`: Contains Docker configuration (`docker-compose.yml`) and management scripts for the Ollama service.
*   `packages/whisper`: Contains the Python FastAPI service for Whisper, its Dockerfile, and management scripts.
*   `packages/elasticsearch-client`: A shared client and utilities for interacting with Elasticsearch.
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
    *   Ollama and Whisper *can* run on CPU, but performance will be significantly slower. Elasticsearch does not require a GPU.

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
    *   Adjust the variables in these files as needed for your setup (e.g., `OLLAMA_MODEL`, `WHISPER_MODEL`, `ELASTICSEARCH_URL`, paths, ports if necessary).
    *   Pay special attention to `APP_MODE` in each file.
    *   **Important:** Paths like `DB_PATH` and `DB_UPLOADS_DIR` in the `.env.api.*` files are relative to the `packages/api` directory.

4.  **Build All Packages:**
    This compiles TypeScript code for all packages.
    ```bash
    yarn build
    ```

## Running the Application

The application uses helper scripts (`scripts/run-dev.js` and `scripts/run-prod.js`) to manage the API, UI, and ensure some Docker services (Ollama, Whisper) are managed. Elasticsearch and Kibana are typically started using the root `docker-compose.yml`.

### Managing Docker Services (Elasticsearch, Whisper, Kibana)

The primary Docker services (Elasticsearch, Whisper, Kibana) are defined in the root `docker-compose.yml` file.

1.  **Start Services:**
    To start all services defined in the root `docker-compose.yml` (this includes Elasticsearch, Whisper, and Kibana):
    ```bash
    # Run from the project root directory
    docker compose up -d --build
    ```
    Elasticsearch can take a minute or two to initialize fully, especially on the first run.

2.  **Check Status:**
    ```bash
    docker ps
    ```
    Look for `therascript_elasticsearch_service`, `therascript_whisper_service`, and `therascript_kibana_service`.

3.  **View Logs (if issues):**
    ```bash
    docker logs therascript_elasticsearch_service
    docker logs therascript_whisper_service
    ```

### Development Mode

This mode starts the API, UI (with hot-reloading), and specific managers for Ollama and Whisper services. It relies on Elasticsearch being started as described above. It uses settings from `.env.api.dev`.

```bash
# First, ensure Elasticsearch and Whisper Docker services are running (if not already):
# docker compose up -d # (from project root)

# Then, start the development environment:
yarn dev
