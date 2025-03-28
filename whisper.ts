import { spawn, ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { exec } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";

interface JobConfig {
  audioFile: string;
  modelName: string;
  outputDir: string;
}

interface JobStatus {
  status: "info" | "loading" | "started" | "progress" | "completed" | "canceled" | "error";
  message?: string;
  progress?: number;
  duration?: number;
  result?: any;
}

interface JobHandle {
  promise: Promise<string>;
  cancel: () => void;
  onStatus: (callback: (status: JobStatus) => void) => void;
}

class WhisperAPI {
  private readonly cidFile: string = "container_id.txt";

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

  public async startJob({ audioFile, modelName, outputDir }: JobConfig): Promise<JobHandle> {
    if (!audioFile || !modelName || !outputDir) {
      throw new Error("Missing required arguments: audioFile, modelName, or outputDir");
    }

    const audioPath: string = resolve(audioFile);
    const outputPath: string = resolve(outputDir);
    const cachePath: string = resolve("./whisper/models");

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

    const args = [
      "run", "--gpus", "all", "--init", "--rm", "--cidfile", "container_id.txt",
      "-v", `${audioPath}:/input.mp3`,
      "-v", `${outputPath}:/app/output`,
      "-v", `${cachePath}:/root/.cache`,
      "therascript/whisper",
      "/input.mp3", modelName, "/app/output"
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
          if (status.status === "info" && status.duration) {
            audioDuration = status.duration;
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
      console.error("STDERR:", data.toString("utf8").trim());
    });

    const promise: Promise<string> = new Promise((resolve, reject) => {
      process.on("close", (code: number | null) => {
        if (existsSync(this.cidFile)) {
          unlinkSync(this.cidFile); // Clean up after completion
        }
        if (code === 0) resolve(outputData);
        else reject(new Error(`Exited with code ${code}`));
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
    const { promise, cancel, onStatus } = await api.startJob({
      audioFile: "/home/radek/dev/therascript/whisper/demo/session.mp3",
      modelName: "tiny",
      outputDir: "/home/radek/dev/therascript/whisper/output",
    });

    onStatus((status: JobStatus) => {
      switch (status.status) {
        case "info":
          console.log(`Audio duration: ${status.duration}s`);
          break;
        case "loading":
          console.log("Model is loading...");
          break;
        case "progress":
          console.log(`Transcription progress: ${status.progress}%`);
          break;
        case "completed":
          console.log("Transcription done!");
          break;
        case "canceled":
          console.log("Job was canceled.");
          break;
        case "error":
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
