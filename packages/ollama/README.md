# Ollama Service Setup (`packages/ollama`)

This package contains the Docker configuration (`docker-compose.yml`) for running the [Ollama](https://ollama.com/) service used by the Therascript application.

## Purpose

The primary role of this package is to define the Docker service configuration for Ollama. The actual interaction with the Ollama API (sending chat requests, managing models) is handled by the `packages/api` backend service.

The `docker-compose.yml` file defines:

*   The Ollama service container (`ollama_server_managed`) based on the official `ollama/ollama` image.
*   Port mapping (`11434:11434`) to expose the Ollama API to the host (and subsequently to the `api` service).
*   A named volume (`ollama_data`) to persist downloaded LLM models, preventing re-downloads when the container restarts.
*   **(Optional)** GPU resource allocation (`deploy` section) for accelerating model inference if an NVIDIA GPU and the NVIDIA Container Toolkit are available on the host machine.

## Usage

This service is typically **not run independently**. It is managed by the root `run-dev.js` script or potentially a root `docker-compose.yml` (if one were created for full application deployment) which orchestrates starting/stopping dependent services.

The `packages/api` service expects the Ollama API to be available at the URL specified in its environment configuration (`OLLAMA_BASE_URL`, typically `http://localhost:11434` for local development).

### Native Runtime on macOS

- macOS developers can now run Ollama directly on the host for better performance by setting `OLLAMA_RUNTIME=native` (this is the default on macOS).
- Ensure the Ollama CLI is installed locally (e.g., via Homebrew or the official app). The API automatically falls back to `brew services`, `launchctl`, or a detached `ollama serve` process when the Docker container is disabled.
- To force the legacy Docker-based workflow, export `OLLAMA_RUNTIME=docker` before starting the stack.

## Model Management

While the `api` package provides endpoints for managing models (pulling, deleting), you can also interact directly with the Ollama container using `docker compose exec` (run from this directory or use the `-f` flag with the compose file path from the root):

*   **List downloaded models:**
    ```bash
    # From this directory:
    docker compose exec ollama ollama list
    # From project root:
    docker compose -f packages/ollama/docker-compose.yml exec ollama ollama list
    ```
*   **Pull (download) a new model:** Find models on the [Ollama Library](https://ollama.com/library).
    ```bash
    # From this directory:
    docker compose exec ollama ollama pull <model_name>:<tag>
    # Example: docker compose exec ollama ollama pull phi3:mini
    ```
*   **Remove a downloaded model:**
    ```bash
    # From this directory:
    docker compose exec ollama ollama rm <model_name>:<tag>
    ```

## Deprecated Client

This package previously contained a Node.js/TypeScript CLI client (`src/`) for interacting with Ollama. This client is **not used** by the main Therascript application and can be considered deprecated or for standalone testing only. The core Ollama interaction logic resides in `packages/api/src/services/ollamaService.ts`.
