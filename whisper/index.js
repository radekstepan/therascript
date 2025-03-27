const { spawn } = require("child_process");
const path = require("path");
const argv = require("minimist")(process.argv.slice(2));

// Configurable arguments with defaults
const audioFile = argv.file ? path.resolve(argv.file) : path.resolve(__dirname, "session.mp3");
const modelName = argv.model || "medium";
const outputDir = argv.output ? path.resolve(argv.output) : path.resolve(__dirname, "output");

// Path to Python script and virtualenv's Python binary
const pythonScript = path.resolve(__dirname, "transcribe.py");
const venvPython = path.resolve(__dirname, "env", "bin", "python3"); // Use virtualenv's Python

// Spawn Python process with virtualenv's Python
const pythonProcess = spawn(venvPython, [pythonScript, audioFile, modelName, outputDir], { shell: true });

// Accumulate stdout data
let outputData = "";

// Handle stdout (progress and result)
pythonProcess.stdout.on("data", (data) => {
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
      // Ignore partial JSON parsing errors until complete
    }
  }
});

// Handle stderr (errors)
pythonProcess.stderr.on("data", (data) => {
  console.error("[Error]:", data.toString());
});

// Handle process completion
pythonProcess.on("close", (code) => {
  if (code === 0) {
    console.log("[Completed]: Transcription finished successfully");
  } else {
    console.error("[Error]: Python process exited with code", code);
  }
});

// Handle spawn errors
pythonProcess.on("error", (err) => {
  console.error("[Spawn Error]:", err.message);
});
