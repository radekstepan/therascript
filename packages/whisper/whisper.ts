import { spawn, ChildProcess } from "node:child_process";
import { basename, dirname, resolve } from "node:path";
import { exec } from "node:child_process";
import { mkdirSync, existsSync, readFileSync, unlinkSync } from "node:fs";

interface JobConfig {
  audioFile: string;
  outputFile: string;
  modelName: string;
}

interface JobStatus {
  status: "info" | "loading" | "started" | "progress" | "completed" | "canceled" | "error";
  code?: string;
  message?: string;
  progress?: number;
  result?: any;
}

interface JobHandle {
  promise: Promise<string>;
  cancel: () => void;
  onStatus: (callback: (status: JobStatus) => void) => void;
}

class WhisperAPI {
  private readonly cidFile: string = "container_id.txt";
  private gpuErrorDetected: boolean = false;

  private isContainerRunning(containerId: string): Promise<boolean> {
    return new Promise((resolve) => {
      exec(`docker ps -q --filter "id=${containerId}"`, (err, stdout) => {
        if (err) {
          console.error("Error checking container status:", err.message);
          resolve(false);
        } else {
          resolve(stdout.trim().length > 0);
        }
      });
    });
  }

  private stopExistingContainer(containerId: string): Promise<void> {
    return new Promise((resolve) => {
      exec(`docker stop ${containerId}`, (err) => {
        if (err) {
          console.error("Failed to stop existing container:", err.message);
          resolve(); // Continue even if stop fails (container might already be stopped)
        } else {
          console.log(`Stopped existing container: ${containerId}`);
          resolve();
        }
      });
    });
  }

  public async startJob({ audioFile, outputFile, modelName }: JobConfig): Promise<JobHandle> {
    this.gpuErrorDetected = false;

    if (!audioFile || !outputFile || !modelName) {
      throw new Error("Missing required arguments: audioFile, outputFile, or modelName");
    }

    const audioPath: string = resolve(audioFile);
    const outputPath: string = resolve(outputFile);
    const cachePath: string = resolve("./models");

    const outputDirOnHost = dirname(outputPath);
    if (outputDirOnHost && !existsSync(outputDirOnHost)) {
        console.log(`Creating output directory on host: ${outputDirOnHost}`);
        mkdirSync(outputDirOnHost, { recursive: true });
    }

    // Check for existing container_id.txt and clean up if necessary
    if (existsSync(this.cidFile)) {
      const existingContainerId = readFileSync(this.cidFile, "utf8").trim();
      console.log(`Found existing container ID file with ID: ${existingContainerId}`);
      const isRunning = await this.isContainerRunning(existingContainerId);
      if (isRunning) {
        await this.stopExistingContainer(existingContainerId);
      }
      console.log("Removing old container_id.txt...");
      unlinkSync(this.cidFile);
    }

    const outputFilenameInContainer = basename(outputPath);
    const outputDirMountPath = "/app/output"; // Target directory *inside* container

    const args = [
      "run", "--gpus", "all", "--init", "--rm", "--cidfile", "container_id.txt",
      "-v", `${audioPath}:/input.mp3`,
      "-v", `${outputDirOnHost}:${outputDirMountPath}`,
      "-v", `${cachePath}:/root/.cache`,
      "therascript/whisper",
      "/input.mp3",
      `${outputDirMountPath}/${outputFilenameInContainer}`,
      modelName
    ];

    const process: ChildProcess = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    let outputData: string = "";
    const statusCallbacks: ((status: JobStatus) => void)[] = [];
    let audioDuration: number = 0;
    let containerId: string | null = null;

    // Read container ID after a delay
    setTimeout(() => {
      try {
        containerId = readFileSync(this.cidFile, "utf8").trim();
        console.log(`Container ID captured: ${containerId}`);
      } catch (e) {
        console.error("Failed to read container ID:", e);
      }
    }, 1000);

    const parseVerboseLine = (line: string): JobStatus | null => {
      const match = line.match(/\[(\d+:\d+\.\d+) --> (\d+:\d+\.\d+)\]/);
      if (match && audioDuration > 0) {
        const endTime = parseTime(match[2]);
        const progress = Math.min((endTime / audioDuration) * 100, 100);
        return { status: "progress", progress: Math.round(progress * 100) / 100 };
      }
      return null;
    };

    const parseTime = (timeStr: string): number => {
      const [minutes, seconds] = timeStr.split(":").map(parseFloat);
      return minutes * 60 + seconds;
    };

    process.stdout?.on("data", (data: Buffer) => {
      const text = data.toString("utf8");
      outputData += text;
      const lines = text.split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const status: JobStatus = JSON.parse(line);
          if (status.status === "info" && status.code === "audio_duration" && status.message?.length) {
            audioDuration = parseInt(status.message, 10);
          }
          statusCallbacks.forEach((cb) => cb(status));
        } catch (e) {
          const progressStatus = parseVerboseLine(line);
          if (progressStatus) {
            statusCallbacks.forEach((cb) => cb(progressStatus));
          } else {
            console.log("Raw output:", line.trim());
          }
        }
      }
    });

    process.stderr?.on("data", (data: Buffer) => {
      const errorText = data.toString("utf8").trim();
    
      // Attempt to parse the error text as JSON
      try {
        const errorStatus: JobStatus = JSON.parse(errorText);
        if (errorStatus.status === "error") {
          // If it's the specific GPU error, set the flag
          if (errorStatus.code === "cuda_not_available") {
            this.gpuErrorDetected = true;
            return;
          }
          // Emit the specific error status through callbacks
          statusCallbacks.forEach((cb) => cb(errorStatus));
        }
      } catch (e) {
        // If it's not JSON, ignore the parsing error (it's just regular stderr output)
      }

      console.error("STDERR:", errorText); // Keep logging raw stderr
    });

    const promise: Promise<string> = new Promise((resolve, reject) => {
      process.on("close", (code: number | null) => {
        if (existsSync(this.cidFile)) {
          unlinkSync(this.cidFile); // Clean up after completion
        }
        if (code === 0) {
          resolve(outputData);
        } else if (this.gpuErrorDetected) {
          reject(new Error("CUDA (GPU) is not available"));
        } else {
          reject(new Error(`Exited with code ${code}`));
        }
      });
    });

    const cancel = async (): Promise<void> => {
      if (process && !process.killed) {
        console.log("Attempting to cancel job...");
        if (containerId) {
          const running = await this.isContainerRunning(containerId);
          if (running) {
            await this.stopExistingContainer(containerId);
          } else {
            console.log("Container is not running, no action needed");
          }
        } else {
          console.log("Container ID not yet available, killing process directly...");
          process.kill("SIGTERM");
          setTimeout(() => {
            if (!process.killed) {
              console.log("Forcing kill with SIGKILL...");
              process.kill("SIGKILL");
            }
          }, 2000);
        }
      } else {
        console.log("Job already completed or not running");
      }
    };

    const onStatus = (callback: (status: JobStatus) => void): void => {
      statusCallbacks.push(callback);
    };

    return { promise, cancel, onStatus };
  }
}

const demo = async () => {
  // Example usage
  try {
    const api = new WhisperAPI();

    // Path relative from project root (where whisper.ts is) to the demo audio file
    const relativeAudioPath = "demo/session.mp3";
    // Path relative from project root to the desired output file
    const relativeOutputPath = "output/transcript.json";

    const {promise, cancel, onStatus} = await api.startJob({
      audioFile: resolve(__dirname, relativeAudioPath),
      outputFile: resolve(__dirname, relativeOutputPath),
      modelName: "tiny",
    });

    onStatus((status: JobStatus) => {
      switch (true) {
        case status.status === "info" && status.code === "audio_duration":
          console.log(`Audio duration: ${status.message}s`);
          break;
        case status.status === "info" && status.code === "cuda_available":
          console.log(`CUDA (GPU) is available: ${status.message}`);
          break;
        case status.status === "info":
          console.log(status.message);
          break;
        case status.status === "loading":
          console.log("Model is loading...");
          break;
        case status.status === "progress":
          console.log(`Transcription progress: ${status.progress}%`);
          break;
        case status.status === "completed":
          console.log("Transcription done!");
          break;
        case status.status === "canceled":
          console.log("Job was canceled.");
          break;
        case status.status === "error":
          console.error("Error:", status.message);
          break;
      }
    });

    promise.catch((err: Error) => console.error("Error:", err.message));

    // setTimeout(() => cancel(), 30000); // Test cancellation
  } catch (error) {
    console.error("Failed to start job:", (error as Error).message);
  }
}

demo();
