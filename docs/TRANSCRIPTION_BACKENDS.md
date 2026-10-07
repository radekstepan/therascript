# Transcription Stack (Parakeet + Community-1)

Single supported stack. The legacy WhisperX + pyannote 3.1 path was removed;
if you are upgrading from it, follow **README → "Upgrading from WhisperX"**
first.

## Pipeline

```
audio → Parakeet TDT 0.6B v2 (NeMo, native word timestamps, no alignment)
      → pyannote speaker-diarization-community-1 (exclusive segments)
      → attribution (overlap argmax + tie-breaks, gap flagging)
      → segments [{start, end, text, speaker}]
```

- **ASR:** `nvidia/parakeet-tdt-0.6b-v2` (English-only). Native word/segment
  timestamps with punctuation and capitalization, so there is no forced
  alignment stage. Long audio is chunked at `PARAKEET_CHUNK_SEC` (default
  600s) with `PARAKEET_CHUNK_OVERLAP_SEC` (default 10s) overlap; words in the
  overlap are deduplicated by midpoint region and timestamps are
  offset-merged. A cancel flag is polled at chunk boundaries. Per-chunk
  progress (`completed/total`, with a `(0, total)` report on entry) drives
  the transcribing-stage bar wherever chunks exist; model loads report as
  an explicit "Loading model" stage (1–8%) and the remaining blind windows
  (single-chunk audio, diarization) use time interpolation with
  device-calibrated budgets (CPU figures measured live: ASR ~0.7× audio
  duration, diarization ~1.8×). The displayed value is
  `max(interpolated, real)` pinned to a never-decreasing peak, so the bar
  can neither freeze at a misleading value nor dip backwards.
- **Diarization:** `pyannote/speaker-diarization-community-1` (CC-BY-4.0,
  soft-gated: accept conditions on Hugging Face + READ token for first
  download). Words are attributed against the **exclusive** stream (one
  speaker per frame); the overlapping stream is kept in
  `CommunityDiarizer.last_full_annotation` for analytics only.
- **Attribution:** `packages/whisper/pipeline/attribution.py`. Overlap-duration
  argmax per word (linear two-pointer walk over the sorted lists),
  midpoint tie-breaks with float tolerance, nearest-speaker assignment with
  `low_confidence` flag for gaps/edges, `overlap_speaker` preserved.
  Segments split on speaker change, gaps, sentence-ending punctuation, and a
  `max_words` cap (default 60) so monologues stay sentence-sized.

Wire format is unchanged: `GET /status/{id}` returns
`result.segments: [{start, end, text, speaker}]`, so worker/UI/SQLite/ES need
no changes. `model_name` is still accepted on `/transcribe` but ignored.

## Speaker count

The UI dropdown (`UploadModal.tsx`: Off/2/3/4/5) is passed through unchanged:
`num_speakers >= 2` enables diarization and is forwarded as
`num_speakers=N` to the diarizer. Nothing hard-codes 2.

## Configuration

Env (whisper service; see `.env.example`, `docker-compose.yml`):

```
PARAKEET_MODEL_ID=nvidia/parakeet-tdt-0.6b-v2
PARAKEET_CHUNK_SEC=600
PARAKEET_CHUNK_OVERLAP_SEC=10
HF_TOKEN=hf_...   # needs Community-1 access (see README setup)
```

## Dependencies / containers

- `packages/whisper/requirements.txt`: `pyannote.audio>=4,<5` (needs
  Python ≥3.10, torch/torchaudio/torchcodec 2.8+), `nemo_toolkit[asr]` +
  `soundfile`.
- `Dockerfile` (CPU): Python 3.11-slim, torch 2.8 CPU. Parakeet works on CPU
  but is slow — GPU image recommended. torchcodec 0.7.0 has no
  linux/aarch64 wheel, so on Apple Silicon build for `linux/amd64`
  (`platform:` in `docker-compose.yml`). Torch builds are guarded by
  `constraints-cpu.txt` / `constraints-cu126.txt` (`pip -c`) so
  `nemo_toolkit` / `pyannote.audio` can never swap in a generic wheel.
- `Dockerfile.gpu`: CUDA 12.6 runtime, torch 2.8 cu126.
- Code: `packages/whisper/pipeline/` (`schema.py`, `attribution.py`,
  `backends.py` with `ASRBackend`/`Diarizer` ABCs — a future
  Nemotron/Sortformer diarizer only implements `Diarizer.diarize()`
  returning exclusive-style segments).

## CPU vs GPU — how it works, what to configure

**Nothing to configure in the app.** Every job picks its device automatically:

```python
device = "cuda" if torch.cuda.is_available() else "cpu"
```

(`whisper_api.py`, passed to both the Parakeet and Community-1 singletons;
no env flag, no UI toggle.) The *effective* choice is made one level down,
by **which image you build and how you start it**:

| Setup | Result |
|---|---|
| `docker compose up -d --build` (CPU image: torch CPU wheels) | CUDA is never visible → always CPU |
| `docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build` (GPU image: CUDA 12.6, torch cu126 + GPU device reservation) | CUDA visible → GPU |
| `yarn dev` | Picks the compose files for you (GPU override on Linux+NVIDIA) |

Startup logs state the outcome explicitly
(`CUDA available — GPU: ...` vs `CUDA not available — running on CPU`),
and each job logs `using device=...`.

**Expectations:**

| | GPU (e.g. RTX 3060 12GB) | CPU |
|---|---|---|
| Speed | Minutes per hour of audio | Functional but slow — roughly an order of magnitude slower; fine for short clips, patience required for hour-long sessions |
| Precision | NeMo defaults (fp32) | Same fp32 code path (no int8 quantization — that was the old faster-whisper stack) |
| VRAM | ~4–5.5GB peak (see below) | n/a (system RAM; models are ~2.5GB Parakeet + ~1GB diarizer on disk/in RAM) |

**VRAM budget (fp32, as shipped):**

| Component | VRAM |
|---|---|
| Parakeet TDT 0.6B v2 weights | ~2.4–2.5 GB |
| Parakeet activations (10-min chunks) | ~0.5–1 GB transient |
| Community-1 (segmentation + embedding + clustering) | ~0.5–1 GB |
| CUDA context / fragmentation | ~0.5–1 GB |
| **Total peak** | **~4–5.5 GB** |

A 12GB card (e.g. RTX 3060) holds this with ~6GB to spare. (FP16 would cut
Parakeet weights to ~1.3GB, but the stock image runs NeMo fp32 defaults —
deliberately, for maximum accuracy — and 12GB doesn't need the saving.)

The real 12GB collision risk is the **LLM**, not transcription: an 8B chat
model can hold 6–9GB, which *plus* transcription would OOM. That's why the
service unloads the LLM (`ensure_llm_unloaded`) before every transcription
job — peaks are sequential, never summed. Don't run chat/analysis inference
concurrently with a transcription.

**How to verify which device is active:**

- `GET /model/status` → `device` field reports the device selected by jobs
  (`cuda`/`cpu`), plus `vram_allocated_mb`.
- `nvidia-smi` on the host during a job shows the Python process and VRAM.
- Container logs: `using device=cuda` per job.

## Performance / memory notes

- ASR + diarizer load once per process (singletons), not per request.
  `POST /model/unload` frees them (restart also works).

## Evaluation

Standalone tool (stdlib only, no model downloads, CI-safe):

```
# score two hypotheses against a reference
python3 packages/whisper/eval/compare_backends.py \
  --ref ref.json --hyp-a baseline.json --hyp-b candidate.json

# end-to-end: transcribe audio with the running service, then score it
python3 packages/whisper/eval/compare_backends.py \
  --ref ref.json --audio session.wav --api http://localhost:8000 --num-speakers 2
```

Metrics: **WER** (transcription), **DER** (approx. frame-based, 0.25s collar;
use `pyannote.metrics` on RTTM for formal scoring), **cpWER** (concatenated
minimum-permutation WER — penalizes speaker-attribution errors even when
plain WER is 0).

`ref.json`: `[{start, end, speaker, text}]`. Hypothesis files use the service
`result` shape (`{segments: [...]}`).

## Tests

- `packages/whisper/pipeline/test_attribution.py` — 16 model-independent
  cases. No downloads: `python3 packages/whisper/pipeline/test_attribution.py`
  (also collected by pytest).
- `packages/whisper/pipeline/test_backends_chunking.py` — 4 model-independent
  cases for overlapped long-audio chunking (exact-once coverage, trailing
  chunk, cancellation). No downloads:
  `python3 packages/whisper/pipeline/test_backends_chunking.py`.
- Existing `transcriptionProcessor.test.ts` (vitest) covers paragraph
  grouping and worker failure contracts.
- Opt-in real-model check: run the eval script end-to-end against a local
  GPU service (manual, never in CI).

## Security / privacy

Local/self-hosted inference only. Hugging Face is used solely to download
model weights. Audio never leaves the host.

## Nemotron / Sortformer verdict (investigated, not implemented)

`nvidia/Nemotron-3-Diarization` is locally usable with chunked inference,
but published gains concentrate at ≥3 speakers and far-field meetings while
clean 2-speaker results are roughly parity — matching this app's common case
(usually 2 speakers). Staying on Community-1; the `Diarizer` ABC keeps
Nemotron pluggable for a later benchmark without pipeline rewrites.
