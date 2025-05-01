// NOTE: This file appears to contain an older, direct Docker execution approach
//       for running Whisper transcription. It seems **DEPRECATED** and **UNUSED**
//       in the current application structure, which uses a separate FastAPI
//       service (`server.py`) managed by Docker Compose (`../../docker-compose.yml`)
//       and interacted with by the backend API (`packages/api`).
//       Keeping the file for historical context or potential future use, but added warnings.

import { spawn, ChildProcess } from 'node:child_process';
import { basename, dirname, resolve } from 'node:path';
import { exec } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync, unlinkSync } from 'node:fs';

console.warn('--- WARNING: Executing deprecated whisper.ts script. ---');
console.warn(
  '--- This approach is likely not used by the main application. ---'
);
console.warn(
  '--- The primary interaction is via the FastAPI service (server.py) ---'
);

// --- (Original Interfaces and Class Definition Follow) ---

interface JobConfig {
  audioFile: string;
  outputFile: string;
  modelName: string;
}

interface JobStatus {
  status:
    | 'info'
    | 'loading'
    | 'started'
    | 'progress'
    | 'completed'
    | 'canceled'
    | 'error';
  code?: string;
  message?: string;
  progress?: number;
  result?: any; // Consider defining a more specific type for the Whisper result JSON
}

interface JobHandle {
  promise: Promise<string>; // Resolves with raw stdout on success
  cancel: () => void; // Function to attempt cancellation
  onStatus: (callback: (status: JobStatus) => void) => void; // Register status update callbacks
}

/**
 * @deprecated This class directly executes Whisper via `docker run`. The preferred method
 *             is interacting with the dedicated FastAPI service (`server.py`).
 */
class WhisperAPI {
  private readonly cidFile: string = 'container_id.txt'; // File to store container ID for cancellation
  private gpuErrorDetected: boolean = false; // Flag for specific CUDA errors

  /** Checks if a Docker container with the given ID is currently running. */
  private isContainerRunning(containerId: string): Promise<boolean> {
    return new Promise((resolve) => {
      // Execute `docker ps` filtered by the container ID
      exec(`docker ps -q --filter "id=${containerId}"`, (err, stdout) => {
        if (err) {
          console.error('Error checking container status:', err.message);
          resolve(false); // Assume not running on error
        } else {
          // If stdout is not empty, a container with that ID is running
          resolve(stdout.trim().length > 0);
        }
      });
    });
  }

  /** Attempts to stop a Docker container by ID. */
  private stopExistingContainer(containerId: string): Promise<void> {
    return new Promise((resolve) => {
      // Execute `docker stop`
      exec(`docker stop ${containerId}`, (err) => {
        if (err) {
          // Log error but resolve anyway, as the container might already be stopped.
          console.error('Failed to stop existing container:', err.message);
          resolve();
        } else {
          console.log(`Stopped existing container: ${containerId}`);
          resolve();
        }
      });
    });
  }

  /**
   * Starts a Whisper transcription job by directly running the `therascript/whisper` Docker image.
   * @deprecated Use the FastAPI service endpoint (`POST /transcribe`).
   */
  public async startJob({
    audioFile,
    outputFile,
    modelName,
  }: JobConfig): Promise<JobHandle> {
    console.warn(
      '[DEPRECATED] WhisperAPI.startJob called. Use API service instead.'
    );
    this.gpuErrorDetected = false;

    // Input validation
    if (!audioFile || !outputFile || !modelName) {
      throw new Error(
        'Missing required arguments: audioFile, outputFile, or modelName'
      );
    }

    // Resolve paths to absolute paths
    const audioPath: string = resolve(audioFile);
    const outputPath: string = resolve(outputFile);
    const cachePath: string = resolve('./models'); // Path for model cache volume

    // Ensure output directory exists on the host
    const outputDirOnHost = dirname(outputPath);
    if (outputDirOnHost && !existsSync(outputDirOnHost)) {
      console.log(`Creating output directory on host: ${outputDirOnHost}`);
      mkdirSync(outputDirOnHost, { recursive: true });
    }

    // --- Cleanup potentially stale container ID file ---
    if (existsSync(this.cidFile)) {
      const existingContainerId = readFileSync(this.cidFile, 'utf8').trim();
      console.log(
        `Found existing container ID file with ID: ${existingContainerId}`
      );
      const isRunning = await this.isContainerRunning(existingContainerId);
      if (isRunning) {
        console.log(
          `Stopping potentially stale container: ${existingContainerId}`
        );
        await this.stopExistingContainer(existingContainerId);
      }
      console.log('Removing old container_id.txt...');
      try {
        unlinkSync(this.cidFile);
      } catch (e) {
        console.warn('Failed to remove cidfile:', e);
      }
    }
    // --- End Cleanup ---

    // --- Construct Docker run arguments ---
    const outputFilenameInContainer = basename(outputPath);
    // Define where the output directory on the host will be mounted inside the container
    const outputDirMountPath = '/app/output';

    const args = [
      'run',
      '--gpus',
      'all', // Attempt to use all available GPUs
      '--init', // Use tini as init process for better signal handling
      '--rm', // Automatically remove container on exit
      '--cidfile',
      this.cidFile, // Write container ID to this file
      // Volume mounts:
      '-v',
      `${audioPath}:/input.mp3:ro`, // Mount audio file read-only
      '-v',
      `${outputDirOnHost}:${outputDirMountPath}`, // Mount host output dir to container output dir
      '-v',
      `${cachePath}:/root/.cache`, // Mount host cache dir to container cache dir
      'therascript/whisper', // The Docker image to run
      // Arguments passed to the container's entry point (transcribe.py):
      '/input.mp3', // Input file path inside container
      `${outputDirMountPath}/${outputFilenameInContainer}`, // Output file path inside container
      modelName, // Whisper model name (e.g., "tiny", "base", "large")
    ];
    // --- End Docker run arguments ---

    // --- Spawn Docker Process ---
    console.log(`Spawning Docker command: docker ${args.join(' ')}`);
    const process: ChildProcess = spawn('docker', args, {
      stdio: ['ignore', 'pipe', 'pipe'], // Ignore stdin, pipe stdout/stderr
    });
    // --- End Spawn Docker Process ---

    let outputData: string = ''; // Accumulate stdout
    const statusCallbacks: ((status: JobStatus) => void)[] = []; // Array for status listeners
    let audioDuration: number = 0; // Store parsed audio duration
    let containerId: string | null = null; // Store container ID when available

    // --- Read Container ID ---
    // Attempt to read the container ID shortly after spawning. Docker writes this file asynchronously.
    setTimeout(() => {
      try {
        if (existsSync(this.cidFile)) {
          containerId = readFileSync(this.cidFile, 'utf8').trim();
          console.log(`Container ID captured: ${containerId}`);
        } else {
          console.warn('Container ID file not found after 1s.');
        }
      } catch (e) {
        console.error('Failed to read container ID file:', e);
      }
    }, 1000); // Wait 1 second
    // --- End Read Container ID ---

    // --- Helper Functions for Parsing Output ---
    /** Parses Whisper's verbose progress lines (e.g., "[0:01.234 --> 0:05.678]"). */
    const parseVerboseLine = (line: string): JobStatus | null => {
      // Regex to capture start and end timestamps
      const match = line.match(
        /\[(\d{1,2}:\d{2}\.\d{3})\s*-->\s*(\d{1,2}:\d{2}\.\d{3})\]/
      );
      if (match && audioDuration > 0) {
        const endTimeSeconds = parseTime(match[2]); // Convert end timestamp string to seconds
        // Calculate progress percentage
        const progress = Math.min((endTimeSeconds / audioDuration) * 100, 100);
        return {
          status: 'progress',
          progress: Math.round(progress * 100) / 100,
        };
      }
      return null; // Return null if line doesn't match format or duration is unknown
    };

    /** Parses timestamp strings like "MM:SS.ms" or "H:MM:SS.ms" into seconds. */
    const parseTime = (timeStr: string): number => {
      const parts = timeStr.split(':').map(parseFloat);
      let seconds = 0;
      if (parts.length === 3) {
        // H:MM:SS.ms
        seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
      } else if (parts.length === 2) {
        // MM:SS.ms
        seconds = parts[0] * 60 + parts[1];
      } else {
        console.warn(`Could not parse time string format: ${timeStr}`);
      }
      return seconds;
    };
    // --- End Helper Functions ---

    // --- Process Output Handling ---
    /** Handle stdout data from the Docker process. */
    process.stdout?.on('data', (data: Buffer) => {
      const text = data.toString('utf8');
      outputData += text; // Accumulate raw stdout
      const lines = text.split('\n').filter(Boolean); // Split into lines

      for (const line of lines) {
        try {
          // Attempt to parse the line as JSON (transcribe.py outputs JSON status messages)
          const status: JobStatus = JSON.parse(line);
          // Handle specific info codes
          if (
            status.status === 'info' &&
            status.code === 'audio_duration' &&
            status.message?.length
          ) {
            audioDuration = parseInt(status.message, 10); // Store audio duration
          }
          // Notify all registered listeners with the parsed status
          statusCallbacks.forEach((cb) => cb(status));
        } catch (e) {
          // If JSON parsing fails, try parsing as Whisper's verbose progress line
          const progressStatus = parseVerboseLine(line);
          if (progressStatus) {
            statusCallbacks.forEach((cb) => cb(progressStatus)); // Notify listeners of progress
          } else {
            // Log any other non-JSON, non-progress output
            console.log('Raw Docker stdout:', line.trim());
          }
        }
      }
    });

    /** Handle stderr data from the Docker process. */
    process.stderr?.on('data', (data: Buffer) => {
      const errorText = data.toString('utf8').trim();

      // Attempt to parse stderr as JSON (transcribe.py might output JSON errors)
      try {
        const errorStatus: JobStatus = JSON.parse(errorText);
        if (errorStatus.status === 'error') {
          // Check for specific CUDA error code set by transcribe.py
          if (errorStatus.code === 'cuda_not_available') {
            console.error('GPU Error Detected via stderr JSON.');
            this.gpuErrorDetected = true;
            // Don't necessarily emit error status yet, wait for process exit?
            return; // Or emit immediately: statusCallbacks.forEach((cb) => cb(errorStatus));
          }
          // Emit other specific JSON error statuses
          statusCallbacks.forEach((cb) => cb(errorStatus));
        }
      } catch (e) {
        // Ignore JSON parsing errors for stderr - it might be regular Docker/Python error messages
      }
      // Always log raw stderr output for debugging
      console.error('Raw Docker stderr:', errorText);
    });
    // --- End Process Output Handling ---

    // --- Promise and Job Handle Creation ---
    /** Promise that resolves on successful completion, rejects on error. */
    const promise: Promise<string> = new Promise((resolve, reject) => {
      process.on('close', (code: number | null) => {
        // Clean up container ID file on process exit
        if (existsSync(this.cidFile)) {
          try {
            unlinkSync(this.cidFile);
          } catch (e) {
            console.warn('Failed to remove cidfile on close:', e);
          }
        }
        // Check exit code
        if (code === 0) {
          resolve(outputData); // Resolve with accumulated stdout on success
        } else if (this.gpuErrorDetected) {
          // Reject with specific GPU error if detected
          reject(new Error('CUDA (GPU) is not available or failed.'));
        } else {
          // Reject with generic error including exit code
          reject(new Error(`Whisper Docker process exited with code ${code}`));
        }
      });
      process.on('error', (err) => {
        // Handle errors spawning the process itself
        console.error('Error spawning Docker process:', err);
        if (existsSync(this.cidFile)) {
          // Cleanup cidfile on spawn error too
          try {
            unlinkSync(this.cidFile);
          } catch (e) {
            console.warn('Failed remove cidfile on spawn error:', e);
          }
        }
        reject(new Error(`Failed to start Docker process: ${err.message}`));
      });
    });

    /** Function to attempt cancellation of the running Docker container. */
    const cancel = async (): Promise<void> => {
      console.log('Attempting to cancel Whisper Docker job...');
      if (process && !process.killed) {
        // Check if the Node.js process object exists and isn't marked as killed
        if (containerId) {
          // If we captured the container ID
          console.log(`Stopping container ID: ${containerId}`);
          const running = await this.isContainerRunning(containerId);
          if (running) {
            await this.stopExistingContainer(containerId); // Use `docker stop`
          } else {
            console.log(
              'Container associated with job is not running (already stopped or removed).'
            );
          }
        } else {
          // Fallback if container ID wasn't read: try killing the Node.js spawn process directly.
          // This might not stop the container if Docker detached it.
          console.log(
            'Container ID not available. Attempting to kill spawn process...'
          );
          process.kill('SIGTERM'); // Send TERM signal first
          // Force kill if it doesn't terminate gracefully
          setTimeout(() => {
            if (process && !process.killed) {
              console.log('Forcing kill (SIGKILL) on spawn process...');
              process.kill('SIGKILL');
            }
          }, 2000); // Wait 2 seconds
        }
        // Notify listeners of cancellation attempt
        statusCallbacks.forEach((cb) =>
          cb({ status: 'canceled', message: 'Cancellation requested.' })
        );
      } else {
        console.log('Job process already completed or not running.');
      }
    };

    /** Function to register a callback for status updates. */
    const onStatus = (callback: (status: JobStatus) => void): void => {
      statusCallbacks.push(callback);
    };

    // Return the handle containing the promise, cancel function, and onStatus registration
    return { promise, cancel, onStatus };
    // --- End Promise and Job Handle Creation ---
  }
}

// --- Demo Usage (Example) ---
/** Function to demonstrate using the (deprecated) WhisperAPI class. */
const demo = async () => {
  console.warn('--- Running DEPRECATED WhisperAPI Demo ---');
  try {
    const api = new WhisperAPI();

    // Define relative paths from this script's location (__dirname)
    const relativeAudioPath = '../demo/session.mp3'; // Adjust if demo file location changes
    const relativeOutputPath = '../output/transcript_demo.json'; // Adjust output location

    // Resolve to absolute paths
    const audioFile = resolve(__dirname, relativeAudioPath);
    const outputFile = resolve(__dirname, relativeOutputPath);

    console.log(`Demo Input: ${audioFile}`);
    console.log(`Demo Output: ${outputFile}`);
    console.log(`Demo Model: tiny`);

    // Start the job
    const { promise, cancel, onStatus } = await api.startJob({
      audioFile: audioFile,
      outputFile: outputFile,
      modelName: 'tiny', // Use a small model for quick demo
    });

    // Register a status listener
    onStatus((status: JobStatus) => {
      // Log status updates based on their type/code
      switch (true) {
        case status.status === 'info' && status.code === 'audio_duration':
          console.log(`[Demo Status] Audio duration: ${status.message}s`);
          break;
        case status.status === 'info' && status.code === 'cuda_available':
          console.log(`[Demo Status] CUDA available: ${status.message}`);
          break;
        case status.status === 'info':
          console.log(`[Demo Status] Info: ${status.message}`);
          break;
        case status.status === 'loading':
          console.log('[Demo Status] Model loading...');
          break;
        case status.status === 'progress':
          console.log(`[Demo Status] Progress: ${status.progress}%`);
          break;
        case status.status === 'completed':
          console.log('[Demo Status] Transcription completed!');
          break;
        case status.status === 'canceled':
          console.log('[Demo Status] Job canceled.');
          break;
        case status.status === 'error':
          console.error(
            `[Demo Status] Error: ${status.message} (Code: ${status.code || 'N/A'})`
          );
          break;
        default:
          console.log('[Demo Status] Unknown status object:', status);
      }
    });

    // Handle promise resolution/rejection
    promise
      .then(() =>
        console.log(
          '[Demo Promise] Transcription successful (check output file).'
        )
      )
      .catch((err: Error) =>
        console.error('[Demo Promise] Transcription failed:', err.message)
      );

    // Optional: Uncomment to test cancellation after a delay
    // setTimeout(() => { console.log("[Demo] Requesting cancellation..."); cancel(); }, 15000); // Cancel after 15 seconds
  } catch (error) {
    console.error('[Demo] Failed to start job:', (error as Error).message);
  }
};

// Uncomment the line below to run the demo when executing this file directly
// demo();
// --- End Demo Usage ---
