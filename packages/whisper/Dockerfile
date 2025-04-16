FROM python:3.12-slim-bookworm

# Set working directory
WORKDIR /app

# Install system dependencies (FFmpeg & potentially others for torch/audio)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# --- Dockerfile Modification Starts Here ---

# Install Python dependencies
RUN pip install --upgrade pip

# *** Install PyTorch separately first using the nightly index ***
# Using --pre to ensure development versions are considered
RUN pip install --pre torch torchvision torchaudio --index-url https://download.pytorch.org/whl/nightly/cu128

# *** Install the rest from requirements.txt ***
# Copy requirements file AFTER installing torch
COPY requirements.txt ./
# Install remaining dependencies (pip will now use default + extra index defined in requirements.txt)
RUN pip install -r requirements.txt

# --- Dockerfile Modification Ends Here ---


# Copy application code (keep this after installations)
COPY transcribe.py ./
COPY server.py ./

# Create temporary directories expected by the server
RUN mkdir -p /app/temp_inputs /app/temp_outputs

# Set environment for Whisper cache (optional, depends on volume mapping)
ENV XDG_CACHE_HOME="/root/.cache"
# Ensure logs/stdout are shown immediately
ENV PYTHONUNBUFFERED=1

# Expose the port the FastAPI app will run on
EXPOSE 8000

# Command to run the FastAPI server using Uvicorn
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
