# CPU Dockerfile for the transcription service.
# Stack: Parakeet (NeMo) ASR + pyannote Community-1 diarization.
# Parakeet runs on CPU but is slow; GPU image recommended for production.
# NOTE: torchcodec 0.7.0 has no linux/aarch64 wheel, so on Apple Silicon this
# image must be built for linux/amd64 (see `platform:` in docker-compose.yml).
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies (ffmpeg is required by torchcodec audio I/O)
RUN apt-get update && apt-get install -y \
    curl \
    ffmpeg \
    git \
    supervisor \
    && rm -rf /var/lib/apt/lists/*

# Install PyTorch CPU first, then the pinned runtime deps
# (pyannote.audio 4.x, NeMo for Parakeet). The constraints file keeps the
# second install from replacing the CPU torch build with a generic wheel.
COPY packages/whisper/requirements.txt packages/whisper/constraints-cpu.txt ./
RUN pip3 install --no-cache-dir torch==2.8.0 torchaudio==2.8.0 torchcodec==0.7.0 --index-url https://download.pytorch.org/whl/cpu && \
    pip3 install --no-cache-dir -c constraints-cpu.txt -r requirements.txt

# Install Node.js (for the Express wrapper)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g yarn

# Copy Node dependencies
COPY packages/whisper/package.json ./
COPY yarn.lock ./
RUN yarn install --production --frozen-lockfile

# Copy source code
COPY packages/whisper/. .

# Expect dist to be prebuilt from the host workspace (yarn build:whisper)
RUN test -f /app/dist/server.js

# Setup Directories
RUN mkdir -p /app/temp_inputs /app/temp_outputs

# Setup Supervisor
COPY packages/whisper/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

EXPOSE 8000 8001

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
