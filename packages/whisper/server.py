# packages/whisper/server.py
import os
import sys
import json
import uuid
import asyncio
import subprocess
from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks, Form
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import logging
import time
import re

# Setup logging (keep as is)
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# --- Global state for jobs (keep as is) ---
jobs = {}

# --- Pydantic Models (keep as is) ---
class TranscriptionResult(BaseModel):
    text: str
    segments: list
    language: str

class JobStatus(BaseModel):
    job_id: str
    status: str # queued, processing, completed, failed, canceled
    progress: float = 0.0 # Percentage (0-100)
    duration: float | None = None # Audio duration
    result: TranscriptionResult | None = None
    error: str | None = None
    start_time: float | None = None
    end_time: float | None = None

# --- Helper functions (parse_whisper_time, parse_duration_string) (keep as is) ---
def parse_whisper_time(time_str: str) -> float:
    parts = time_str.split(':')
    if len(parts) == 3: return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
    elif len(parts) == 2: return int(parts[0]) * 60 + float(parts[1])
    else: logger.warning(f"Could not parse timestamp format: {time_str}"); return 0.0

def parse_duration_string(duration_str: str) -> float:
    match = re.search(r'(\d+(\.\d+)?)', duration_str)
    if match:
        try: return float(match.group(1))
        except ValueError: return 0.0
    return 0.0


# --- Transcription Logic Runner ---
async def run_transcription_process(job_id: str, input_path: str, output_path: str, model_name: str):
    global jobs
    process = None # Define process before try block
    try:
        jobs[job_id]["status"] = "processing"
        jobs[job_id]["start_time"] = time.time()

        logger.info(f"Starting transcription process for job {job_id} with model {model_name}")

        cmd = [ "python3", "transcribe.py", input_path, output_path, model_name ]
        process = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
        progress_regex = re.compile(r'^\[(\d{1,2}:\d{2}\.\d{3})\s*-->\s*(\d{1,2}:\d{2}\.\d{3})\]')

        # --- Process monitoring loop (keep complex logic as is) ---
        while True:
            line_bytes = None # Initialize line_bytes
            try: line_bytes = await asyncio.wait_for(process.stdout.readline(), timeout=0.1)
            except asyncio.TimeoutError:
                if process.returncode is not None: break
                try:
                    err_line_bytes = await asyncio.wait_for(process.stderr.readline(), timeout=0.1)
                    if err_line_bytes:
                        err_line = err_line_bytes.decode('utf-8', errors='ignore').strip()
                        logger.warning(f"Job {job_id} STDERR (during stdout wait): {err_line}")
                        try: # Check for JSON errors in stderr
                            err_status = json.loads(err_line)
                            if err_status.get("status") == "error":
                                jobs[job_id].update(status="failed", error=err_status.get("message", "Unknown stderr error"), end_time=time.time())
                                logger.error(f"Job {job_id} failed via stderr JSON: {jobs[job_id]['error']}")
                                if process.returncode is None: process.terminate()
                                await process.wait()
                                return
                        except json.JSONDecodeError: pass # Ignore non-JSON stderr
                except asyncio.TimeoutError: pass
                continue # Continue loop if no output

            if not line_bytes: break
            line = line_bytes.decode('utf-8', errors='ignore').strip()
            # --- JSON/Progress Parsing Logic (keep as is) ---
            try: # Try parsing as JSON
                status_update = json.loads(line)
                status = status_update.get("status")
                if status == "info" and status_update.get("code") == "audio_duration":
                    duration = parse_duration_string(status_update.get("message", ""))
                    if duration > 0: jobs[job_id]["duration"] = duration; logger.info(f"Job {job_id}: Stored audio duration: {duration}s")
                    else: logger.warning(f"Job {job_id}: Could not parse duration from: {status_update.get('message', '')}")
                elif status == "progress": jobs[job_id]["progress"] = status_update.get("progress", jobs[job_id].get("progress", 0))
                elif status == "error":
                    jobs[job_id].update(status="failed", error=status_update.get("message", "Unknown stdout error"), end_time=time.time())
                    logger.error(f"Job {job_id} failed via stdout JSON: {jobs[job_id]['error']}")
                    if process.returncode is None: process.terminate(); await process.wait()
                    return
                elif status == "canceled":
                    jobs[job_id].update(status="canceled", error=status_update.get("message", "Job canceled"), end_time=time.time())
                    logger.info(f"Job {job_id} canceled via stdout JSON")
                    if process.returncode is None: process.terminate(); await process.wait()
                    return
            except json.JSONDecodeError: # Try parsing as Whisper verbose progress
                match = progress_regex.match(line)
                if match:
                    end_time_str = match.group(2)
                    current_timestamp = parse_whisper_time(end_time_str)
                    total_duration = jobs[job_id].get("duration")
                    if total_duration and total_duration > 0:
                        progress = min((current_timestamp / total_duration) * 100, 100.0)
                        if progress > jobs[job_id]["progress"]: jobs[job_id]["progress"] = round(progress, 2)

        # --- Process finished handling (keep as is) ---
        stdout, stderr = await process.communicate()
        stderr_str = stderr.decode('utf-8', errors='ignore').strip() if stderr else ""
        if stderr_str: logger.warning(f"Job {job_id} Final STDERR: {stderr_str}")
        current_status = jobs[job_id]["status"]
        if process.returncode == 0 and current_status == "processing":
            logger.info(f"Transcription process for job {job_id} completed successfully (RC 0).")
            if os.path.exists(output_path):
                try: # Added try block for reading result file
                    with open(output_path, 'r') as f: result_data = json.load(f)
                    jobs[job_id].update(status="completed", result=result_data, progress=100.0)
                except Exception as e:
                    logger.exception(f"Job {job_id}: Error reading result file {output_path}: {e}")
                    jobs[job_id].update(status="failed", error=f"Failed to read result file: {e}")
            else:
                logger.error(f"Job {job_id} process OK but output file missing: {output_path}")
                jobs[job_id].update(status="failed", error="Process completed but output file missing.")
        elif current_status not in ["failed", "canceled"]:
            logger.error(f"Transcription process for job {job_id} failed. RC: {process.returncode}")
            jobs[job_id]["status"] = "failed"
            if not jobs[job_id].get("error"): jobs[job_id]["error"] = stderr_str or f"Process exited with code {process.returncode}"

    except asyncio.CancelledError:
        logger.warning(f"Transcription task for job {job_id} was cancelled by server.")
        jobs[job_id].update(status="canceled", error="Processing canceled by server.")
        # --- Process termination logic (keep as is) ---
        if process and process.returncode is None:
            try: logger.info(f"Terminating process {job_id}..."); process.terminate(); await asyncio.wait_for(process.wait(), timeout=5.0)
            except asyncio.TimeoutError: logger.warning(f"Process {job_id} kill."); process.kill()
            except ProcessLookupError: logger.warning(f"Process {job_id} already exited.")
            except Exception as e: logger.error(f"Error terminating process {job_id}: {e}")
    except Exception as e:
        logger.exception(f"Unexpected error in transcription task {job_id}: {e}")
        jobs[job_id]["status"] = "failed"
        if not jobs[job_id].get("error"): jobs[job_id]["error"] = f"Unexpected server error: {str(e)}"
    finally:
        if jobs[job_id].get("end_time") is None: jobs[job_id]["end_time"] = time.time()
        logger.info(f"Job {job_id} finished. Status: {jobs[job_id]['status']}. Duration: {jobs[job_id]['end_time'] - jobs[job_id]['start_time'] if jobs[job_id].get('start_time') else 'N/A'}s")

        # --- File cleanup logic with CORRECTED SYNTAX ---
        if os.path.exists(input_path):
            try:
                os.remove(input_path)
                logger.info(f"Removed input: {input_path}")
            except Exception as e:
                logger.error(f"Err removing input {input_path}: {e}")

        if os.path.exists(output_path):
             # Keep output file if job failed for debugging? For now, remove always.
            try:
                os.remove(output_path)
                logger.info(f"Removed output: {output_path}")
            except Exception as e:
                logger.error(f"Err removing output {output_path}: {e}")
        # --- END CORRECTION ---


# --- FastAPI App ---
app = FastAPI(title="Whisper Transcription Service")
TEMP_INPUT_DIR = "/app/temp_inputs"; TEMP_OUTPUT_DIR = "/app/temp_outputs"
os.makedirs(TEMP_INPUT_DIR, exist_ok=True); os.makedirs(TEMP_OUTPUT_DIR, exist_ok=True)

@app.post("/transcribe", status_code=202)
async def transcribe_endpoint(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    model_name: str = Form("tiny") # Default to 'tiny' if not provided
):
    job_id = str(uuid.uuid4())
    file_extension = os.path.splitext(file.filename)[1] if file.filename else ".tmp"
    input_path = os.path.join(TEMP_INPUT_DIR, f"{job_id}{file_extension}")
    output_path = os.path.join(TEMP_OUTPUT_DIR, f"{job_id}.json")

    try:
        with open(input_path, "wb") as buffer: buffer.write(await file.read())
        logger.info(f"Saved uploaded file to: {input_path}")
    except Exception as e:
        logger.exception(f"Failed to save uploaded file {file.filename}: {e}")
        raise HTTPException(status_code=500, detail=f"Could not save uploaded file: {e}")

    # Initialize job status (keep as is)
    jobs[job_id] = { "job_id": job_id, "status": "queued", "progress": 0.0, "duration": None, "result": None, "error": None, "start_time": None, "end_time": None }

    background_tasks.add_task(run_transcription_process, job_id, input_path, output_path, model_name)
    logger.info(f"Queued job {job_id} for file {file.filename} with model '{model_name}'") # Log model

    return {"job_id": job_id, "message": "Transcription job started."}

# --- Status Endpoint (keep as is) ---
@app.get("/status/{job_id}", response_model=JobStatus)
async def get_status_endpoint(job_id: str):
    job = jobs.get(job_id)
    if not job: raise HTTPException(status_code=404, detail="Job ID not found")
    return job

# --- Cancel Endpoint (keep as is) ---
@app.post("/cancel/{job_id}", status_code=200)
async def cancel_job_endpoint(job_id: str):
    job = jobs.get(job_id); message = ""
    if not job: raise HTTPException(status_code=404, detail="Job ID not found")
    current_status = job.get("status")
    if current_status == "processing" or current_status == "queued":
        if current_status == "processing": logger.warning(f"Cancel req for {job_id}."); job["status"] = "canceling"; message = "Cancel req received."
        else: job.update(status="canceled", error="Canceled before start.", end_time=time.time()); logger.info(f"Canceled queued {job_id}."); message = "Job canceled before start."
        return {"job_id": job_id, "message": message}
    elif current_status in ["completed", "failed", "canceled", "canceling"]: return {"job_id": job_id, "message": f"Job state: {current_status}"}
    else: logger.error(f"Unexpected state for {job_id}: {current_status}"); raise HTTPException(status_code=500, detail=f"Unexpected state: {current_status}")

# --- Root and Health Endpoints (keep as is) ---
@app.get("/")
def read_root(): return {"message": "Whisper Transcription Service running."}
@app.get("/health")
def health_check():
    if not os.path.exists(TEMP_INPUT_DIR) or not os.path.exists(TEMP_OUTPUT_DIR): logger.error("Health Check Failed: Temp dirs missing."); raise HTTPException(status_code=503, detail="Service Unavailable: Missing temp dirs.")
    return {"status": "healthy"}

# --- Main block (keep as is) ---
if __name__ == "__main__": import uvicorn; uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)
