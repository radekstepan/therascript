# Whisper Transcription

A Python-based Docker container for running OpenAI's Whisper audio transcription.

Install NVIDIA Container Toolkit for GPU support inside WSL.

```sh
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
  sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt-get update
sudo apt-get install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

Then build and run the command.

```sh
docker build -t therascript/whisper .
docker run --gpus all --rm \
  -v $(pwd)/demo/session.mp3:/input.mp3 \
  -v $(pwd)/output/transcript.json:/transcript.json \
  -v $(pwd)/models:/root/.cache \
  therascript/whisper /input.mp3 /transcript.json tiny
```

### Debug

To run the Docker commands as current user:

```sh
sudo usermod -aG docker $USER
```
