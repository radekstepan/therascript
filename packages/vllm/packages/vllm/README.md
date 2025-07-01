# vLLM Service Setup (`packages/vllm`)

This package contains the Docker configuration (`docker-compose.yml`) for running the [vLLM OpenAI-Compatible Server](https://docs.vllm.ai/en/latest/openai_api.html) and a TypeScript client for interacting with it.

## Purpose

The primary role of this package is to define and manage the Docker service for vLLM. The client-side code provides a convenient way to manage chat sessions and send requests to the vLLM server from a Node.js environment.

The `docker-compose.yml` file defines:

*   The vLLM service container (`vllm_server_managed`) based on the official `vllm/vllm-openai` image.
*   Port mapping (`8000:8000`) to expose the vLLM API to the host.
*   A named volume (`vllm_data`) to persist downloaded Hugging Face models, preventing re-downloads when the container restarts.
*   GPU resource allocation (`deploy` section) for accelerating model inference. This requires an NVIDIA GPU and the [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html) to be installed on the Docker host.
*   Configuration via environment variables for easy model swapping.

## Configuration

Before starting the service, create a `.env` file in this directory with the following variables.

```env
# .env

# The Hugging Face model repository to be served by vLLM.
# Example: "NousResearch/Meta-Llama-3-8B-Instruct"
VLLM_MODEL="NousResearch/Meta-Llama-3-8B-Instruct"

# A secret API key for authorizing requests to the server.
VLLM_API_KEY="your-secret-api-key"

# (Optional) The maximum model length. If not specified, the default from the model's config is used.
# Example: 4096
VLLM_MAX_MODEL_LEN=8192

# (Optional) The number of GPUs to use. Can be a single number or a comma-separated list of IDs.
# Default: 1
NVIDIA_VISIBLE_DEVICES=0
