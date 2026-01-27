This plan outlines how to migrate from `openai-whisper` to `faster-whisper` (based on CTranslate2). This library is significantly faster and more memory-efficient on NVIDIA GPUs while providing a robust CPU fallback for macOS users running via Docker.

### Advantages
1.  **Speed:** Up to 4x faster on NVIDIA GPUs compared to standard PyTorch Whisper.
2.  **Memory:** Reduced VRAM usage via quantization (int8/float16).
3.  **Simpler Build:** Eliminates the complex PyTorch nightly wheel logic currently in `scripts/run-dev.js` and the Dockerfile.

---

## Phase 1: Dependency Updates

We will replace the heavy PyTorch dependencies with the lighter `faster-whisper` library.

### 1. Update `packages/whisper/requirements.txt`
Remove `openai-whisper` and the PyTorch/NVIDIA specific index references.

```text
# --- Core Dependencies ---
faster-whisper
fastapi
uvicorn[standard]
pydantic
python-multipart
httpx
# nvidia-ml-py is lightweight and allows VRAM monitoring without full PyTorch
nvidia-ml-py
```

### 2. Update `packages/whisper/Dockerfile`
Simplify the build process. We no longer need to manually `pip install torch` with specific index URLs, as `faster-whisper` pulls what it needs.

```dockerfile
FROM python:3.10-slim

WORKDIR /app

# Install system dependencies (ffmpeg is still required)
RUN apt-get update && apt-get install -y \
    curl \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY packages/whisper/requirements.txt ./
RUN pip3 install --no-cache-dir -r requirements.txt

# Install Node.js (for the Express wrapper)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs

# Copy Node dependencies
COPY packages/whisper/package.json ./
COPY yarn.lock ./
RUN yarn install --production --frozen-lockfile

# Copy source code
COPY packages/whisper/. .

# Setup Directories
RUN mkdir -p /app/temp_inputs /app/temp_outputs

# Setup Supervisor
COPY packages/whisper/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

EXPOSE 8000 8001

CMD ["/usr/local/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
```

---

## Phase 2: Refactoring Python Services

We need to adapt the code to the `faster-whisper` API, which uses `model.transcribe()` as a generator and has different parameter names.

### 1. Modify `packages/whisper/transcribe.py`

```python
import os
import sys
import json
import time
from faster_whisper import WhisperModel

def transcribe_audio(file_path, output_file, model_name):
    # Detect Hardware
    # faster-whisper handles CUDA/CPU automatically, but we can be explicit
    import torch
    device = "cuda" if torch.cuda.is_available() else "cpu"
    
    # On CPU (Mac Docker), int8 is faster. On GPU, float16 is standard.
    compute_type = "float16" if device == "cuda" else "int8"

    print(json.dumps({"status": "model_loading", "message": f"Loading {model_name} on {device} ({compute_type})..."}), flush=True)
    
    try:
        # Load Model
        model = WhisperModel(model_name, device=device, compute_type=compute_type)
        print(json.dumps({"status": "loading_complete", "message": "Model loaded."}), flush=True)

        print(json.dumps({"status": "transcribing", "message": "Processing audio..."}), flush=True)
        
        # Transcribe
        # faster-whisper returns a generator. We must iterate to process.
        segments, info = model.transcribe(file_path, beam_size=5)
        
        segment_list = []
        for segment in segments:
            segment_list.append({
                "id": segment.id,
                "start": segment.start,
                "end": segment.end,
                "text": segment.text.strip(),
                # faster-whisper doesn't give tokens by default in the same list format, 
                # but for this app's UI, we mostly need start/end/text.
            })

        # Construct Final Result matching Domain Types
        result = {
            "text": "".join([s["text"] for s in segment_list]),
            "segments": segment_list,
            "language": info.language
        }

        with open(output_file, "w") as f:
            json.dump(result, f, indent=4)
            
        print(json.dumps({
            "status": "completed", 
            "message": "Done",
            "result_summary": { "language": info.language }
        }), flush=True)

    except Exception as e:
        print(json.dumps({ "status": "error", "message": str(e)}), file=sys.stderr, flush=True)
        sys.exit(1)

# ... (CLI entry point remains the same)
```

### 2. Modify `packages/whisper/whisper_api.py`

This file manages the persistent model in the FastAPI service.

```python
from faster_whisper import WhisperModel
import pynvml # Replaces torch for VRAM checking

# ... (Imports and basic setup)

class WhisperModelManager:
    def __init__(self):
        self._model = None
        self._model_name = None
        # ...
    
    async def acquire_model(self, model_name: str):
        async with self._lock:
            if self._model is None or self._model_name != model_name:
                # Logic to unload if different model requested
                
                # Determine config
                device = "cuda" if torch.cuda.is_available() else "cpu"
                compute_type = "float16" if device == "cuda" else "int8"
                
                self._model = WhisperModel(model_name, device=device, compute_type=compute_type)
                self._model_name = model_name
            return self._model

    async def _unload_unsafe(self) -> bool:
        # faster-whisper/CTranslate2 models are harder to explicitly unload from GPU VRAM 
        # than PyTorch models. Usually deleting the object and calling GC works.
        import gc
        del self._model
        self._model = None
        gc.collect()
        return True

    def get_status(self) -> ModelStatus:
        # Use pynvml (NVIDIA Management Library) for VRAM if available
        vram_mb = 0
        try:
            pynvml.nvmlInit()
            handle = pynvml.nvmlDeviceGetHandleByIndex(0)
            info = pynvml.nvmlDeviceGetMemoryInfo(handle)
            vram_mb = info.used / (1024 * 1024)
            pynvml.nvmlShutdown()
        except:
            pass # Not NVIDIA or not available
            
        return ModelStatus(
            loaded=self.is_loaded,
            model_name=self._model_name,
            device="cuda" if vram_mb > 0 else "cpu",
            vram_allocated_mb=vram_mb,
            # ...
        )

# ... (Rest of API logic)
```

---

## Phase 3: Cleanup & Configuration

Since we no longer need the complex PyTorch installation logic (which downloaded 2GB+ binaries depending on OS), we can clean up the root scripts.

### 1. Update `scripts/run-dev.js`
Remove the logic that sets `WHISPER_TORCH_INDEX_URL` and `WHISPER_TORCH_FLAGS`.

**Change this:**
```javascript
// REMOVE or COMMENT OUT this section
if (isMacOS) {
  process.env.WHISPER_TORCH_INDEX_URL = 'https://download.pytorch.org/whl/cpu';
  process.env.WHISPER_TORCH_FLAGS = '';
  // ...
} else if (isLinux || isWsl) {
  // ...
}
```

**To this:**
```javascript
// faster-whisper handles dependencies automatically.
// We still keep the docker-compose override logic for Mac to remove GPU device reservation.
if (isMacOS) {
  const path = require('node:path');
  const repoRoot = path.resolve(__dirname, '..');
  const noGpuCompose = path.join(repoRoot, 'docker-compose.no-gpu.yml');
  if (require('fs').existsSync(noGpuCompose)) {
    process.env.DOCKER_COMPOSE_EXTRA = noGpuCompose;
  }
}
```

### 2. Update `docker-compose.yml`
Remove the build args that passed the PyTorch URL.

```yaml
  whisper:
    build:
      context: .
      dockerfile: packages/whisper/Dockerfile
      # Remove 'args' section
    # ... rest remains same
```

---

## Summary of Impact

1.  **Mac Users:** Docker build will be significantly faster (no downloading 2GB PyTorch CPU wheels). The container will run using `int8` quantization on CPU, which is efficient.
2.  **Linux/NVIDIA Users:** Docker build is faster. Transcription speed will improve due to CTranslate2 optimizations.
3.  **Compatibility:** No changes required to the `api` or `ui` packages; the input (files) and output (JSON structure) remain identical, handled by the internal mapping in `transcribe.py`.

## Execution Steps

1.  Modify `packages/whisper/requirements.txt`
2.  Modify `packages/whisper/Dockerfile`
3.  Rewrite `packages/whisper/transcribe.py`
4.  Refactor `packages/whisper/whisper_api.py`
5.  Clean `scripts/run-dev.js` and `docker-compose.yml`
6.  Run `yarn dev` to rebuild containers.
