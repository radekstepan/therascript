# @therascript/ollama — Developer Notes

Purpose: Manage and interact with the Ollama Docker service; provide a simple chat client and model pull utilities.

## Key files
- Client: `src/ollamaClient.ts` (POST `/api/chat`, list `/api/tags`)
- Docker manager: `src/dockerManager.ts` (ensure running, stop, pull stream)
- In-memory chat utility: `src/chatManager.ts`
- Compose file: `docker-compose.yml` (service `ollama`)

## Build/Run
- Build: `yarn build`
- Start: `yarn start` (runs `dist/index.js`)
- Dev: `yarn start:dev` (ts-node)
- Docker helpers: `yarn docker:up`, `yarn docker:down`, `yarn docker:logs`

## Environment
- `OLLAMA_BASE_URL` (default http://localhost:11434) used by client

## Gotchas
- Model pulls use `docker compose exec` into the container; the compose file path is resolved at runtime; ensure Docker daemon is available
- Health check is HTTP to `http://localhost:11434`