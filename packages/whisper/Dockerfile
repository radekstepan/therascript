FROM python:3.12-slim-bookworm

# Set working directory
WORKDIR /app

# Install system dependencies (FFmpeg)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Copy Python dependency file
COPY requirements.txt ./

# Install Python dependencies
RUN pip install --upgrade pip \
    && pip install -r requirements.txt

# Copy application code
COPY transcribe.py ./

# Set environment for Whisper cache
ENV XDG_CACHE_HOME="/root/.cache"

# Command to run the app
ENTRYPOINT ["python3", "transcribe.py"]
CMD []
