# Defines the Docker image for the Whisper transcription service.

# Start with a slim Python base image (Bookworm is a Debian version).
FROM python:3.12-slim-bookworm

# Set the working directory inside the container.
WORKDIR /app

# Install essential system dependencies:
# - ffmpeg: Required by Whisper for audio processing.
# - build-essential: May be needed for compiling some Python package dependencies.
# Use --no-install-recommends to minimize image size.
# Clean up apt cache afterwards.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# --- Install Python Dependencies ---

# Upgrade pip first.
RUN pip install --upgrade pip

# Install PyTorch separately *before* other requirements.
# This often helps resolve complex dependency issues and ensures compatibility
# with the desired CUDA version (cu128 in this case, targeting CUDA 12.8).
# Using '--pre' allows installation of pre-release (nightly) versions if needed.
# Using '--index-url' points pip to the specific PyTorch download index.
RUN pip install --pre torch torchvision torchaudio --index-url https://download.pytorch.org/whl/nightly/cu128
# Note: For production, consider using a stable PyTorch release index:
# RUN pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121 # Example for CUDA 12.1

# Copy the requirements file into the container *after* PyTorch is installed.
COPY requirements.txt ./

# Install the remaining Python dependencies listed in requirements.txt.
# Pip will use the default PyPI index plus any '--extra-index-url' specified
# within requirements.txt itself.
RUN pip install -r requirements.txt

# --- End Python Dependencies ---


# Copy the application code into the working directory.
# Do this *after* installing dependencies to leverage Docker build cache.
COPY transcribe.py ./
COPY server.py ./

# Create temporary directories used by the FastAPI server (`server.py`)
# for storing uploaded files and transcription results temporarily.
RUN mkdir -p /app/temp_inputs /app/temp_outputs

# Set environment variable for Whisper model cache location.
# This aligns with the volume mount defined in docker-compose.yml.
ENV XDG_CACHE_HOME="/root/.cache"

# Ensure Python output (like print statements) is sent directly to the console
# without buffering, which is helpful for real-time logging.
ENV PYTHONUNBUFFERED=1

# Expose the port the FastAPI application will run on inside the container.
EXPOSE 8000

# Command to run when the container starts.
# Executes the FastAPI application (`server:app`) using the Uvicorn ASGI server.
# `--host 0.0.0.0`: Makes the server accessible from outside the container (on the mapped port).
# `--port 8000`: Specifies the port the server listens on inside the container.
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
