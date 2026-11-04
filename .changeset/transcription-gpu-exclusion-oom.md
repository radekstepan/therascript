---
'@therascript/api': patch
'@therascript/worker': patch
'@therascript/whisper': patch
---

Fix CUDA OOM on hour-long transcriptions (e.g. RTX 3060 12GB) by enforcing the "at most one service" GPU invariant and cutting the transcription footprint. Transcription start now refuses (409) while analysis/verification jobs run, evicts the local LLM, and verifies zero loaded instances before submitting; local LLM loads refuse (409) while transcription is queued/running (remote and CPU-only targets exempt). Parakeet runs fp16 on CUDA, ASR unloads before diarization so peaks are sequential, diarization is windowed with overlap label alignment, the Linux `host.docker.internal` unload callback is fixed via compose `extra_hosts`, and OOM errors carry an actionable hint.
