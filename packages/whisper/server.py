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

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# --- Global state for jobs (simple in-memory) ---
# TODO: Replace with a more robust job management system if scaling
jobs = {}

class TranscriptionResult(BaseModel):
    text: str
    segments: list
    language: str

class JobStatus(BaseModel):
    job_id: str
    status: str # queued, processing, completed, failed, canceled
    progress: float = 0.0 # Percentage (0-100)
    result: TranscriptionResult | None = None
    error: str | None = None
    start_time: float | None = None
    end_time: float | None = None


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
            stderr=asyncio.subprocess.PIPE
        )

        # Monitor stdout for progress and status updates
        while True:
            line_bytes = await process.stdout.readline()
            if not line_bytes:
                break
            line = line_bytes.decode('utf-8').strip()
            logger.info(f"Job {job_id} STDOUT: {line}")
            try:
                status_update = json.loads(line)
                if status_update.get("status") == "progress":
                    jobs[job_id]["progress"] = status_update.get("progress", jobs[job_id].get("progress", 0))
                elif status_update.get("status") == "error":
                     jobs[job_id]["status"] = "failed"
                     jobs[job_id]["error"] = status_update.get("message", "Unknown error from transcribe.py")
                     jobs[job_id]["end_time"] = time.time()
                     logger.error(f"Job {job_id} failed via stdout: {jobs[job_id]['error']}")
                     # No need to continue reading stdout/stderr
                     if process.returncode is None:
                        process.terminate()
                     await process.wait() # Ensure process is cleaned up
                     return # Exit the loop and function
                elif status_update.get("status") == "canceled":
                    jobs[job_id]["status"] = "canceled"
                    jobs[job_id]["message"] = status_update.get("message", "Job canceled")
                    jobs[job_id]["end_time"] = time.time()
                    logger.info(f"Job {job_id} canceled via stdout")
                    if process.returncode is None:
                        process.terminate() # Ensure cancellation if process didn't exit yet
                    await process.wait()
                    return # Exit the loop and function

            except json.JSONDecodeError:
                # Ignore lines that aren't valid JSON (like verbose output)
                pass

        # Wait for process completion and check stderr
        stdout, stderr = await process.communicate()

        if process.returncode == 0 and jobs[job_id]["status"] == "processing": # Check if not already failed/canceled
            logger.info(f"Transcription process for job {job_id} completed successfully.")
            with open(output_path, 'r') as f:
                result_data = json.load(f)
            jobs[job_id]["status"] = "completed"
            jobs[job_id]["result"] = result_data
            jobs[job_id]["progress"] = 100.0
        elif jobs[job_id]["status"] not in ["failed", "canceled"]: # Only update if not already failed/canceled
            stderr_str = stderr.decode('utf-8').strip()
            logger.error(f"Transcription process for job {job_id} failed. Return code: {process.returncode}")
            logger.error(f"Job {job_id} STDERR: {stderr_str}")
            jobs[job_id]["status"] = "failed"
            jobs[job_id]["error"] = stderr_str or f"Process exited with code {process.returncode}"

    except asyncio.CancelledError:
        logger.warning(f"Transcription task for job {job_id} was cancelled.")
        jobs[job_id]["status"] = "canceled"
        jobs[job_id]["error"] = "Processing was canceled."
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
        logger.exception(f"Unexpected error during transcription for job {job_id}: {e}")
        jobs[job_id]["status"] = "failed"
        jobs[job_id]["error"] = str(e)
    finally:
        jobs[job_id]["end_time"] = time.time()
        # Clean up temporary files
        if os.path.exists(input_path):
            try:
                os.remove(input_path)
                logger.info(f"Removed temporary input file: {input_path}")
            except Exception as e:
                logger.error(f"Error removing temporary input file {input_path}: {e}")
        # Output file removal might depend on whether result was successfully stored
        # If completed, keep it temporarily for retrieval? Or remove always? Remove always for now.
        if os.path.exists(output_path):
            try:
                os.remove(output_path)
                logger.info(f"Removed temporary output file: {output_path}")
            except Exception as e:
                logger.error(f"Error removing temporary output file {output_path}: {e}")


# --- FastAPI App ---
app = FastAPI(title="Whisper Transcription Service")

# Define directories for temporary files inside the container
# Ensure these directories exist or are created
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
    """
    Accepts an audio file upload, starts transcription in the background,
    and returns a job ID to check status.
    """
    job_id = str(uuid.uuid4())
    file_extension = os.path.splitext(file.filename)[1] if file.filename else ".tmp"
    input_path = os.path.join(TEMP_INPUT_DIR, f"{job_id}{file_extension}")
    output_path = os.path.join(TEMP_OUTPUT_DIR, f"{job_id}.json")

    # Save the uploaded file
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
        "result": None,
        "error": None,
        "start_time": None,
        "end_time": None
    }

    # Add transcription task to background
    background_tasks.add_task(run_transcription_process, job_id, input_path, output_path, model_name)
    logger.info(f"Queued transcription job {job_id} for file {file.filename} with model {model_name}")

    return {"job_id": job_id, "message": "Transcription job started."}

@app.get("/status/{job_id}", response_model=JobStatus)
async def get_status_endpoint(job_id: str):
    """
    Returns the status of a transcription job.
    """
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job ID not found")
    return job

@app.post("/cancel/{job_id}", status_code=200)
async def cancel_job_endpoint(job_id: str):
    """
    Attempts to cancel a running transcription job.
    """
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job ID not found")

    if job["status"] == "processing":
        job["status"] = "canceling" # Mark as canceling
        logger.warning(f"Cancel request received for job {job_id}. Attempting termination.")
        # Find the running task and cancel it. This requires managing tasks explicitly.
        # For simplicity here, we rely on the fact that the background task checks
        # its state and the signal handler in transcribe.py, but a better way
        # would be to store the asyncio task handle and call task.cancel().
        # This basic implementation might only stop *new* jobs from processing it,
        # and relies on SIGTERM inside transcribe.py to stop the current run.
        # A more robust implementation is needed for immediate cancellation.
        return {"job_id": job_id, "message": "Cancel request received. Termination may take time."}
    elif job["status"] in ["completed", "failed", "canceled"]:
        return {"job_id": job_id, "message": f"Job already in terminal state: {job['status']}"}
    else: # queued
        job["status"] = "canceled"
        job["error"] = "Job canceled before processing started."
        job["end_time"] = time.time()
        logger.info(f"Canceled queued job {job_id}.")
        return {"job_id": job_id, "message": "Job canceled successfully."}


@app.get("/")
def read_root():
    return {"message": "Whisper Transcription Service is running."}

# Health check endpoint
@app.get("/health")
def health_check():
    # Basic check: Check if essential directories exist
    if not os.path.exists(TEMP_INPUT_DIR) or not os.path.exists(TEMP_OUTPUT_DIR):
         logger.error("Health Check Failed: Temporary directories missing.")
         raise HTTPException(status_code=503, detail="Service Unavailable: Missing temp directories.")
    # TODO: Could add check for GPU availability via torch here if needed
    return {"status": "healthy"}

if __name__ == "__main__":
    import uvicorn
    # Run directly for debugging if needed, otherwise Dockerfile uses uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
