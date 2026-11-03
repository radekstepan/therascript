---
'@therascript/whisper': patch
---

# Fix GPU Dockerfile CUDA base image tag

- The GPU build referenced `nvidia/cuda:12.6.0-cudnn9-runtime-ubuntu22.04`, a tag that does not exist on Docker Hub (the `cudnn9` alias is only published for CUDA 12.8+). The correct tag — same cuDNN 9 stack — is `nvidia/cuda:12.6.0-cudnn-runtime-ubuntu22.04`, so the GPU image was unbuildable until fixed.
