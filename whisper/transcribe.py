import os
import sys
import json
import whisper

def transcribe_audio(file_path, model_name, output_dir):
    os.makedirs(output_dir, exist_ok=True)
    print(f"Loading model: {model_name}", flush=True)
    model = whisper.load_model(model_name)
    print("Transcription started...", flush=True)
    result = model.transcribe(file_path, verbose=True)
    output_file = os.path.join(output_dir, f"{os.path.splitext(os.path.basename(file_path))[0]}.json")
    with open(output_file, "w") as f:
        json.dump(result, f, indent=4)
    print(f"Transcription completed. Saved to: {output_file}", flush=True)
    print(json.dumps(result), flush=True)

if __name__ == "__main__":
    if len(sys.argv) != 4:
        print("Error: Please provide audio file path, model name, and output directory", file=sys.stderr)
        print("Usage: python3 transcribe.py <audio_file> <model_name> <output_dir>", file=sys.stderr)
        sys.exit(1)
    
    audio_file = sys.argv[1]
    model_name = sys.argv[2]
    output_dir = sys.argv[3]
    
    if not os.path.isfile(audio_file):
        print(f"Error: Audio file '{audio_file}' not found", file=sys.stderr)
        sys.exit(1)
    
    transcribe_audio(audio_file, model_name, output_dir)
