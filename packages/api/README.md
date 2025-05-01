# Therascript Backend API (`packages/api`)

This package contains the backend API server for the Therascript application, built using [ElysiaJS](https://elysiajs.com/) on Node.js with TypeScript.

## Responsibilities

*   Manages therapy session metadata (client details, date, type, etc.).
*   Handles audio file uploads for new sessions.
*   Stores session data, chat history, and transcript paragraphs in an SQLite database (`better-sqlite3`).
*   Interacts with the `whisper` service (via its FastAPI endpoint) to initiate and monitor audio transcription jobs.
*   Interacts with the `ollama` service (via its REST API) to:
    *   Generate AI responses for chat interactions (both session-based and standalone).
    *   Manage LLMs (list, pull, delete, set active model, unload).
*   Provides Full-Text Search (FTS5) capabilities across chat messages and transcript paragraphs.
*   Exposes a RESTful API for the `ui` frontend.
*   Includes API endpoints for managing Docker container status (`docker` service) and triggering system shutdown (`system` service) via helper services.
*   Uses a structured error handling approach (`ApiError` subclasses).
*   Provides API documentation via Swagger UI (`@elysiajs/swagger`).
*   Supports a "mock" mode (`APP_MODE=mock` in `.env`) for frontend development without running real Ollama/Whisper services.

## Key Technologies

*   **Framework:** ElysiaJS
*   **Language:** TypeScript
*   **Runtime:** Node.js
*   **Database:** SQLite (via `better-sqlite3`)
*   **API Docs:** Swagger UI (`@elysiajs/swagger`)
*   **Tokenization:** `@dqbd/tiktoken` (for estimating token counts)
*   **Container Interaction:** `dockerode` (for Docker status)

## Setup

1.  **Dependencies:** Installed via `yarn install` in the project root.
2.  **Environment Variables:**
    *   API configuration is managed via `.env.api.*` files in the project root (e.g., `.env.api.dev`, `.env.api.prod`, `.env.api.mock`).
    *   These files are loaded by Node.js using the `--env-file` flag in the root `package.json` scripts.
    *   Key variables include:
        *   `PORT`: API server port.
        *   `NODE_ENV`: `development` or `production`.
        *   `APP_MODE`: `development`, `production`, or `mock`.
        *   `CORS_ORIGIN`: Allowed frontend origin URL.
        *   `OLLAMA_BASE_URL`: URL of the Ollama service.
        *   `OLLAMA_MODEL`: Default/active Ollama model.
        *   `OLLAMA_CHAT_KEEP_ALIVE`: Keep-alive duration for Ollama models.
        *   `WHISPER_API_URL`: URL of the Whisper service.
        *   `WHISPER_MODEL`: Whisper model to use.
        *   `DB_PATH`: Path *relative to this package directory* for the SQLite database file.
        *   `DB_UPLOADS_DIR`: Path *relative to this package directory* for storing uploaded audio files.
        *   `UPLOAD_MAX_FILE_SIZE`: Maximum allowed upload size.
        *   Mock-specific variables (`MOCK_*_DELAY_MS`, `MOCK_LLM_MODEL_NAME`).
3.  **Database Initialization:** The SQLite database file and schema are created automatically on first run based on the `DB_PATH` and the schema defined in `src/db/sqliteService.ts`.

## Running the Server

*   **Development Mode (via root `yarn dev`):**
    *   The root `run-dev.js` script starts this API using `yarn dev:api`.
    *   `yarn dev:api`: Runs `concurrently` to watch TypeScript files (`tsc --watch`) and restart the server via `nodemon` on changes. Uses `.env.api.dev`.
    ```bash
    # Run from project root
    yarn dev
    ```
*   **Mock Mode (via root `yarn dev:mock`):**
    *   Builds the API and runs the server using `.env.api.mock`.
    *   Uses mock implementations for Ollama and Whisper services.
    ```bash
    # Run from project root
    yarn dev:mock
    ```
*   **Production Mode (via root `yarn start` or `yarn start:api`):**
    *   Builds the API (`tsc`).
    *   Starts the server using Node.js, loading `.env.api.prod`.
    ```bash
    # Run from project root (builds first)
    yarn start:api
    # Or use the system wrapper script (builds first)
    yarn start
    ```

## API Documentation

Once the server is running, API documentation is available via Swagger UI at: `http://localhost:<PORT>/api/docs` (e.g., `http://localhost:3001/api/docs`).

## Key Endpoints (Examples)

*   `GET /api/health`: Check server and database health.
*   `GET /api/docs`: Access Swagger UI documentation.
*   `GET /api/sessions`: List all session metadata.
*   `POST /api/sessions/upload`: Upload session audio + metadata, starts transcription.
*   `GET /api/sessions/:sessionId`: Get full session details (metadata + chat list).
*   `GET /api/sessions/:sessionId/transcript`: Get the structured transcript for a session.
*   `PATCH /api/sessions/:sessionId/transcript`: Update a specific transcript paragraph.
*   `POST /api/sessions/:sessionId/chats`: Create a new chat within a session.
*   `POST /api/sessions/:sessionId/chats/:chatId/messages`: Send chat message, get streaming AI response.
*   `GET /api/chats`: List all standalone chats.
*   `POST /api/chats`: Create a new standalone chat.
*   `POST /api/chats/:chatId/messages`: Send standalone chat message, get streaming AI response.
*   `GET /api/search?q={query}`: Perform full-text search.
*   `GET /api/ollama/available-models`: List local Ollama models.
*   `POST /api/ollama/pull-model`: Start downloading an Ollama model.
*   `GET /api/ollama/pull-status/:jobId`: Check download status.
*   `GET /api/docker/status`: Get status of project Docker containers.
*   `POST /api/system/shutdown`: Initiate system shutdown (requires sudo setup).

Refer to the Swagger UI for a complete and detailed list of endpoints, parameters, and schemas.
