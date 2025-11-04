import os
import shutil
import subprocess
import tempfile
import asyncio
from typing import Optional

import httpx
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
import uvicorn
from fastapi.responses import JSONResponse


INTERNAL_HOST = "127.0.0.1"
INTERNAL_PORT = 8001
INTERNAL_BASE = f"http://{INTERNAL_HOST}:{INTERNAL_PORT}/v1"


def build_vllm_args() -> list[str]:
    args = [
        "-m", "vllm.entrypoints.openai.api_server",
        "--host", INTERNAL_HOST,
        "--port", str(INTERNAL_PORT),
        "--model", os.getenv("VOXTRAL_MODEL", "mistralai/Voxtral-Mini-3B-2507"),
        "--dtype", os.getenv("VOXTRAL_DTYPE", "bfloat16"),
        "--tokenizer_mode", os.getenv("VOXTRAL_TOKENIZER_MODE", "mistral"),
        "--config_format", os.getenv("VOXTRAL_CONFIG_FORMAT", "mistral"),
        "--load_format", os.getenv("VOXTRAL_LOAD_FORMAT", "mistral"),
        "--max-model-len", os.getenv("VOXTRAL_MAX_MODEL_LEN", "14384"),
        "--gpu-memory-utilization", os.getenv("VOXTRAL_GPU_MEMORY_UTILIZATION", "0.90"),
    ]
    return ["python3"] + args


def ensure_vllm_started() -> subprocess.Popen:
    proc = subprocess.Popen(build_vllm_args(), stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    return proc


async def wait_until_ready(timeout: float = 600.0) -> None:
    deadline = asyncio.get_event_loop().time() + timeout
    async with httpx.AsyncClient(timeout=5.0) as client:
        while True:
            try:
                r = await client.get(f"{INTERNAL_BASE}/models")
                if r.status_code // 100 == 2:
                    return
            except Exception:
                pass
            if asyncio.get_event_loop().time() > deadline:
                raise TimeoutError("Internal vLLM server did not become ready in time")
            await asyncio.sleep(2.0)


app = FastAPI(title="Voxtral Proxy", version="1.0.0")


@app.on_event("startup")
async def startup_event():
    # Start internal vLLM
    global vllm_proc
    vllm_proc = ensure_vllm_started()
    # Wait for readiness
    try:
        await wait_until_ready()
    except Exception as e:
        # Let health endpoint reflect failure; keep process alive for container logs
        print(f"[Voxtral Proxy] vLLM readiness failed: {e}")


@app.on_event("shutdown")
async def shutdown_event():
    global vllm_proc
    try:
        vllm_proc.terminate()
    except Exception:
        pass


@app.get("/v1/models")
async def get_models():
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            r = await client.get(f"{INTERNAL_BASE}/models")
        except httpx.RequestError as e:
            raise HTTPException(status_code=503, detail=f"Upstream unavailable: {e}")
    return JSONResponse(status_code=r.status_code, content=r.json())


async def ffmpeg_transcode(src_path: str, dst_path: str, *, channels: str, sample_rate: str, bitrate: str, codec: str) -> None:
    # Transcode to a compressed format (e.g., mp3/ogg) so large uploads shrink significantly
    # Common, broadly supported default: libmp3lame
    cmd = [
        "ffmpeg", "-y", "-i", src_path,
        "-ac", channels,
        "-ar", sample_rate,
        "-c:a", codec,
        "-b:a", bitrate,
        dst_path,
    ]
    proc = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg transcode failed: {stderr.decode('utf-8', 'ignore')}")


async def ffmpeg_segment(src_path: str, out_dir: str, *, segment_seconds: int, ext: str) -> list[str]:
    pattern = os.path.join(out_dir, f"chunk_%03d.{ext}")
    cmd = [
        "ffmpeg", "-y", "-i", src_path,
        "-f", "segment",
        "-segment_time", str(segment_seconds),
        "-c", "copy",
        pattern,
    ]
    proc = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg segment failed: {stderr.decode('utf-8', 'ignore')}")
    files = sorted([os.path.join(out_dir, f) for f in os.listdir(out_dir) if f.startswith("chunk_") and f.endswith(f".{ext}")])
    if not files:
        # No segments produced; fall back to original
        return [src_path]
    return files


async def transcribe_chunk(chunk_path: str, model: str, content_type: str, **kwargs) -> str:
    # Proxy to internal OpenAI-compatible endpoint
    form = {
        "model": (None, model),
    }
    # Merge extra kwargs such as language/temperature
    for k, v in kwargs.items():
        if v is not None:
            form[k] = (None, str(v))
    files = {"file": (os.path.basename(chunk_path), open(chunk_path, "rb"), content_type)}
    try:
        async with httpx.AsyncClient(timeout=None) as client:
            r = await client.post(f"{INTERNAL_BASE}/audio/transcriptions", files=files, data=form)
            if r.status_code != 200:
                try:
                    print(f"[Voxtral Proxy] Upstream /audio/transcriptions error {r.status_code}: {r.text[:500]}")
                except Exception:
                    pass
                raise HTTPException(status_code=r.status_code, detail=r.text)
            data = r.json()
            return data.get("text", "")
    finally:
        # Close file handle if needed
        f = files["file"][1]
        try:
            f.close()
        except Exception:
            pass


@app.post("/v1/audio/transcriptions")
async def transcriptions(
    file: UploadFile = File(...),
    model: str = Form(...),
    language: Optional[str] = Form(None),
    temperature: Optional[float] = Form(None),
):
    # Save upload to temp
    tmpdir = tempfile.mkdtemp(prefix="voxtral_")
    orig_path = os.path.join(tmpdir, file.filename)
    try:
        with open(orig_path, "wb") as out:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                out.write(chunk)
        try:
            size_mb = os.path.getsize(orig_path) / (1024 * 1024)
            print(f"[Voxtral Proxy] Received upload: {file.filename} ({size_mb:.2f} MB)")
        except Exception:
            pass
        # Transcode down to manageable bitrate and sample rate using MP3 for broad compatibility
        channels = os.getenv("VOXTRAL_AUDIO_CHANNELS", "1")
        sample_rate = os.getenv("VOXTRAL_AUDIO_SAMPLE_RATE", "16000")
        bitrate = os.getenv("VOXTRAL_AUDIO_BITRATE", "32k")
        codec = os.getenv("VOXTRAL_AUDIO_CODEC", "libmp3lame")
        ext = "mp3" if codec == "libmp3lame" else "ogg"
        content_type = "audio/mpeg" if ext == "mp3" else "audio/ogg"
        trans_path = os.path.join(tmpdir, f"transcoded.{ext}")
        print(f"[Voxtral Proxy] Transcoding to {ext} at {sample_rate}Hz, {channels}ch, {bitrate}...")
        await ffmpeg_transcode(orig_path, trans_path, channels=channels, sample_rate=sample_rate, bitrate=bitrate, codec=codec)
        try:
            size_mb = os.path.getsize(trans_path) / (1024 * 1024)
            print(f"[Voxtral Proxy] Transcoded size: {size_mb:.2f} MB")
        except Exception:
            pass

        # Segment into N-second chunks (copy codec)
        segment_seconds = int(os.getenv("VOXTRAL_CHUNK_SECONDS", "300"))
        print(f"[Voxtral Proxy] Segmenting into ~{segment_seconds}s chunks...")
        chunks = await ffmpeg_segment(trans_path, tmpdir, segment_seconds=segment_seconds, ext=ext)
        print(f"[Voxtral Proxy] Created {len(chunks)} chunk(s)")

        # Transcribe chunks sequentially (simple, robust)
        pieces: list[str] = []
        for idx, c in enumerate(chunks):
            print(f"[Voxtral Proxy] Transcribing chunk {idx+1}/{len(chunks)}: {os.path.basename(c)}")
            text = await transcribe_chunk(c, model, content_type, language=language, temperature=temperature)
            if text:
                pieces.append(text.strip())
            else:
                print(f"[Voxtral Proxy] Empty text for chunk {idx+1}")

        full_text = "\n\n".join(pieces)
        print(f"[Voxtral Proxy] Combined transcript length: {len(full_text)} characters")
        return {"text": full_text}
    except HTTPException:
        raise
    except Exception as e:
        # Print full error for container logs
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Transcription failed: {e}")
    finally:
        try:
            shutil.rmtree(tmpdir)
        except Exception:
            pass


if __name__ == "__main__":
    # Run FastAPI server
    uvicorn.run("app:app", host="0.0.0.0", port=8000, log_level="info")
