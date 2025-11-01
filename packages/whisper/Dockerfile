# Defines the Docker image for the Whisper transcription service.

# Start with a Node.js base image.
FROM node:20-slim

# Set the working directory inside the container.
WORKDIR /app

# Install system dependencies: Python, pip (for transcribe.py) and ffmpeg (for Whisper).
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    python3 \
    python3-pip \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# --- Install Python Dependencies for transcribe.py ---
# Copy only the requirements file to leverage Docker cache
COPY packages/whisper/requirements.txt ./

# Upgrade pip
RUN pip3 install --upgrade pip --break-system-packages

# Allow selecting the correct PyTorch channel via build args.
# Defaults preserve Linux/WSL behavior (CUDA nightly) but can be overridden on macOS to CPU.
ARG TORCH_INDEX_URL="https://download.pytorch.org/whl/nightly/cu128"
ARG TORCH_FLAGS="--pre"

# Install PyTorch first (so subsequent deps can detect it) using the configured channel.
RUN echo "Installing PyTorch from ${TORCH_INDEX_URL} (flags: '${TORCH_FLAGS}')" \
    && pip3 install ${TORCH_FLAGS} torch torchvision torchaudio --index-url ${TORCH_INDEX_URL} --break-system-packages

# Install the rest of the Python dependencies
RUN pip3 install -r requirements.txt --break-system-packages
# --- End Python Dependencies ---


# --- Install Node.js Dependencies for the server ---

# FIX: Remove the redundant 'npm install -g yarn' command.
# The base node:20-slim image already includes yarn.

# Copy the whisper package's package.json and the root yarn.lock file.
COPY packages/whisper/package.json ./
COPY yarn.lock ./

# Use yarn to install dependencies, respecting the lockfile and omitting dev dependencies.
RUN yarn install --production --frozen-lockfile
# --- End Node.js Dependencies ---


# Copy only the whisper package's source code into the container.
COPY packages/whisper/. .

# Create temporary directories used by the server
# for storing uploaded files and transcription results temporarily.
RUN mkdir -p /app/temp_inputs /app/temp_outputs

# Environment variable to ensure Python output is unbuffered
ENV PYTHONUNBUFFERED=1

# Expose the port the Express application will run on
EXPOSE 8000

# Command to run when the container starts.
# Executes the new Node.js Express server.
CMD ["node", "dist/server.js"]
