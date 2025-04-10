# Therapy Analyzer Backend

This is the backend service for the Therapy Analyzer application. It uses Express.js, TypeScript, Ollama for AI analysis, and a flat-file (JSON) database for storing session data and transcripts.

## Features

*   Manages therapy session metadata and transcripts.
*   Handles audio file uploads and simulated transcription.
*   Provides chat functionality integrated with Ollama for session analysis.
*   Supports creating, renaming, and deleting chats.
*   Offers paragraph-level editing of transcripts.
*   Uses a flat-file system for data persistence.
*   Includes an API schema endpoint (`/api/schema`).

## Prerequisites

*   Node.js (v16 or later recommended)
*   npm or yarn
*   Ollama installed and running (refer to [Ollama documentation](https://github.com/ollama/ollama))
*   An Ollama model pulled (e.g., `ollama pull llama3`) - specified in `.env`.

## Setup

1.  **Clone the repository:**
    ```bash
    git clone <repository-url> therapy-analyzer-backend
    cd therapy-analyzer-backend
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    # or
    yarn install
    ```

3.  **Configure Environment Variables:**
    *   Copy the example environment file:
        ```bash
        cp .env.example .env
        ```
    *   Edit the `.env` file and set the correct values for:
        *   `PORT`: The port the backend server will run on (default: 3001).
        *   `OLLAMA_BASE_URL`: The URL where your Ollama instance is running (default: `http://localhost:11434`).
        *   `OLLAMA_MODEL`: The specific Ollama model to use for chat analysis (e.g., `llama3`, `mistral`). Ensure this model is pulled in Ollama.
        *   `DB_SESSIONS_PATH`: Path to the session data JSON file (default: `./data/sessions.json`).
        *   `DB_TRANSCRIPTS_DIR`: Directory to store transcript text files (default: `./data/transcripts`).
        *   `CORS_ORIGIN`: The URL of your frontend application (default: `http://localhost:3002`) to allow requests.

4.  **Ensure Data Directories Exist:**
    The application attempts to create the `data` and `data/transcripts` directories on startup if they don't exist. You might need appropriate permissions. The `data/uploads` directory for temporary file uploads will also be created.

## Running the Server

*   **Development Mode (with auto-rebuild and restart):**
    ```bash
    npm run dev
    # or
    yarn dev
    ```
    This uses `tsc --watch` to compile TypeScript on changes and `nodemon` to restart the server.

*   **Production Mode:**
    1.  Build the TypeScript code:
        ```bash
        npm run build
        # or
        yarn build
        ```
    2.  Start the server:
        ```bash
        npm start
        # or
        yarn start
        ```

## API Endpoints

See the `/api/schema` endpoint for a detailed list of available actions, their methods, parameters, and descriptions.

**Key Endpoints:**

*   `GET /api/health`: Check server status.
*   `GET /api/schema`: Get the API action schema.
*   `GET /api/sessions`: List session metadata.
*   `POST /api/sessions/upload`: Upload session audio + metadata.
*   `GET /api/sessions/:sessionId`: Get full session details + transcript.
*   `PUT /api/sessions/:sessionId/metadata`: Update session metadata.
*   `PATCH /api/sessions/:sessionId/transcript`: Update a transcript paragraph.
*   `POST /api/sessions/:sessionId/chats`: Create a new chat.
*   `POST /api/sessions/:sessionId/chats/:chatId/messages`: Send chat message, get AI response.
*   `PATCH /api/sessions/:sessionId/chats/:chatId/name`: Rename chat.
*   `DELETE /api/sessions/:sessionId/chats/:chatId`: Delete chat.

## Notes

*   **Transcription:** The current implementation uses a *simulated* transcription service. Replace `src/services/transcriptionService.ts` with actual integration (e.g., Whisper, AssemblyAI) for real-world use.
*   **Database:** This uses a simple flat-file system. For production or larger scale, consider a more robust database solution. The current implementation uses a basic async queue for write operations to prevent simple race conditions but is not fully robust against all concurrency issues.
*   **Error Handling:** Basic error handling is implemented. Enhance as needed for production requirements.
*   **Security:** Ensure proper CORS configuration, input validation, and potentially authentication/authorization for production deployment. Be mindful of storing sensitive data in flat files.
