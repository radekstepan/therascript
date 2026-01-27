import os
import sys
import json
import signal
import subprocess
from faster_whisper import WhisperModel
import time

# Global State
should_exit = False
last_progress_report_time = 0
progress_report_interval = 1

# Signal Handling
def signal_handler(sig, frame):
    global should_exit
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

    print(json.dumps({"status": "info", "message": "transcribe.py script started."}), flush=True)

    try:
        output_dir = os.path.dirname(output_file)
        if output_dir: os.makedirs(output_dir, exist_ok=True)

        print(json.dumps({"status": "processing", "message": "Fetching audio duration..."}), flush=True)
        duration = get_audio_duration(file_path)
        if should_exit: return
        if duration <= 0:
            raise ValueError("Could not determine audio duration or audio is empty.")
        print(json.dumps({"status": "info", "code": "audio_duration", "message": f"{duration:.2f}"}), flush=True)

        # Detect Hardware
        # faster-whisper handles CUDA/CPU automatically, but we can be explicit
        try:
            import torch
            device = "cuda" if torch.cuda.is_available() else "cpu"
        except ImportError:
            device = "cpu"

        if device == "cpu":
            print(json.dumps({"status": "info", "code": "cpu_detected", "message": "Using CPU for transcription."}), flush=True)
        else:
            try:
                gpu_name = torch.cuda.get_device_name(0)
                print(json.dumps({"status": "info", "code": "cuda_available", "message": f"Using CUDA GPU: {gpu_name}"}), flush=True)
            except:
                print(json.dumps({"status": "info", "code": "cuda_available", "message": "Using CUDA GPU"}), flush=True)

        if should_exit: return

        # On CPU (Mac Docker), int8 is faster. On GPU, float16 is standard.
        compute_type = "float16" if device == "cuda" else "int8"

        print(json.dumps({"status": "model_loading", "message": f"Loading {model_name} on {device} ({compute_type})..."}), flush=True)

        model = WhisperModel(model_name, device=device, compute_type=compute_type)

        print(json.dumps({"status": "loading_complete", "message": "Model loaded."}), flush=True)

        if should_exit:
            print(json.dumps({"status": "canceled", "message": "Canceled after model load attempt."}), flush=True)
            return

        print(json.dumps({"status": "transcribing", "message": "Processing audio..."}), flush=True)

        # Transcribe
        # faster-whisper returns a generator. We must iterate to process.
        segments, info = model.transcribe(file_path, beam_size=5)

        segment_list = []
        for segment in segments:
            if should_exit:
                print(json.dumps({"status": "canceled", "message": "Canceled during transcription processing."}), flush=True)
                return
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
            "message": f"Transcription completed. Output saved to: {os.path.basename(output_file)}",
            "result_summary": {
                "language": info.language,
                "segment_count": len(segment_list),
                "text_length": len(result["text"])
            }
        }), flush=True)

    except RuntimeError as e:
        err_code = "runtime_error"
        if "CUDA" in str(e) or "tensorrt" in str(e).lower() or "HIP" in str(e):
            err_code = "gpu_error"
        print(json.dumps({ "status": "error", "code": err_code, "message": str(e)}), file=sys.stderr, flush=True)
        sys.exit(1)
    except ValueError as e:
        print(json.dumps({ "status": "error", "code": "audio_error", "message": str(e)}), file=sys.stderr, flush=True)
        sys.exit(1)
    except Exception as e:
        print(json.dumps({ "status": "error", "code": "unknown_error", "message": f"An unexpected error occurred: {str(e)}"}), file=sys.stderr, flush=True)
        sys.exit(1)

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
