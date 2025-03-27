#!/bin/bash

# Exit on error
set -e

# Create virtualenv if it doesn't exist
if [ ! -d "env" ]; then
  echo "Creating virtual environment..."
  python3 -m venv env
fi

# Activate virtualenv
source env/bin/activate

# Install Python dependencies
echo "Installing Python dependencies..."
pip install --upgrade pip
pip install -r requirements.txt

# Install FFmpeg (assuming Ubuntu/Debian WSL)
if ! command -v ffmpeg &> /dev/null; then
  echo "Installing FFmpeg..."
  sudo apt update
  sudo apt install -y ffmpeg
else
  echo "FFmpeg already installed."
fi

# Deactivate virtualenv
deactivate

echo "Setup complete!"
