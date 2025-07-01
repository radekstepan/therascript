
### /package.json
```json
{
  "name": "@therascript/vllm",
  "version": "1.0.0",
  "description": "TypeScript host client for managing and interacting with a vLLM OpenAI-compatible Docker container",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "node dist/chatManager.js",
    "lint": "eslint . --ext .ts",
    "docker:up": "docker compose up -d vllm",
    "docker:down": "docker compose down",
    "docker:logs": "docker compose logs -f vllm",
    "clean": "rm -rf dist *.tsbuildinfo"
  },
  "keywords": [
    "vllm",
    "typescript",
    "nodejs",
    "llm",
    "docker",
    "openai"
  ],
  "author": "",
  "license": "ISC",
  "dependencies": {
    "@therascript/docker-utils": "*",
    "dockerode": "^4.0.2",
    "openai": "^4.47.1"
  },
  "devDependencies": {
    "@types/dockerode": "^3.3.29",
    "@types/node": "^20.12.12",
    "ts-node": "^10.9.2",
    "typescript": "^5.4.5"
  }
}
