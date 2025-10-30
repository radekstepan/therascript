# @therascript/docker-utils — Developer Notes

Purpose: Shared helpers to start/stop services via Docker Compose and check health using Dockerode + HTTP polling.

## Key file
- `src/index.ts` (ensureServiceReady, stopContainer)

## Behavior
- Validates compose file path; runs `docker compose` commands; uses Dockerode to inspect containers; HTTP health checks via axios.

## Gotchas
- Requires Docker daemon access; non-2xx health responses are treated as unhealthy.