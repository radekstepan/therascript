#!/usr/bin/env bash
set -e

# Load NVM manually
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"

# Ensure system binaries are visible first
export PATH="/usr/bin:/usr/local/bin:/bin:/usr/sbin:/sbin:$NVM_DIR/versions/node/$(nvm version)/bin:$PATH"

# Derive the script's own directory so this works from any checkout location
# and from symlinks (handles ./run.sh, bash /path/run.sh, etc.).
SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]:-$0}")")" && pwd)"
cd "$SCRIPT_DIR"

nvm use

# Prefer GPU Whisper mode on Linux if NVIDIA becomes available shortly after login.
# This avoids transient boot races where a single early probe falls back to CPU.
GPU_COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.gpu.yml"
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

# --- Open browser on a Tailscale URL when available ---
APP_URL="http://localhost:3002"
if command -v tailscale >/dev/null 2>&1; then
	# Accept either the older "MagicDNSName" or the current "DNSName" field,
	# allow optional whitespace after the colon, and strip the trailing dot
	# that DNSName carries.
	TS_HOSTNAME=$(tailscale status --json 2>/dev/null \
		| grep -oE '"(MagicDNSName|DNSName)":\s*"[^"]*"' | head -1 \
		| grep -oE '"[^"]*"$' | tr -d '"' | sed 's/\.$//')
	if [ -n "$TS_HOSTNAME" ]; then
		APP_URL="http://${TS_HOSTNAME}:3002"
	fi
fi
echo "run.sh: Access URL: ${APP_URL}"
if [ -n "${DISPLAY:-}" ] || [ -n "${WAYLAND_DISPLAY:-}" ]; then
	xdg-open "$APP_URL" >/dev/null 2>&1 &
fi

echo "run.sh: Starting Therascript from ${SCRIPT_DIR}"
echo "PATH in run.sh before yarn start: $PATH"

# Start Node app — Node now sees Docker
yarn start
