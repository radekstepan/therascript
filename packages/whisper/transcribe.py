# Purpose: Standalone script that performs audio transcription using OpenAI's Whisper model.
#          It's executed as a subprocess by the FastAPI server (`server.py`).
#          Communicates status and results back via JSON printed to stdout/stderr.

import os
import sys
import json
import signal       # For handling termination signals (SIGTERM, SIGINT)
import subprocess   # For running ffprobe to get audio duration
import whisper      # OpenAI's Whisper library
import torch        # PyTorch, used by Whisper (especially for GPU checks)
import time         # For progress reporting timing

# --- Global State ---
# Flag to indicate if a termination signal has been received
should_exit = False
# Timestamp of the last progress report to throttle updates
last_progress_report_time = 0
# Minimum interval (in seconds) between progress reports
progress_report_interval = 2
# --- End Global State ---

# --- Signal Handling ---
def signal_handler(sig, frame):
    """Handles SIGTERM and SIGINT signals."""
    global should_exit
    # Print a JSON message indicating cancellation due to signal
    print(json.dumps({"status": "canceled", "message": f"Received signal {sig}, shutting down gracefully"}), flush=True)
    should_exit = True # Set the global flag to true
# Register the handler for termination signals
signal.signal(signal.SIGTERM, signal_handler)
signal.signal(signal.SIGINT, signal_handler)
# --- End Signal Handling ---

# --- Helper Functions ---
def get_audio_duration(file_path):
    """
    Gets the duration of an audio file in seconds using the ffprobe command.
    ffprobe is part of the FFmpeg suite (installed in the Dockerfile).
    """
    cmd = [
        "ffprobe",          # The command
        "-v", "error",      # Suppress informational output, show only errors
        "-show_entries", "format=duration", # Request only the duration field from the format section
        "-of", "default=noprint_wrappers=1:nokey=1", # Output format: print only the value, no key/wrapper
        file_path           # Input audio file path
    ]
    try:
        # Run the command and capture output
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        duration_str = result.stdout.strip()
        # Convert the duration string to a float
        return float(duration_str) if duration_str else 0
    except subprocess.CalledProcessError as e:
        # Handle errors if ffprobe fails (e.g., file corrupted, not found)
        print(json.dumps({
            "status": "error",
            "code": "ffprobe_failed",
            "message": f"ffprobe failed: {e.stderr.strip()}"
        }), file=sys.stderr, flush=True) # Print JSON error to stderr
        return 0
    except Exception as e:
        # Handle other potential errors during duration fetching
        print(json.dumps({
            "status": "error",
            "code": "duration_error",
            "message": f"Error getting duration: {str(e)}"
        }), file=sys.stderr, flush=True) # Print JSON error to stderr
        return 0

# NOTE: The `progress_callback` argument is NOT an official part of whisper.transcribe().
#       Progress is typically handled by parsing the verbose output if `verbose=True`.
#       This hook remains here but is currently UNUSED in the `transcribe_audio` function.
def progress_hook(seek: int, timestamp: float, overall_duration: float):
    """UNUSED Callback hook intended for whisper progress (official API doesn't support it)."""
    global should_exit, last_progress_report_time, progress_report_interval
    if should_exit:
        # If cancellation is flagged, raise an error to stop Whisper's internal processing.
        raise RuntimeError("Transcription canceled by signal")

    current_time = time.time()
    # Throttle progress updates based on the defined interval
    if overall_duration > 0 and (current_time - last_progress_report_time > progress_report_interval):
        progress = min((timestamp / overall_duration) * 100, 100)
        # Print progress as a JSON message to stdout
        print(json.dumps({
            "status": "progress",
            "progress": round(progress, 2),
            "current_time": round(timestamp, 2),
            "total_duration": round(overall_duration, 2)
        }), flush=True)
        last_progress_report_time = current_time
# --- End Helper Functions ---

# --- Core Transcription Logic ---
def transcribe_audio(file_path, output_file, model_name):
    """
    Performs audio transcription using the specified Whisper model.
    Handles model loading, transcription, progress reporting (via parsing verbose output),
    result saving, and cancellation checks.
    """
    global should_exit, last_progress_report_time
    should_exit = False # Reset cancellation flag for this new job
    last_progress_report_time = 0 # Reset progress timer

    try:
        # Ensure the output directory exists
        output_dir = os.path.dirname(output_file)
        if output_dir:
            os.makedirs(output_dir, exist_ok=True)

        # 1. Get Audio Duration
        duration = get_audio_duration(file_path)
        if duration <= 0:
            # Error getting duration is handled and printed by get_audio_duration
            raise ValueError("Could not determine audio duration.")

        # Print duration info as JSON to stdout
        print(json.dumps({
            "status": "info",
            "code": "audio_duration",
            "message": f"{duration:.2f}" # Send only the number for easier parsing
        }), flush=True)

        # 2. Check GPU Availability (Early Check)
        if not torch.cuda.is_available():
            # If CUDA is unavailable, raise a specific error. This script expects GPU.
            # Consider adding a CPU fallback option if desired.
            raise RuntimeError("CUDA (GPU) is not available or PyTorch CUDA build is not installed.")
        else:
            # If GPU is available, log confirmation and GPU name
            gpu_name = torch.cuda.get_device_name(0)
            print(json.dumps({
                "status": "info",
                "code": "cuda_available",
                "message": f"true ({gpu_name})" # Indicate availability and name
            }), flush=True)

        # 3. Load Whisper Model
        print(json.dumps({"status": "loading", "message": f"Loading model: {model_name}"}), flush=True)
        model = whisper.load_model(model_name) # Loads model (can take time, downloads if needed)
        print(json.dumps({"status": "loading_complete", "message": "Model loaded"}), flush=True)

        # 4. Start Transcription
        print(json.dumps({"status": "started", "message": "Transcription started"}), flush=True)

        # Run transcription.
        # `verbose=True` makes Whisper print progress logs to stderr, which `server.py` will capture and parse.
        # The unused `progress_hook` is commented out.
        result = model.transcribe(file_path, language="en", verbose=True)

        # 5. Check for Cancellation *after* transcribe call returns (it might have been interrupted)
        if should_exit:
            # This part might only be reached if cancellation happened very late or wasn't caught mid-process
            print(json.dumps({"status": "canceled", "message": "Transcription canceled during processing (late detection)"}), flush=True)
            return # Exit cleanly after cancellation message

        # 6. Save Result to JSON file
        with open(output_file, "w") as f:
            json.dump(result, f, indent=4)

        # 7. Notify Completion
        print(json.dumps({
            "status": "completed",
            "message": f"Transcription completed. Saved to: {output_file}",
            # Include a summary of the result for quick info
            "result_summary": {
                "language": result.get("language"),
                "segment_count": len(result.get("segments", [])),
                "text_length": len(result.get("text", ""))
            }
        }), flush=True)

    except RuntimeError as e:
        # Handle specific runtime errors caught during processing
        if "Transcription canceled" in str(e): # Raised by the (currently unused) hook
            print(json.dumps({"status": "canceled", "message": "Transcription explicitly canceled by hook"}), flush=True)
        elif "CUDA" in str(e): # Raised by GPU check or potentially during model execution
            # Print specific CUDA error to stderr
            print(json.dumps({
                "status": "error",
                "code": "cuda_error",
                "message": str(e),
            }), file=sys.stderr, flush=True)
            sys.exit(1) # Exit with non-zero code for critical errors like CUDA failure
        else:
            # Handle other generic runtime errors
            print(json.dumps({
                "status": "error",
                "code": "runtime_error",
                "message": f"Runtime error during transcription: {str(e)}"
            }), file=sys.stderr, flush=True)
            sys.exit(1) # Exit with non-zero code

    except Exception as e:
        # Catch all other unexpected errors
        print(json.dumps({
            "status": "error",
            "code": "unknown_error",
            "message": f"Unexpected error during transcription: {str(e)}"
        }), file=sys.stderr, flush=True)
        sys.exit(1) # Exit with non-zero code for unexpected errors
# --- End Core Transcription Logic ---

# --- Script Entry Point ---
if __name__ == "__main__":
    # Validate command-line arguments
    if len(sys.argv) != 4:
        # Print usage error as JSON to stderr
        print(json.dumps({
            "status": "error",
            "code": "invalid_arguments",
            "message": "Invalid arguments provided.",
            "usage": "python3 transcribe.py <input_audio_file> <output_file> <model_name>"
        }), file=sys.stderr, flush=True)
        sys.exit(1) # Exit due to invalid arguments

    # Get arguments
    audio_file = sys.argv[1]
    output_file = sys.argv[2]
    model_name = sys.argv[3]

    # Validate input file existence
    if not os.path.isfile(audio_file):
        # Print file not found error as JSON to stderr
        print(json.dumps({
            "status": "error",
            "code": "file_not_found",
            "message": f"Input audio file '{audio_file}' not found."
        }), file=sys.stderr, flush=True)
        sys.exit(1) # Exit due to file not found

    # Call the main transcription function
    transcribe_audio(audio_file, output_file, model_name)
# --- End Script Entry Point ---
