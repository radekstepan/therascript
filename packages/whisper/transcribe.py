import os
import sys
import json
import signal
import subprocess
import whisper
import torch
import time

# Global State
should_exit = False
last_progress_report_time = 0
progress_report_interval = 1 # Report progress more frequently if needed

# Signal Handling
def signal_handler(sig, frame):
    global should_exit
    # Print a JSON message indicating cancellation due to signal
    # Ensure this is printed to stdout for server.py to parse
    print(json.dumps({"status": "canceled", "message": f"Received signal {sig}, requesting shutdown."}), flush=True)
    should_exit = True

signal.signal(signal.SIGTERM, signal_handler)
signal.signal(signal.SIGINT, signal_handler)

# Helper Functions
def get_audio_duration(file_path):
    cmd = ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file_path]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        duration_str = result.stdout.strip()
        return float(duration_str) if duration_str else 0
    except subprocess.CalledProcessError as e:
        print(json.dumps({ "status": "error", "code": "ffprobe_failed", "message": f"ffprobe failed for {os.path.basename(file_path)}: {e.stderr.strip()}" }), file=sys.stderr, flush=True)
        return 0
    except Exception as e:
        print(json.dumps({ "status": "error", "code": "duration_error", "message": f"Error getting duration for {os.path.basename(file_path)}: {str(e)}" }), file=sys.stderr, flush=True)
        return 0

# Core Transcription Logic
def transcribe_audio(file_path, output_file, model_name):
    global should_exit, last_progress_report_time
    should_exit = False 
    last_progress_report_time = time.time() 

    # --- NEW LOG ---
    print(json.dumps({"status": "info", "message": "transcribe.py script started."}), flush=True)

    try:
        output_dir = os.path.dirname(output_file)
        if output_dir: os.makedirs(output_dir, exist_ok=True)

        print(json.dumps({"status": "processing", "message": "Fetching audio duration..."}), flush=True)
        duration = get_audio_duration(file_path)
        if should_exit: return # Check after potentially blocking call
        if duration <= 0:
            raise ValueError("Could not determine audio duration or audio is empty.")
        print(json.dumps({"status": "info", "code": "audio_duration", "message": f"{duration:.2f}"}), flush=True)

        if not torch.cuda.is_available():
            print(json.dumps({"status": "info", "code": "cuda_not_available", "message": "CUDA (GPU) not available. Using CPU (will be slow)."}), flush=True)
        else:
            gpu_name = torch.cuda.get_device_name(0)
            print(json.dumps({"status": "info", "code": "cuda_available", "message": f"Using CUDA GPU: {gpu_name}"}), flush=True)
        
        if should_exit: return

        # --- NEW, MORE DETAILED LOGS AROUND THE CRITICAL SECTION ---
        print(json.dumps({"status": "model_loading", "message": f"About to call whisper.load_model('{model_name}'). This is the memory-intensive step."}), flush=True)
        
        # This is the line that causes the OOM error on cold start
        model = whisper.load_model(model_name)
        
        # If this log appears, it means the model loaded successfully
        print(json.dumps({"status": "loading_complete", "message": f"Model '{model_name}' loaded successfully into memory."}), flush=True)
        # --- END OF NEW LOGS ---

        if should_exit: # Check immediately after potentially long load_model call
            print(json.dumps({"status": "canceled", "message": "Canceled after model load attempt."}), flush=True)
            return

        # --- NEW LOG ---
        print(json.dumps({"status": "transcribing", "message": "Starting actual transcription..."}), flush=True)
        
        result = model.transcribe(file_path, language="en", verbose=True) 

        if should_exit:
            print(json.dumps({"status": "canceled", "message": "Canceled during transcription processing."}), flush=True)
            return

        with open(output_file, "w") as f:
            json.dump(result, f, indent=4)
        
        print(json.dumps({
            "status": "completed", 
            "message": f"Transcription completed. Output saved to: {os.path.basename(output_file)}",
            "result_summary": { 
                "language": result.get("language"), 
                "segment_count": len(result.get("segments", [])), 
                "text_length": len(result.get("text", ""))
            }
        }), flush=True)

    except RuntimeError as e:
        err_code = "runtime_error"
        if "Transcription canceled" in str(e): # From our hook, if ever used
            print(json.dumps({"status": "canceled", "message": "Transcription explicitly canceled by hook"}), flush=True)
            return # Don't exit with error for graceful cancellation
        elif "CUDA" in str(e) or "tensorrt" in str(e).lower() or "HIP" in str(e): # Common GPU related errors
            err_code = "gpu_error"
        
        print(json.dumps({ "status": "error", "code": err_code, "message": str(e)}), file=sys.stderr, flush=True)
        sys.exit(1) # Exit with non-zero code for runtime errors
    except ValueError as e: # Catch the ValueError from duration check or other value issues
        print(json.dumps({ "status": "error", "code": "audio_error", "message": str(e)}), file=sys.stderr, flush=True)
        sys.exit(1)
    except Exception as e:
        print(json.dumps({ "status": "error", "code": "unknown_error", "message": f"An unexpected error occurred: {str(e)}"}), file=sys.stderr, flush=True)
        sys.exit(1) # Exit with non-zero for any other unhandled error

if __name__ == "__main__":
    if len(sys.argv) != 4:
        print(json.dumps({ "status": "error", "code": "invalid_arguments", "message": "Usage: python3 transcribe.py <input_audio_file> <output_json_file> <model_name>" }), file=sys.stderr, flush=True)
        sys.exit(1)
    
    audio_file_path_arg = sys.argv[1]
    output_json_path_arg = sys.argv[2]
    model_name_arg = sys.argv[3]

    if not os.path.isfile(audio_file_path_arg):
        print(json.dumps({ "status": "error", "code": "file_not_found", "message": f"Input audio file not found: {audio_file_path_arg}" }), file=sys.stderr, flush=True)
        sys.exit(1)
        
    transcribe_audio(audio_file_path_arg, output_json_path_arg, model_name_arg)
