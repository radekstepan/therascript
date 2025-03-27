FROM node:22.14-bookworm-slim

# Set working directory
WORKDIR /app

# Install system dependencies (FFmpeg, Python, build tools)
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Copy Node.js dependency files
COPY package.json yarn.lock ./

# Install Node.js dependencies
RUN yarn install

# Copy Python dependency file
COPY requirements.txt ./

# Create and activate virtualenv, install Python dependencies
RUN python3 -m venv /app/env \
    && /app/env/bin/pip install --upgrade pip \
    && /app/env/bin/pip install -r requirements.txt

# Copy application code
COPY index.js whisperRunner.js transcribe.py ./

# Set environment to use virtualenv's Python
ENV PATH="/app/env/bin:$PATH"

# Command to run the app
ENTRYPOINT ["node", "index.js"]
CMD []
