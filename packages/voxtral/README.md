# Voxtral vLLM Service Manager (`packages/voxtral`)

This package manages a local vLLM server that serves the Voxtral-Mini-3B-2507 model. It mirrors the Whisper manager package so you can run Voxtral as an alternative transcription/voice understanding backend.

## What it does

- Starts and health-checks a Docker service named `voxtral` defined in the root `docker-compose.yml`.
- Exposes an OpenAI-compatible API via vLLM at `http://localhost:8010` (by default).
- Keeps running to handle shutdown signals and can stop the container on exit.

## Voxtral model

We serve `mistralai/Voxtral-Mini-3B-2507` via vLLM with the recommended flags:

- `--tokenizer_mode mistral`
- `--config_format mistral`
- `--load_format mistral`

Note: Running on GPU is recommended. The model typically needs ~9.5 GB GPU RAM in bf16/fp16.

## Dev usage

- Build: `yarn build:voxtral`
- Start manager: `yarn start:voxtral`

The manager will bring up the Docker service and wait until it becomes healthy. Health check hits `GET http://localhost:8010/v1/models`.

## Client usage examples

Once running, you can hit the OpenAI-compatible endpoints at `http://localhost:8010/v1` from the API or any client. For transcription, use the OpenAI audio transcription API with `mistral_common[audio]` installed in the client.

## Notes

- The Docker image used is the upstream `vllm/vllm-openai`, configured via compose to serve Voxtral-Mini-3B-2507.
- Model downloads are cached in a named Docker volume to avoid re-downloading.
