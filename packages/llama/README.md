# LM Studio Service (llmster)

This package contains the configuration to run **llmster** — LM Studio's headless inference engine — as the LLM backend for Therascript.  
llmster replaces the previous llama.cpp build with a zero-build-time, production-ready runtime that supports both CUDA (Linux) and Metal (macOS).

## Quick Start

### 🍎 macOS (Apple Silicon / Metal)

Install llmster natively — Docker cannot access Metal GPU on macOS:

```bash
curl -fsSL https://lmstudio.ai/install.sh | bash
```

> [!IMPORTANT]
> **Daemon vs. Server:** The `lms` CLI manages two different processes. `lms daemon up` starts the background engine, but **`lms server start`** is required to enable the HTTP API that Therascript uses.
> 
> If the API reports a connection error on port 1234 while models appear in `lms ls`, ensure the server is active:
> ```bash
> lms server start --port 1234
> ```

The Therascript API will automatically attempt to start both the daemon and server on port **1234** when it first receives an LLM request.

### 🐧 Linux (NVIDIA GPU / CUDA)

Run llmster inside a Docker container with CUDA pass-through:

```bash
docker compose -f packages/llama/docker-compose.gpu.yml up -d --build
```

### 🐧 Linux (CPU only)

```bash
docker compose -f packages/llama/docker-compose.yml up -d --build
```

## Models

LM Studio identifies models by their **model key**, e.g.:

```
lmstudio-community/meta-llama-3.1-8b-instruct-gguf
```

### Placing models

**Native (macOS/Linux):**  
Models are managed by LM Studio and stored in `~/.lmstudio/models/`. You can use the Therascript UI (via the "Download Model" button) or the `lms` CLI:

```bash
# Get a model using its LM Studio hub identifier:
lms get lmstudio-community/meta-llama-3.1-8b-instruct-gguf

# On macOS (Apple Silicon), you can also get MLX models:
lms get mlx-community/Llama-3.2-3B-Instruct-4bit
```

You can also use a direct Hugging Face URL in the Therascript UI or via `curl`:
```bash
curl -X POST http://localhost:1234/api/v1/models/download \
  -H "Content-Type: application/json" \
  -d '{"model": "https://huggingface.co/mlx-community/Llama-3.2-3B-Instruct-4bit"}'
```

**Docker (Linux):**  
Place model files into `packages/llama/models/`. This directory is bind-mounted to `/root/.lmstudio/models/` inside the container.

### Setting the active model

Set `LLM_MODEL_PATH` to the LM Studio model key in your `.env`:

```env
LLM_MODEL_PATH=lmstudio-community/meta-llama-3.1-8b-instruct-gguf
```

Or load a model at runtime via the Therascript API `/api/llm/set-model`.

## Configuration

| Environment variable | Default | Description |
|---|---|---|
| `LLM_BASE_URL` | `http://localhost:1234` | LM Studio server URL |
| `LLM_MODEL_PATH` | `default` | LM Studio model key or `default` |
| `LLM_RUNTIME` | `native` (macOS) / `docker` (Linux) | `native` or `docker` |
| `LMS_BINARY_PATH` | auto-detected | Path to the `lms` binary |
| `LMS_PORT` | `1234` | Port for the LM Studio server (Docker) |

## How It Works

### Native runtime (Mac / Linux bare-metal)

The `LmStudioRuntime` in `packages/api/src/services/llamaCppRuntime.ts`:
1. Locates the `lms` binary (`~/.lmstudio/bin/lms` or `$PATH`)
2. Starts the llmster daemon: `lms daemon up`
3. Starts the HTTP server: `lms server start --port 1234`
4. Polls `GET /api/v1/models` until the API is responsive

### Model load / unload

All model management goes through the LM Studio REST API:
- **Load:** `POST /api/v1/models/load` — with `context_length`, `flash_attention`, `offload_kv_cache_to_gpu`
- **Unload:** `POST /api/v1/models/unload`
- **List:** `GET /api/v1/models`
- **Download:** `POST /api/v1/models/download` — accepts an LM Studio model key or a Hugging Face URL

### Chat / streaming

Uses the OpenAI-compatible endpoint: `POST /v1/chat/completions` — no changes required to the streaming layer.

### GPU acceleration

| Platform | Acceleration | How configured |
|---|---|---|
| macOS (Apple Silicon) | Metal (automatic) | LM Studio auto-detects |
| Linux (NVIDIA) | CUDA (automatic) | LM Studio auto-detects via CUDA runtime |
| CPU-only | None | Set `numGpuLayers=0` in the UI or API |

Setting `numGpuLayers=0` disables GPU KV-cache offloading (`offload_kv_cache_to_gpu: false`). All other values let LM Studio choose the optimal GPU configuration automatically.

## GPU Monitoring (Linux)

Ensure the [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html) is installed before using the GPU Docker image.

## Stopping the Service

**Native:**
```bash
lms server stop        # stop HTTP server only
lms daemon down        # also stop the background daemon
```

**Docker:**
```bash
docker compose -f packages/llama/docker-compose.gpu.yml stop
```
