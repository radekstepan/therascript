# file path: server.py
import os
import sys
import json
import uuid
import asyncio
import subprocess
from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import logging
import time
import re # *** Import the regex module ***

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# --- Global state for jobs (simple in-memory) ---
jobs = {}

class TranscriptionResult(BaseModel):
    text: str
    segments: list
    language: str

class JobStatus(BaseModel):
    job_id: str
    status: str # queued, processing, completed, failed, canceled
    progress: float = 0.0 # Percentage (0-100)
    duration: float | None = None # *** Add duration field ***
    result: TranscriptionResult | None = None
    error: str | None = None
    start_time: float | None = None
    end_time: float | None = None


# --- Helper function to parse Whisper timestamps ---
def parse_whisper_time(time_str: str) -> float:
    """Parses MM:SS.mmm or HH:MM:SS.mmm into seconds."""
    parts = time_str.split(':')
    if len(parts) == 3: # HH:MM:SS.mmm
        hours = int(parts[0])
        minutes = int(parts[1])
        seconds = float(parts[2])
        return hours * 3600 + minutes * 60 + seconds
    elif len(parts) == 2: # MM:SS.mmm
        minutes = int(parts[0])
        seconds = float(parts[1])
        return minutes * 60 + seconds
    else:
        logger.warning(f"Could not parse timestamp format: {time_str}")
        return 0.0

# --- Helper function to parse duration string ---
def parse_duration_string(duration_str: str) -> float:
    """Parses strings like 'Audio duration: 2785.08s' or just '2785.08'"""
    match = re.search(r'(\d+(\.\d+)?)', duration_str)
    if match:
        try:
            return float(match.group(1))
        except ValueError:
            return 0.0
    return 0.0

# --- Transcription Logic Runner ---
async def run_transcription_process(job_id: str, input_path: str, output_path: str, model_name: str):
    global jobs
    try:
        process = None
        jobs[job_id]["status"] = "processing"
        jobs[job_id]["start_time"] = time.time()

        logger.info(f"Starting transcription process for job {job_id} with model {model_name}")

        cmd = [
            "python3",
            "transcribe.py",
            input_path,
            output_path,
            model_name
        ]

        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE # Keep reading stderr too
        )

        # Regex to match Whisper's verbose timestamp lines
        # Allows for HH:MM:SS.mmm or MM:SS.mmm format
        progress_regex = re.compile(r'^\[(\d{1,2}:\d{2}\.\d{3})\s*-->\s*(\d{1,2}:\d{2}\.\d{3})\]')

        # Monitor stdout for progress and status updates
        while True:
            # Use asyncio.wait_for to prevent blocking indefinitely if only stderr has output
            try:
                line_bytes = await asyncio.wait_for(process.stdout.readline(), timeout=0.1)
            except asyncio.TimeoutError:
                 # Check if process exited if stdout is silent
                 if process.returncode is not None:
                     break # Process finished
                 # Check stderr while stdout is quiet
                 try:
                      err_line_bytes = await asyncio.wait_for(process.stderr.readline(), timeout=0.1)
                      if err_line_bytes:
                           err_line = err_line_bytes.decode('utf-8', errors='ignore').strip()
                           logger.warning(f"Job {job_id} STDERR (during stdout wait): {err_line}")
                           # Potentially parse stderr for JSON errors too?
                           try:
                                err_status = json.loads(err_line)
                                if err_status.get("status") == "error":
                                    jobs[job_id]["status"] = "failed"
                                    jobs[job_id]["error"] = err_status.get("message", "Unknown error from transcribe.py stderr")
                                    jobs[job_id]["end_time"] = time.time()
                                    logger.error(f"Job {job_id} failed via stderr JSON: {jobs[job_id]['error']}")
                                    if process.returncode is None: process.terminate()
                                    await process.wait()
                                    return
                           except json.JSONDecodeError:
                               pass # Ignore non-JSON stderr lines for now
                 except asyncio.TimeoutError:
                      pass # No output on either stream, continue loop
                 continue # Skip to next readline attempt

            if not line_bytes:
                break # End of stdout stream

            line = line_bytes.decode('utf-8', errors='ignore').strip()
            # logger.info(f"RAW STDOUT from transcribe.py: {line}") # Keep for debugging if needed

            # --- Try parsing as JSON first ---
            try:
                status_update = json.loads(line)
                status = status_update.get("status")

                if status == "info" and status_update.get("code") == "audio_duration":
                    duration_str = status_update.get("message", "")
                    duration = parse_duration_string(duration_str)
                    if duration > 0:
                        jobs[job_id]["duration"] = duration
                        logger.info(f"Job {job_id}: Stored audio duration: {duration}s")
                    else:
                        logger.warning(f"Job {job_id}: Could not parse duration from message: {duration_str}")

                elif status == "progress": # Handle explicit progress JSON if transcribe.py ever sends it
                    jobs[job_id]["progress"] = status_update.get("progress", jobs[job_id].get("progress", 0))

                elif status == "error":
                     jobs[job_id]["status"] = "failed"
                     jobs[job_id]["error"] = status_update.get("message", "Unknown error from transcribe.py stdout")
                     jobs[job_id]["end_time"] = time.time()
                     logger.error(f"Job {job_id} failed via stdout JSON: {jobs[job_id]['error']}")
                     if process.returncode is None: process.terminate()
                     await process.wait()
                     return

                elif status == "canceled":
                    jobs[job_id]["status"] = "canceled"
                    jobs[job_id]["message"] = status_update.get("message", "Job canceled")
                    jobs[job_id]["end_time"] = time.time()
                    logger.info(f"Job {job_id} canceled via stdout JSON")
                    if process.returncode is None: process.terminate()
                    await process.wait()
                    return

                # Log other JSON messages if needed
                # else:
                #    logger.info(f"Job {job_id} JSON Status: {line}")

            # --- If JSON parsing fails, try parsing as Whisper verbose output ---
            except json.JSONDecodeError:
                match = progress_regex.match(line)
                if match:
                    end_time_str = match.group(2) # Get the second timestamp (end of segment)
                    current_timestamp = parse_whisper_time(end_time_str)
                    total_duration = jobs[job_id].get("duration")

                    if total_duration and total_duration > 0:
                        progress = min((current_timestamp / total_duration) * 100, 100.0)
                        # Update progress only if it increases (timestamps might overlap slightly)
                        if progress > jobs[job_id]["progress"]:
                            jobs[job_id]["progress"] = round(progress, 2)
                            # logger.debug(f"Job {job_id} Progress Updated: {jobs[job_id]['progress']:.2f}% (from timestamp {current_timestamp:.2f}s)") # Optional debug log
                    # else:
                         # logger.warning(f"Job {job_id}: Received progress line but duration not yet known or zero.")
                # else:
                    # logger.debug(f"Ignoring non-JSON, non-progress line from transcribe.py: {line}") # Optional debug log
                    # pass # Ignore other non-JSON lines

        # --- Process finished ---
        # Wait for process completion and check stderr/return code *after* loop
        stdout, stderr = await process.communicate() # Read any remaining output

        # Decode remaining stderr
        stderr_str = stderr.decode('utf-8', errors='ignore').strip() if stderr else ""
        if stderr_str:
             logger.warning(f"Job {job_id} Final STDERR: {stderr_str}")
             # Check stderr again for potential JSON errors missed during loop
             try:
                err_status = json.loads(stderr_str.splitlines()[-1]) # Check last line
                if err_status.get("status") == "error" and jobs[job_id]["status"] not in ["failed", "canceled"]:
                    jobs[job_id]["status"] = "failed"
                    jobs[job_id]["error"] = err_status.get("message", "Unknown error from transcribe.py final stderr")
                    logger.error(f"Job {job_id} failed via final stderr JSON: {jobs[job_id]['error']}")
             except (json.JSONDecodeError, IndexError):
                 pass # Not a JSON error or no lines

        # --- Final Job Status Update ---
        current_status = jobs[job_id]["status"]
        if process.returncode == 0 and current_status == "processing":
            logger.info(f"Transcription process for job {job_id} completed successfully (Return Code 0).")
            try:
                # Check if output file exists before trying to read
                if os.path.exists(output_path):
                    with open(output_path, 'r') as f:
                        result_data = json.load(f)
                    jobs[job_id]["status"] = "completed"
                    jobs[job_id]["result"] = result_data
                    jobs[job_id]["progress"] = 100.0
                else:
                     # This case should ideally not happen if return code is 0, but handle defensively
                     logger.error(f"Job {job_id} process exited successfully but output file missing: {output_path}")
                     jobs[job_id]["status"] = "failed"
                     jobs[job_id]["error"] = "Process completed but output file was not found."
            except Exception as e:
                logger.exception(f"Job {job_id}: Error reading result file {output_path} even after successful exit: {e}")
                jobs[job_id]["status"] = "failed"
                jobs[job_id]["error"] = f"Failed to read result file: {e}"

        # Handle failures if not already set
        elif current_status not in ["failed", "canceled"]:
            logger.error(f"Transcription process for job {job_id} failed. Return code: {process.returncode}")
            jobs[job_id]["status"] = "failed"
            # Prioritize existing error message if one was parsed from JSON
            if not jobs[job_id].get("error"):
                jobs[job_id]["error"] = stderr_str or f"Process exited with code {process.returncode}"


    except asyncio.CancelledError:
        logger.warning(f"Transcription task for job {job_id} was cancelled by server.")
        jobs[job_id]["status"] = "canceled"
        jobs[job_id]["error"] = "Processing was canceled by the server."
        if process and process.returncode is None:
            try:
                 logger.info(f"Terminating process for canceled job {job_id}...")
                 process.terminate()
                 await asyncio.wait_for(process.wait(), timeout=5.0) # Wait briefly
            except asyncio.TimeoutError:
                logger.warning(f"Process {job_id} did not terminate gracefully, sending SIGKILL.")
                process.kill()
            except ProcessLookupError:
                logger.warning(f"Process {job_id} already exited before termination.")
            except Exception as e:
                 logger.error(f"Error during process termination for job {job_id}: {e}")

    except Exception as e:
        logger.exception(f"Unexpected error during transcription task for job {job_id}: {e}")
        jobs[job_id]["status"] = "failed"
        # Avoid overwriting specific errors if already set
        if not jobs[job_id].get("error"):
            jobs[job_id]["error"] = f"Unexpected server error: {str(e)}"
    finally:
        if jobs[job_id].get("end_time") is None: # Set end time if not already set by failure/cancel
             jobs[job_id]["end_time"] = time.time()

        logger.info(f"Job {job_id} finished with status: {jobs[job_id]['status']}. Duration: {jobs[job_id]['end_time'] - jobs[job_id]['start_time'] if jobs[job_id]['start_time'] else 'N/A'}s")

        # Clean up temporary files
        if os.path.exists(input_path):
            try:
                os.remove(input_path)
                logger.info(f"Removed temporary input file: {input_path}")
            except Exception as e:
                logger.error(f"Error removing temporary input file {input_path}: {e}")
        if os.path.exists(output_path):
             # Keep output file if job failed for debugging? For now, remove always.
            try:
                os.remove(output_path)
                logger.info(f"Removed temporary output file: {output_path}")
            except Exception as e:
                logger.error(f"Error removing temporary output file {output_path}: {e}")


# --- FastAPI App ---
app = FastAPI(title="Whisper Transcription Service")

# Define directories for temporary files inside the container
TEMP_INPUT_DIR = "/app/temp_inputs"
TEMP_OUTPUT_DIR = "/app/temp_outputs"
os.makedirs(TEMP_INPUT_DIR, exist_ok=True)
os.makedirs(TEMP_OUTPUT_DIR, exist_ok=True)

@app.post("/transcribe", status_code=202)
async def transcribe_endpoint(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    model_name: str = "tiny" # Default model
):
    job_id = str(uuid.uuid4())
    file_extension = os.path.splitext(file.filename)[1] if file.filename else ".tmp"
    input_path = os.path.join(TEMP_INPUT_DIR, f"{job_id}{file_extension}")
    output_path = os.path.join(TEMP_OUTPUT_DIR, f"{job_id}.json")

    try:
        with open(input_path, "wb") as buffer:
            content = await file.read()
            buffer.write(content)
        logger.info(f"Saved uploaded file to temporary path: {input_path}")
    except Exception as e:
        logger.exception(f"Failed to save uploaded file {file.filename}: {e}")
        raise HTTPException(status_code=500, detail=f"Could not save uploaded file: {e}")

    # Initialize job status
    jobs[job_id] = {
        "job_id": job_id,
        "status": "queued",
        "progress": 0.0,
        "duration": None, # *** Initialize duration ***
        "result": None,
        "error": None,
        "start_time": None,
        "end_time": None
    }

    background_tasks.add_task(run_transcription_process, job_id, input_path, output_path, model_name)
    logger.info(f"Queued transcription job {job_id} for file {file.filename} with model {model_name}")

    return {"job_id": job_id, "message": "Transcription job started."}

# Use the Pydantic model for the response to ensure structure
@app.get("/status/{job_id}", response_model=JobStatus)
async def get_status_endpoint(job_id: str):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job ID not found")
    # Return the job dictionary directly, FastAPI handles Pydantic validation
    return job

@app.post("/cancel/{job_id}", status_code=200)
async def cancel_job_endpoint(job_id: str):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job ID not found")

    current_status = job.get("status")

    if current_status == "processing" or current_status == "queued":
        if current_status == "processing":
             logger.warning(f"Cancel request received for job {job_id}. Attempting termination (via transcribe.py signal).")
             # Mark for cancellation - the transcribe.py signal handler should react
             # Ideally, we'd find and cancel the specific asyncio task too, but
             # signaling the subprocess is the primary mechanism here.
             job["status"] = "canceling" # Mark intention
             # No direct process termination here; rely on transcribe.py signal handling + run_transcription_process cleanup
             message = "Cancel request received. Actual termination depends on subprocess."
        else: # queued
             job["status"] = "canceled"
             job["error"] = "Job canceled before processing started."
             job["end_time"] = time.time()
             logger.info(f"Canceled queued job {job_id}.")
             message = "Job canceled successfully before start."
        return {"job_id": job_id, "message": message}

    elif current_status in ["completed", "failed", "canceled", "canceling"]:
        return {"job_id": job_id, "message": f"Job already in terminal or canceling state: {current_status}"}
    else:
        # Should not happen with defined states
         logger.error(f"Job {job_id} in unexpected state for cancellation: {current_status}")
         raise HTTPException(status_code=500, detail=f"Job in unexpected state: {current_status}")


@app.get("/")
def read_root():
    return {"message": "Whisper Transcription Service is running."}

@app.get("/health")
def health_check():
    if not os.path.exists(TEMP_INPUT_DIR) or not os.path.exists(TEMP_OUTPUT_DIR):
         logger.error("Health Check Failed: Temporary directories missing.")
         raise HTTPException(status_code=503, detail="Service Unavailable: Missing temp directories.")
    return {"status": "healthy"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True) # Add reload for dev
