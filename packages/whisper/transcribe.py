import os
import sys
import json
import signal
import subprocess
import whisper
import torch
import time # For progress reporting

# Global flag for cancellation
should_exit = False
last_progress_report_time = 0
progress_report_interval = 2 # Report progress every 2 seconds

def signal_handler(sig, frame):
    global should_exit
    print(json.dumps({"status": "canceled", "message": "Received termination signal, shutting down gracefully"}), flush=True)
    should_exit = True

def get_audio_duration(file_path):
    """Get audio duration in seconds using ffprobe."""
    cmd = [
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", file_path
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        return float(result.stdout.strip()) if result.stdout.strip() else 0
    except subprocess.CalledProcessError as e:
        print(json.dumps({
            "status": "error",
            "code": "ffprobe_failed",
            "message": f"ffprobe failed: {e.stderr.strip()}"
        }), file=sys.stderr, flush=True)
        return 0
    except Exception as e:
        print(json.dumps({
            "status": "error",
            "code": "duration_error",
            "message": f"Error getting duration: {str(e)}"
        }), file=sys.stderr, flush=True)
        return 0

def progress_hook(seek: int, timestamp: float, overall_duration: float):
    """Callback hook for whisper progress."""
    global should_exit, last_progress_report_time, progress_report_interval
    if should_exit:
        # Raise an exception to stop whisper processing if canceled
        raise RuntimeError("Transcription canceled by signal")

    current_time = time.time()
    if overall_duration > 0 and (current_time - last_progress_report_time > progress_report_interval):
        progress = min((timestamp / overall_duration) * 100, 100)
        print(json.dumps({
            "status": "progress",
            "progress": round(progress, 2),
            "current_time": round(timestamp, 2),
            "total_duration": round(overall_duration, 2)
        }), flush=True)
        last_progress_report_time = current_time

def transcribe_audio(file_path, output_file, model_name):
    global should_exit, last_progress_report_time
    should_exit = False # Reset cancellation flag for new job
    last_progress_report_time = 0 # Reset progress report timer

    # Setup signal handling
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)

    try:
        output_dir = os.path.dirname(output_file)
        if output_dir:
            os.makedirs(output_dir, exist_ok=True)

        # Get audio duration
        duration = get_audio_duration(file_path)
        if duration == 0:
            # Error getting duration, already printed by get_audio_duration
             raise ValueError("Could not determine audio duration.")

        print(json.dumps({
            "status": "info",
            "code": "audio_duration",
            "message": f"Audio duration: {duration:.2f}s"
        }), flush=True)

        # Check GPU availability early
        if not torch.cuda.is_available():
            raise RuntimeError("CUDA (GPU) is not available.")
        else:
            gpu_name = torch.cuda.get_device_name(0)
            print(json.dumps({
                "status": "info",
                "code": "cuda_available",
                "message": f"Using GPU: {gpu_name}"
            }), flush=True)

        # Notify model loading start
        print(json.dumps({"status": "loading", "message": f"Loading model: {model_name}"}), flush=True)
        model = whisper.load_model(model_name)
        print(json.dumps({"status": "loading_complete", "message": "Model loaded"}), flush=True)

        # Notify transcription start
        print(json.dumps({"status": "started", "message": "Transcription started"}), flush=True)

        # Create the hook closure
        hook = lambda seek, timestamp: progress_hook(seek, timestamp, duration)

        # Run transcription with verbose=False (we handle progress) and hook
        # result = model.transcribe(file_path, language="en", verbose=False, progress_callback=hook)
        # NOTE: `progress_callback` is not an official argument for `transcribe`.
        # Whisper's `transcribe` itself logs progress if verbose=True. We parse that.
        # Let's stick to parsing the verbose output for now as it's more reliable.
        # Running with verbose=True for now to capture progress logs in the server.
        # The server.py `run_transcription_process` will parse these.
        result = model.transcribe(file_path, language="en", verbose=True)


        if should_exit:
            # This part might not be reached if the hook raises an exception
            print(json.dumps({"status": "canceled", "message": "Transcription canceled during processing"}), flush=True)
            return # Indicate cancellation happened

        # Save result
        with open(output_file, "w") as f:
            json.dump(result, f, indent=4)

        # Notify completion
        print(json.dumps({
            "status": "completed",
            "message": f"Transcription completed. Saved to: {output_file}",
            "result_summary": {
                "language": result.get("language"),
                "segment_count": len(result.get("segments", [])),
                "text_length": len(result.get("text", ""))
            }
        }), flush=True)

    except RuntimeError as e:
         # Handle specific errors like cancellation or CUDA issues
         if "Transcription canceled" in str(e):
              print(json.dumps({"status": "canceled", "message": "Transcription explicitly canceled"}), flush=True)
         elif "CUDA" in str(e):
            print(json.dumps({
                "status": "error",
                "code": "cuda_error",
                "message": str(e),
            }), file=sys.stderr, flush=True)
            sys.exit(1) # Exit if CUDA fails fundamentally
         else:
             print(json.dumps({
                "status": "error",
                "code": "runtime_error",
                "message": f"Runtime error during transcription: {str(e)}"
            }), file=sys.stderr, flush=True)

    except Exception as e:
        # Catch all other potential errors
        print(json.dumps({
            "status": "error",
            "code": "unknown_error",
            "message": f"Unexpected error during transcription: {str(e)}"
        }), file=sys.stderr, flush=True)


if __name__ == "__main__":
    if len(sys.argv) != 4:
        print(json.dumps({
            "status": "error",
            "code": "invalid_arguments",
            "message": "Please provide input audio file path, output file path, and model name",
            "usage": "python3 transcribe.py <input_audio_file> <output_file> <model_name>"
        }), file=sys.stderr, flush=True)
        sys.exit(1)

    audio_file = sys.argv[1]
    output_file = sys.argv[2]
    model_name = sys.argv[3]

    if not os.path.isfile(audio_file):
        print(json.dumps({
            "status": "error",
            "code": "file_not_found",
            "message": f"Audio file '{audio_file}' not found"
        }), file=sys.stderr, flush=True)
        sys.exit(1)

    transcribe_audio(audio_file, output_file, model_name)
