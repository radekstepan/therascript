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

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Global state for jobs
jobs = {}

# --- Pydantic Models ---
class TranscriptionResult(BaseModel):
    text: str
    segments: list
    language: str

class JobStatus(BaseModel):
    job_id: str
    status: str # queued, model_loading, model_downloading, processing, transcribing, completed, failed, canceled
    progress: float = 0.0 # Percentage (0-100)
    duration: float | None = None # Audio duration
    result: TranscriptionResult | None = None
    error: str | None = None
    start_time: float | None = None
    end_time: float | None = None
    message: str | None = None # Added for more detailed status text

# --- Helper functions ---
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

# --- NEW: Robust Stream Reader ---
async def read_stream_lines(stream, job_id: str, stream_name: str, progress_regex, current_job_status_ref):
    """Helper to read and process lines/chunks from a stream more robustly."""
    partial_line_buffer = ""
    CHUNK_SIZE = 4096  # Read in chunks to avoid overly large single reads blocking

    while True:
        # Check if the job has been marked for cancellation or is in a terminal state
        if job_id not in jobs or jobs[job_id].get("status") in ["canceling", "canceled", "failed", "completed"]:
            logger.info(f"Job {job_id} {stream_name} read loop: Job is terminal or canceled. Stopping read.")
            break
        
        try:
            chunk = await asyncio.wait_for(stream.read(CHUNK_SIZE), timeout=0.2) # Short timeout
        except asyncio.TimeoutError:
            # If process hasn't exited, timeout is fine, continue trying to read
            if process and process.returncode is None and jobs[job_id].get("status") not in ["canceling", "canceled", "failed", "completed"]:
                await asyncio.sleep(0.05) # Small sleep before retrying read
                continue
            else: # Process likely exited or job is terminal
                logger.info(f"Job {job_id} {stream_name} read loop: Timeout and process/job is terminal. Exiting read.")
                break
        except Exception as e:
            logger.error(f"Job {job_id}: Unhandled exception reading {stream_name}: {e}")
            current_job_status_ref.update(status="failed", error=f"Error reading script {stream_name}: {e}", message=f"Server error reading {stream_name}.")
            return # Stop reading this stream

        if not chunk:  # EOF
            logger.info(f"Job {job_id} {stream_name}: EOF reached.")
            if partial_line_buffer.strip():
                yield partial_line_buffer.strip() # Process any remaining data
            break
        
        # Decode chunk and prepend any previous partial line buffer
        decoded_chunk = chunk.decode('utf-8', errors='ignore')
        # It's possible a multi-byte char is split across chunks. 
        # Python's decode with errors='ignore' should handle this, but it's a source of potential issues.
        # For Whisper's typical output (JSON lines or verbose progress), this should be mostly fine.
        
        text_data = partial_line_buffer + decoded_chunk
        
        lines = text_data.splitlines(keepends=False) # splitlines handles \r\n and \n

        if not text_data.endswith('\n') and not text_data.endswith('\r'):
            # Last part is a partial line if no newline at the end of current text_data
            if lines: # Only pop if there are lines (means at least one newline was found)
                partial_line_buffer = lines.pop()
            else: # No newlines in the whole chunk, so append to buffer
                partial_line_buffer = text_data
        else:
            partial_line_buffer = "" # All lines were complete

        for line_content in lines:
            stripped_line = line_content.strip()
            if stripped_line:
                yield stripped_line # Yield complete, stripped lines


# --- Transcription Logic Runner ---
async def run_transcription_process(job_id: str, input_path: str, output_path: str, model_name: str):
    global jobs
    process = None 
    # Use a dictionary to pass around the current job status by reference for easier updates in helpers
    current_job_status_ref = jobs[job_id] 
    current_job_status_ref.update(status="model_loading", message=f"Initializing model '{model_name}'...", start_time=time.time())
    logger.info(f"Job {job_id}: Initial status set to 'model_loading'. Input: {input_path}, Output: {output_path}")

    try:
        cmd = ["python3", "-u", "transcribe.py", input_path, output_path, model_name] # Added -u for unbuffered Python output
        process = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
        logger.info(f"Job {job_id}: Subprocess '{' '.join(cmd)}' started (PID: {process.pid}).")
        
        progress_regex = re.compile(r'^\[(\d{1,2}:\d{2}\.\d{3})\s*-->\s*(\d{1,2}:\d{2}\.\d{3})\]')

        async def process_stdout_stream():
            nonlocal current_job_status_ref
            if process and process.stdout:
                async for line in read_stream_lines(process.stdout, job_id, "STDOUT", progress_regex, current_job_status_ref):
                    logger.debug(f"Job {job_id} STDOUT: {line}")
                    try:
                        status_update = json.loads(line)
                        new_status = status_update.get("status")
                        msg = status_update.get("message", current_job_status_ref.get("message"))
                        
                        if new_status == "info" and status_update.get("code") == "audio_duration":
                            duration = parse_duration_string(status_update.get("message", ""))
                            if duration > 0: current_job_status_ref["duration"] = duration
                        elif new_status == "info" and status_update.get("code") == "model_download_progress":
                             current_job_status_ref.update(status="model_downloading", message=msg or "Downloading model...", progress=status_update.get("progress", 0))
                        elif new_status == "model_loading":
                             current_job_status_ref.update(status="model_loading", message=msg or "Loading model...")
                        elif new_status == "loading_complete":
                             current_job_status_ref.update(status="processing", message=msg or "Model loaded, preparing for transcription.")
                        elif new_status == "started":
                             current_job_status_ref.update(status="transcribing", message=msg or "Transcription started.")
                        elif new_status == "progress": # Transcription segment progress
                             current_job_status_ref.update(status="transcribing", progress=status_update.get("progress", current_job_status_ref.get("progress", 0)), message=msg)
                        elif new_status == "error":
                             current_job_status_ref.update(status="failed", error=msg or "Error from script.", message=msg, end_time=time.time())
                             if process and process.returncode is None: process.terminate()
                             return
                        elif new_status == "canceled":
                             current_job_status_ref.update(status="canceled", error=msg or "Canceled by script.", message=msg, end_time=time.time())
                             if process and process.returncode is None: process.terminate()
                             return
                        else: # Other valid JSON status updates
                            if new_status and new_status != current_job_status_ref["status"]: current_job_status_ref["status"] = new_status
                            if msg: current_job_status_ref["message"] = msg

                    except json.JSONDecodeError:
                        match = progress_regex.match(line)
                        if match:
                            end_time_str = match.group(2)
                            current_timestamp = parse_whisper_time(end_time_str)
                            total_duration = current_job_status_ref.get("duration")
                            if total_duration and total_duration > 0:
                                progress_val = min((current_timestamp / total_duration) * 100, 100.0)
                                if progress_val > current_job_status_ref.get("progress", 0):
                                     current_job_status_ref.update(status="transcribing", progress=round(progress_val, 2), message=f"Transcribing: {line.split(']')[0].strip()}]")
            else:
                logger.warning(f"Job {job_id}: process.stdout is None, cannot read STDOUT.")

        async def process_stderr_stream():
            nonlocal current_job_status_ref
            if process and process.stderr:
                async for line in read_stream_lines(process.stderr, job_id, "STDERR", progress_regex, current_job_status_ref):
                    logger.info(f"Job {job_id} STDERR (raw line): {line}") 
                    if current_job_status_ref.get("status") == "model_loading" or current_job_status_ref.get("status") == "model_downloading" :
                        if "downloading" in line.lower() or "%" in line or " ETA " in line:
                             current_job_status_ref.update(status="model_downloading", message=f"Model download: {line.strip()[:150]}")
                    try:
                        err_status = json.loads(line)
                        if err_status.get("status") == "error":
                             current_job_status_ref.update(status="failed", error=err_status.get("message", "Unknown stderr JSON error"), message=err_status.get("message"), end_time=time.time())
                             logger.error(f"Job {job_id} failed via STDERR JSON: {current_job_status_ref['error']}")
                             if process and process.returncode is None: process.terminate()
                             return
                    except json.JSONDecodeError:
                        pass # Already logged as raw stderr
            else:
                logger.warning(f"Job {job_id}: process.stderr is None, cannot read STDERR.")

        # Run stdout and stderr processing concurrently.
        # If one fails (e.g., due to an unhandled exception in read_stream_lines),
        # it could cancel the other. We log exceptions from these tasks.
        stream_processing_tasks = [process_stdout_stream(), process_stderr_stream()]
        results = await asyncio.gather(*stream_processing_tasks, return_exceptions=True)
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                stream_name = "STDOUT" if i == 0 else "STDERR"
                logger.error(f"Job {job_id}: Exception in {stream_name} processing task: {result}")
        
        if process: 
            logger.info(f"Job {job_id}: Waiting for subprocess to exit...")
            await process.wait()
            logger.info(f"Job {job_id}: Subprocess exited with code {process.returncode}.")
        else:
            logger.error(f"Job {job_id}: Process object became None unexpectedly before final wait.")


        # Final status check after process exits
        final_job_status = current_job_status_ref.get("status")
        logger.info(f"Job {job_id}: After process exit, job status is '{final_job_status}', return code: {process.returncode if process else 'N/A'}")

        if process and process.returncode == 0 and final_job_status not in ["failed", "canceled", "completed"]:
            if os.path.exists(output_path):
                try:
                    with open(output_path, 'r') as f: result_data = json.load(f)
                    current_job_status_ref.update(status="completed", result=result_data, progress=100.0, message="Transcription complete.")
                    logger.info(f"Job {job_id}: Successfully processed output file.")
                except Exception as e:
                    logger.exception(f"Job {job_id} final: Error reading result file {output_path}: {e}")
                    current_job_status_ref.update(status="failed", error=f"Failed to read result file: {e}", message="Error processing result.")
            else:
                logger.error(f"Job {job_id}: Process exited OK (0) but output file missing: {output_path}")
                current_job_status_ref.update(status="failed", error="Output file missing after successful process exit.", message="Output file missing.")
        elif final_job_status not in ["failed", "canceled", "completed"]: # If process failed or status not terminal yet
            err_msg_final = f"Process exited with code {process.returncode if process else 'N/A'}."
            logger.error(f"Job {job_id}: {err_msg_final}")
            current_job_status_ref.update(status="failed", error=current_job_status_ref.get("error") or err_msg_final, message=current_job_status_ref.get("message") or err_msg_final)

    except asyncio.CancelledError:
        logger.warning(f"Transcription task for job {job_id} was cancelled by server request.")
        current_job_status_ref.update(status="canceled", error="Processing canceled by server.", message="Job canceled by server request.")
        if process and process.returncode is None:
            try:
                logger.info(f"Terminating process for job {job_id} (PID: {process.pid}) due to asyncio.CancelledError...")
                process.terminate()
                await asyncio.wait_for(process.wait(), timeout=5.0)
            except asyncio.TimeoutError:
                logger.warning(f"Process {job_id} did not terminate gracefully after SIGTERM, sending SIGKILL.")
                if process and process.returncode is None: process.kill()
            except ProcessLookupError: logger.warning(f"Process {job_id} already exited during cancellation handling.")
            except Exception as e: logger.error(f"Error terminating process {job_id} on cancel: {e}")
    except Exception as e:
        logger.exception(f"Unexpected error in run_transcription_process for job {job_id}: {e}")
        current_job_status_ref.update(status="failed", error=f"Unexpected server error: {str(e)}", message="Internal server error during transcription initiation.")
    finally:
        if current_job_status_ref.get("end_time") is None: current_job_status_ref["end_time"] = time.time()
        
        start_t = current_job_status_ref.get("start_time", 0)
        end_t = current_job_status_ref.get("end_time", 0)
        processing_duration = (end_t - start_t) if start_t and end_t else 'N/A'
        
        logger.info(f"Job {job_id} finished. Final Status: {current_job_status_ref['status']}. "
                    f"Error: {current_job_status_ref.get('error')}. Message: {current_job_status_ref.get('message')}. "
                    f"Duration: {processing_duration}s")

        # File cleanup logic
        if os.path.exists(input_path):
            try: os.remove(input_path); logger.info(f"Job {job_id}: Removed input file {input_path}")
            except Exception as e: logger.error(f"Job {job_id}: Error removing input file {input_path}: {e}")
        
        # Keep output file if job failed for debugging, otherwise remove
        if os.path.exists(output_path):
            if current_job_status_ref.get("status") in ["completed", "canceled"]:
                try: os.remove(output_path); logger.info(f"Job {job_id}: Removed output file {output_path}")
                except Exception as e: logger.error(f"Job {job_id}: Error removing output file {output_path}: {e}")
            else:
                logger.warning(f"Job {job_id} status is '{current_job_status_ref.get('status')}', "
                               f"keeping potentially useful output file for debugging: {output_path}")


# --- FastAPI App Endpoints ---
app = FastAPI(title="Whisper Transcription Service")
TEMP_INPUT_DIR = os.getenv("TEMP_INPUT_DIR", "/app/temp_inputs")
TEMP_OUTPUT_DIR = os.getenv("TEMP_OUTPUT_DIR", "/app/temp_outputs")
os.makedirs(TEMP_INPUT_DIR, exist_ok=True)
os.makedirs(TEMP_OUTPUT_DIR, exist_ok=True)

@app.post("/transcribe", status_code=202)
async def transcribe_endpoint(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    model_name: str = Form("tiny")
):
    job_id = str(uuid.uuid4())
    file_extension = os.path.splitext(file.filename)[1] if file.filename else ".tmp"
    input_path = os.path.join(TEMP_INPUT_DIR, f"{job_id}{file_extension}")
    output_path = os.path.join(TEMP_OUTPUT_DIR, f"{job_id}.json")

    try:
        # Save uploaded file
        with open(input_path, "wb") as buffer:
            contents = await file.read()
            if not contents:
                logger.error(f"Uploaded file {file.filename} is empty.")
                raise HTTPException(status_code=400, detail="Uploaded file is empty.")
            buffer.write(contents)
        logger.info(f"Saved uploaded file to: {input_path} (size: {os.path.getsize(input_path)} bytes)")
    except Exception as e:
        logger.exception(f"Failed to save uploaded file {file.filename}: {e}")
        raise HTTPException(status_code=500, detail=f"Could not save uploaded file: {e}")

    jobs[job_id] = {
        "job_id": job_id, "status": "queued", "progress": 0.0, 
        "message": "Job queued.", "duration": None, "result": None, 
        "error": None, "start_time": None, "end_time": None
    }
    background_tasks.add_task(run_transcription_process, job_id, input_path, output_path, model_name)
    logger.info(f"Queued job {job_id} for file {file.filename} with model '{model_name}'")
    return {"job_id": job_id, "message": "Transcription job queued."}

@app.get("/status/{job_id}", response_model=JobStatus)
async def get_status_endpoint(job_id: str):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job ID not found")
    return job

@app.post("/cancel/{job_id}", status_code=200)
async def cancel_job_endpoint(job_id: str):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job ID not found")

    current_status = job.get("status")
    logger.info(f"Cancel request received for job {job_id} with current status: {current_status}")

    if current_status in ["queued", "model_loading", "model_downloading", "processing", "transcribing"]:
        job["status"] = "canceling" 
        job["message"] = "Cancellation requested by user. Attempting to stop process."
        logger.info(f"Job {job_id} marked as 'canceling'. Signal handler in transcribe.py should take over.")
        # The actual process termination is handled by the signal handler in transcribe.py
        # or by the CancelledError in run_transcription_process if the task itself is cancelled by FastAPI (less direct control)
        return {"job_id": job_id, "message": "Cancellation request sent. Job will attempt to terminate."}
    elif current_status in ["completed", "failed", "canceled", "canceling"]:
        logger.info(f"Job {job_id} already in terminal or canceling state: {current_status}")
        return {"job_id": job_id, "message": f"Job already in state: {current_status}"}
    else:
        logger.error(f"Unexpected status for job {job_id} during cancel: {current_status}")
        raise HTTPException(status_code=500, detail=f"Unexpected job status for cancellation: {current_status}")

@app.get("/")
def read_root(): return {"message": "Whisper Transcription Service running."}

@app.get("/health")
def health_check():
    if not os.path.exists(TEMP_INPUT_DIR) or not os.path.exists(TEMP_OUTPUT_DIR):
        logger.error("Health Check Failed: Temp dirs missing.")
        raise HTTPException(status_code=503, detail="Service Unavailable: Missing temp dirs.")
    return {"status": "healthy"}

if __name__ == "__main__":
    import uvicorn
    # Run uvicorn. Note: `reload=True` is good for dev but not for Docker CMD usually.
    # The Docker CMD uses `uvicorn server:app --host 0.0.0.0 --port 8000` without reload.
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)
