---
'@therascript/whisper': patch
---

Fix recurring transcription CUDA OOMs by making model residency truly sequential: drop the local Parakeet reference before unloading it, evict a warm diarizer before the next ASR stage, lower the default `PARAKEET_CHUNK_SEC` to 300s (attention memory is quadratic), and enable `expandable_segments` for the CUDA allocator.
