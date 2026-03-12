FROM python:3.10-slim

WORKDIR /app

# Install system dependencies (ffmpeg is required by whisperx)
RUN apt-get update && apt-get install -y \
    curl \
    ffmpeg \
    git \
    supervisor \
    && rm -rf /var/lib/apt/lists/*

# Install PyTorch CPU first.
# whisperx is installed with --no-deps because its transitive dep pyannote-audio>=4.0.0
# requires torchcodec which has no aarch64 Linux wheel (Apple Silicon / ARM Docker).
# We pin pyannote.audio==3.3.2 (last release without torchcodec) in requirements.txt
# and list whisperx's other deps there explicitly.
COPY packages/whisper/requirements.txt ./
RUN pip3 install --no-cache-dir torch==2.2.2 torchaudio==2.2.2 --index-url https://download.pytorch.org/whl/cpu && \
    pip3 install --no-cache-dir --no-deps whisperx==3.4.2 && \
    pip3 install --no-cache-dir -r requirements.txt

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
