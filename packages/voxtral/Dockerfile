FROM vllm/vllm-openai:latest

# Install ffmpeg for audio processing and Python deps for the proxy
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
 && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir fastapi uvicorn[standard] httpx python-multipart

# Add proxy app
WORKDIR /app
COPY packages/voxtral/proxy/app.py /app/app.py

# Environment variables for configuring internal vLLM
ENV VOXTRAL_MODEL="mistralai/Voxtral-Mini-3B-2507"
ENV VOXTRAL_DTYPE="bfloat16"
ENV VOXTRAL_TOKENIZER_MODE="mistral"
ENV VOXTRAL_CONFIG_FORMAT="mistral"
ENV VOXTRAL_LOAD_FORMAT="mistral"
ENV VOXTRAL_MAX_MODEL_LEN="14384"
ENV VOXTRAL_GPU_MEMORY_UTILIZATION="0.90"

# Chunking settings
ENV VOXTRAL_CHUNK_SECONDS="300"
ENV VOXTRAL_AUDIO_BITRATE="32k"
ENV VOXTRAL_AUDIO_SAMPLE_RATE="16000"
ENV VOXTRAL_AUDIO_CHANNELS="1"

EXPOSE 8000

# Override base image entrypoint so we can run the proxy instead of starting vLLM directly
ENTRYPOINT ["python3", "/app/app.py"]
