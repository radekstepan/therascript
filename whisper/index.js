const WhisperRunner = require("./whisperRunner");
const path = require("path");
const argv = require("minimist")(process.argv.slice(2));

// Parse command-line arguments
const audioFile = argv.file ? path.resolve(argv.file) : path.resolve(__dirname, "session.mp3");
const modelName = argv.model || "medium";
const outputDir = argv.output ? path.resolve(argv.output) : path.resolve(__dirname, "output");

// Instantiate the runner
const runner = new WhisperRunner();

// Run a job and handle it
async function main() {
  console.log("Starting transcription job...");
  const { promise, cancel } = runner.runJob({ audioFile, modelName, outputDir });

  // setTimeout(() => {
  //   cancel();
  // }, 5000);

  try {
    const result = await promise;
    console.log("Transcription completed successfully");
  } catch (err) {
    console.error("Transcription failed:", err.message);
  }
}

main();
