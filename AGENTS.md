# Therascript Agents & Workflows

This document outlines the autonomous and semi-autonomous agents operating within the Therascript ecosystem. The system utilizes a combination of background workers (BullMQ), specialized API handlers, and LLM-driven strategies to process therapy sessions.

## 📖 System Documentation
For detailed implementation references, please see:
- **[Architecture](docs/ARCHITECTURE.md)**: High-level system architecture, package organization, and infrastructure.
- **[Component Map](docs/COMPONENT_MAP.md)**: Breakdown of packages, libraries, and entry points.
- **[Navigation Guide](docs/NAVIGATION.md)**: "Where to change what" – directory structure and common tasks.
- **[API Reference](docs/API_REFERENCE.md)**: Complete REST API endpoint documentation.
- **[Operational Flows](docs/DATA_FLOWS.md)**: Step-by-step data flow for Transcription, Chat, and Analysis.
- **[Schema Reference](docs/SCHEMA_REFERENCE.md)**: SQLite tables and Elasticsearch indices.

## 1. Background Workers
Located in `packages/worker`, these agents run asynchronously to handle heavy computational tasks.

### Transcription Agent
*   **Type:** BullMQ Worker (`transcription-jobs`)
*   **Source:** `packages/worker/src/jobs/transcriptionProcessor.ts`
*   **Responsibility:** "The Ears"
*   **Workflow:**
    1.  Receives `sessionId` from the API after file upload.
    2.  Fetches audio path from SQLite.
    3.  Submits audio to the **Whisper Service** (`packages/whisper`) and polls for completion.
    4.  **Post-Processing:**
        *   Parses raw segments into time-stamped paragraphs.
        *   Calculates token counts.
        *   Indexes paragraphs into **Elasticsearch** (`therascript_transcripts`).
        *   Creates the initial "AI" chat message in the database.
*   **Infrastructure:** Depends on GPU availability (via Whisper Docker container).

### Analysis Agent (The Researcher)
*   **Type:** BullMQ Worker (`analysis-jobs`)
*   **Source:** `packages/worker/src/jobs/analysisProcessor.ts`
*   **Responsibility:** "The Analyst" (MapReduce Engine)
*   **Workflow:**
    1.  Receives a `jobId` and a defined **Strategy** (JSON plan).
    2.  **Map Phase:** Iterates through every selected session transcript.
        *   Context: The specific session transcript.
        *   Prompt: The `intermediate_question` defined by the Strategy Agent.
        *   Output: Stores an `IntermediateSummary` for that session.
    3.  **Reduce Phase:** Aggregates all intermediate summaries chronologically.
        *   Context: The collection of summaries.
        *   Prompt: The `final_synthesis_instructions` defined by the Strategy Agent.
        *   Output: Generates the final answer to the user's high-level query.

## 2. System & Utility Agents
Located in `packages/api`, these "meta-agents" configure or summarize data to facilitate the main workflows.

### Strategy Generator (The Planner)
*   **Type:** API Service / LLM Chain
*   **Source:** `packages/api/src/api/analysisHandler.ts`
*   **Prompt Template:** `system_analysis_strategist` (in `packages/db/src/sqliteService.ts`)
*   **Responsibility:**
    *   Takes a complex user query (e.g., "How has the patient's anxiety evolved over the last 4 sessions?").
    *   Generates a **JSON Plan** containing:
        *   `intermediate_question`: Instructions for the Analysis Agent to run on *individual* documents.
        *   `final_synthesis_instructions`: Instructions on how to combine those results.
*   **Trigger:** Called immediately before queuing an Advanced Analysis Job.

### Short Prompt Generator (The Summarizer)
*   **Type:** API Background Task
*   **Source:** `packages/api/src/api/analysisHandler.ts`
*   **Prompt Template:** `system_short_prompt_generator`
*   **Responsibility:**
    *   Takes a long, complex user prompt.
    *   Compresses it into a short (max 5 words) title for the UI list view.
    *   *Example:* "Analyze the recurring themes of abandonment..." -> "Abandonment Themes Analysis".

## 3. Interactive Agents
These operate in real-time via the API (`packages/api`) to facilitate user interaction.

### Session Chat Agent
*   **Type:** RAG / Context-Aware Chatbot
*   **Source:** `packages/api/src/api/sessionChatHandler.ts` & `packages/api/src/services/ollamaService.ts`
*   **Prompt Template:** `system_prompt`
*   **Context:**
    *   Full transcript of the specific session (up to context window limit).
    *   Recent chat history.
*   **Capabilities:** Can quote the patient/therapist, identify CBT techniques used in the specific text, and clarify transcript ambiguities.
*   **Memory:** Context is re-injected on every turn; state is stored in SQLite (`messages` table).

### Standalone Chat Agent
*   **Type:** General Purpose Assistant
*   **Source:** `packages/api/src/api/standaloneChatHandler.ts`
*   **Prompt Template:** `system_standalone_prompt`
*   **Context:** No transcript context. Pure chat history.
*   **Capabilities:** General questions, brainstorming, or drafting emails/notes without specific session grounding.

## 4. Service Agents (External)

### Whisper Service
*   **Location:** `packages/whisper` (Python/FastAPI)
*   **Role:** Audio-to-Text inference engine.
*   **Tech:** OpenAI Whisper (running on PyTorch/CUDA).

### Ollama Service
*   **Location:** `packages/ollama` (Docker)
*   **Role:** LLM Inference Provider.
*   **Models:** Llama 3, Mistral, Gemma (configurable).
*   **API:** `packages/api/src/services/ollamaService.ts` manages the lifecycle (loading/unloading/pulling) of these models.
