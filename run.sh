#!/usr/bin/env bash
set -e

# Load NVM manually
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"

# Ensure system binaries are visible first
export PATH="/usr/bin:/usr/local/bin:/bin:/usr/sbin:/sbin:$NVM_DIR/versions/node/$(nvm version)/bin:$PATH"

cd "$HOME/dev/therascript"

nvm use

# Prefer GPU Whisper mode on Linux if NVIDIA becomes available shortly after login.
# This avoids transient boot races where a single early probe falls back to CPU.
GPU_COMPOSE_FILE="$HOME/dev/therascript/docker-compose.gpu.yml"
if [[ -z "${DOCKER_COMPOSE_EXTRA:-}" && -f "$GPU_COMPOSE_FILE" ]]; then
	for attempt in {1..15}; do
		if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1; then
			export DOCKER_COMPOSE_EXTRA="$GPU_COMPOSE_FILE"
			echo "run.sh: NVIDIA GPU detected (attempt ${attempt}/15). Using compose override: $DOCKER_COMPOSE_EXTRA"
			break
		fi
		sleep 2
	done
fi

if [[ -z "${DOCKER_COMPOSE_EXTRA:-}" ]]; then
	echo "run.sh: GPU compose override not set. Whisper manager will use auto-detection."
fi

# Open browser
xdg-open http://localhost:3002 >/dev/null 2>&1 &

echo "PATH in run.sh before yarn start: $PATH"

# Start Node app — Node now sees Docker
yarn start
