import os
import sys
import json
import signal
import subprocess
import whisper

# Global flag for cancellation
should_exit = False

def signal_handler(sig, frame):
    global should_exit
    print(json.dumps({"status": "canceled", "message": "Received SIGTERM, shutting down gracefully"}), flush=True)
    should_exit = True

def get_audio_duration(file_path):
    """Get audio duration in seconds using ffprobe."""
    cmd = [
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", file_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    return float(result.stdout.strip()) if result.returncode == 0 else 0

def transcribe_audio(file_path, model_name, output_dir):
    global should_exit
    os.makedirs(output_dir, exist_ok=True)

    # Get audio duration
    duration = get_audio_duration(file_path)
    print(json.dumps({"status": "info", "duration": duration, "message": f"Audio duration: {duration}s"}), flush=True)

    # Notify model loading start
    print(json.dumps({"status": "loading", "message": f"Loading model: {model_name}"}), flush=True)
    model = whisper.load_model(model_name)
    
    # Notify transcription start
    print(json.dumps({"status": "started", "message": "Transcription started"}), flush=True)
    
    # Run transcription with verbose output
    result = model.transcribe(file_path, language="en", verbose=True)
    
    if should_exit:
        print(json.dumps({"status": "canceled", "message": "Transcription canceled"}), flush=True)
        sys.exit(1)
    
    # Save result
    output_file = os.path.join(output_dir, f"{os.path.splitext(os.path.basename(file_path))[0]}.json")
    with open(output_file, "w") as f:
        json.dump(result, f, indent=4)
    
    # Notify completion
    print(json.dumps({
        "status": "completed",
        "message": f"Transcription completed. Saved to: {output_file}",
    }), flush=True)

if __name__ == "__main__":
    signal.signal(signal.SIGTERM, signal_handler)
    
    if len(sys.argv) != 4:
        print(json.dumps({
            "status": "error",
            "message": "Please provide audio file path, model name, and output directory",
            "usage": "python3 transcribe.py <audio_file> <model_name> <output_dir>"
        }), file=sys.stderr, flush=True)
        sys.exit(1)
    
    audio_file = sys.argv[1]
    model_name = sys.argv[2]
    output_dir = sys.argv[3]
    
    if not os.path.isfile(audio_file):
        print(json.dumps({
            "status": "error",
            "message": f"Audio file '{audio_file}' not found"
        }), file=sys.stderr, flush=True)
        sys.exit(1)
    
    transcribe_audio(audio_file, model_name, output_dir)
