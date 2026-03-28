# Llama.cpp Service

This package provides a containerized `llama.cpp` server for high-performance LLM inference. It is configured to build natively for your hardware to ensure maximum performance and avoid emulation overhead.

## Quick Start

### 🍎 On macOS (Apple Silicon)
To run with native ARM64 CPU optimization (No GPU/Metal support in Docker):

```bash
docker compose -f packages/llama/docker-compose.yml up -d --build
```

### 🐧 On Linux (NVIDIA GPU)
To run with full CUDA acceleration:

```bash
docker compose -f packages/llama/docker-compose.gpu.yml up -d --build
```

## Why we use `--build`?
We build the image locally instead of pulling a pre-built one because:
1. **Architecture Match**: It ensures the binary is compiled for your specific CPU (ARM64 for Mac, x86_64 for Linux).
2. **Instruction Sets**: By using `-DLLAMA_NATIVE=ON`, the compiler optimizes for your specific processor's features (AVX, Neon, etc.).
3. **No performance warnings**: Using the native architecture prevents the "Image may have poor performance" warning in Docker Desktop on macOS.

## Configuration
The server is configured via [docker-compose.yml](docker-compose.yml):
- **Model**: Place your GGUF models in the `./models` directory.
- **Default**: It looks for `models/default.gguf` by default.
- **Context Size**: Set to `8192` by default.

## GPU Monitoring (Linux Only)
The GPU version uses the `nvidia/cuda` base image. Ensure you have the [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html) installed on your host.
