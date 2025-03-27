const { spawn } = require("child_process");
const path = require("path");

class WhisperRunner {
  constructor(pythonPath, scriptPath) {
    this.pythonPath = pythonPath || path.resolve(__dirname, "env", "bin", "python3");
    this.scriptPath = scriptPath || path.resolve(__dirname, "transcribe.py");
  }

  runJob({ audioFile, modelName, outputDir }) {
    const args = [this.scriptPath, audioFile, modelName, outputDir];
    const process = spawn(this.pythonPath, args); // Remove { shell: true }
    let outputData = "";
    let errorData = "";

    const promise = new Promise((resolve, reject) => {
      process.stdout.on("data", (data) => {
        const output = data.toString();
        outputData += output;

        if (output.includes("-->")) {
          console.log("[Progress]:", output.trim());
        } else if (output.includes("Loading model") || output.includes("Transcription started")) {
          console.log("[Status]:", output.trim());
        } else if (output.includes("Transcription completed")) {
          console.log("[Status]:", output.trim());
        } else {
          try {
            const result = JSON.parse(outputData.trim());
            if (result.text) {
              console.log("[Result]:", result.text);
              console.log("[Full JSON]:", result);
            }
          } catch (e) {
            // Ignore partial JSON parsing errors
          }
        }
      });

      process.stderr.on("data", (data) => {
        errorData += data.toString();
        console.error("[Error]:", data.toString());
      });

      process.on("close", (code) => {
        if (code === 0) {
          try {
            const result = JSON.parse(outputData.trim());
            resolve(result);
          } catch (e) {
            reject(new Error(`Failed to parse JSON output: ${e.message}\nOutput: ${outputData}`));
          }
        } else if (code !== null) {
          reject(new Error(`Process exited with code ${code}\nErrors: ${errorData}`));
        } else {
          reject(new Error("Process exited"));
        }
      });

      process.on("error", (err) => {
        reject(new Error(`Spawn Error: ${err.message}`));
      });
    });

    const cancel = () => {
      if (process && !process.killed) {
        process.kill("SIGKILL"); // Use SIGKILL for forceful termination
        console.log("[Canceled]: Job forcefully terminated");
      } else {
        console.log("[Canceled]: Job already completed or not running");
      }
    };

    return { promise, cancel };
  }
}

module.exports = WhisperRunner;
