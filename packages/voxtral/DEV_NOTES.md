# Voxtral Proxy – 500 Error Capture and Next Steps

Date: 2025-10-30
Container: `therascript_voxtral_service`

## Excerpt from recent container logs

```
[Voxtral Proxy] Received upload: 8-1761876733375.mp3 (47.84 MB)
[Voxtral Proxy] Transcoding to mp3 at 16000Hz, 1ch, 32k...
[Voxtral Proxy] Transcoded size: 7.99 MB
[Voxtral Proxy] Segmenting into ~300s chunks...
[Voxtral Proxy] Created 7 chunk(s)
[Voxtral Proxy] Transcribing chunk 1/7: chunk_000.mp3
[Voxtral Proxy] Upstream /audio/transcriptions error 500: {"error":{"message":"Please install vllm[audio] for audio support","type":"Internal Server Error","param":null,"code":500}}
```

## Interpretation

The internal vLLM OpenAI server is running, but its audio transcription endpoint is not enabled. It requires the audio extra:

- Missing dependency: `vllm[audio]`
- Effect: All calls to `/v1/audio/transcriptions` return 500 with the above message.

## TODO (do not execute yet)

- Option A: Enable audio support inside the Voxtral image
  - Install `vllm[audio]` in the custom Dockerfile used by `packages/voxtral`.
  - Validate that the base image `vllm/vllm-openai:latest` includes compatible CUDA/torch deps for the audio extra.
  - Rebuild and verify that `/v1/audio/transcriptions` works on a small test clip.

- Option B: Switch to text generation path for transcription
  - If audio endpoint isn’t desirable, implement a fallback that feeds chunked audio via a speech-to-text model (Whisper) or use Mistral audio messages if supported.
  - For now, our intent is to keep Voxtral doing the transcription; this is secondary.

- Option C: Use Whisper backend for large uploads
  - Until audio is enabled in vLLM, route large transcriptions to Whisper.

- After enabling audio in vLLM:
  - Keep chunk duration at 300s (configurable with `VOXTRAL_CHUNK_SECONDS`).
  - Consider small parallelism (2–3 concurrent chunks) once stable.
  - Add a small integration test (short WAV/MP3) to validate end-to-end in CI (optional for now).

## Notes

- Current proxy handles:
  - Transcode to MP3 (mono, 16kHz, 32kbps)
  - Segment by time
  - Sequential chunk transcription and stitch
- Healthcheck remains `/v1/models` via the proxy.
