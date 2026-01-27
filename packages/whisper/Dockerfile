FROM python:3.10-slim

WORKDIR /app

# Install system dependencies (ffmpeg is still required)
RUN apt-get update && apt-get install -y \
    curl \
    ffmpeg \
    supervisor \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY packages/whisper/requirements.txt ./
RUN pip3 install --no-cache-dir -r requirements.txt

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

# Setup Directories
RUN mkdir -p /app/temp_inputs /app/temp_outputs

# Setup Supervisor
COPY packages/whisper/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

EXPOSE 8000 8001

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
