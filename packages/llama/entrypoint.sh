#!/bin/sh
set -e

PORT="${LMS_PORT:-1234}"

echo "[llmster] Starting LM Studio headless daemon (llmster)..."
lms daemon up

echo "[llmster] Starting LM Studio server on port ${PORT}..."
lms server start --port "$PORT"

echo "[llmster] Service ready on port ${PORT}."

# Keep the container alive; the daemon runs as a background process
exec sleep infinity
