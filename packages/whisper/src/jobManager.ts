// packages/whisper/src/jobManager.ts
import { ChildProcess, spawn } from 'child_process';
import { existsSync } from 'fs';
import fs from 'fs/promises';
import { JobStatus } from './types.js';

const jobs = new Map<string, JobStatus>();
const processes = new Map<string, ChildProcess>();

function parseDurationString(durationStr: string): number {
  const match = durationStr.match(/(\d+(\.\d+)?)/);
  return match ? parseFloat(match[1]) : 0.0;
}

function parseWhisperTime(timeStr: string): number {
  const parts = timeStr.split(':');
  if (parts.length === 3) {
    return (
      parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2])
    );
  } else if (parts.length === 2) {
    return parseInt(parts[0]) * 60 + parseFloat(parts[1]);
  }
  console.warn(`[JobManager] Could not parse timestamp format: ${timeStr}`);
  return 0.0;
}

export function getJob(jobId: string): JobStatus | undefined {
  return jobs.get(jobId);
}

export function createJob(jobId: string): JobStatus {
  const newJob: JobStatus = {
    job_id: jobId,
    status: 'queued',
    progress: 0.0,
    message: 'Job queued.',
    duration: null,
    result: null,
    error: null,
    start_time: null,
    end_time: null,
  };
  jobs.set(jobId, newJob);
  return newJob;
}

export function cancelJob(jobId: string): {
  success: boolean;
  message: string;
} {
  const job = jobs.get(jobId);
  const process = processes.get(jobId);
  if (!job) {
    return { success: false, message: 'Job ID not found' };
  }
  const currentStatus = job.status;
  if (
    ['completed', 'failed', 'canceled', 'canceling'].includes(currentStatus)
  ) {
    return {
      success: false,
      message: `Job already in state: ${currentStatus}`,
    };
  }
  job.status = 'canceling';
  job.message = 'Cancellation requested by user. Attempting to stop process.';
  jobs.set(jobId, job);
  if (process && process.pid) {
    process.kill('SIGTERM');
    console.log(`[Cancel] Sent SIGTERM to process for job ${jobId}`);
    return {
      success: true,
      message: 'Cancellation request sent. Job will attempt to terminate.',
    };
  } else {
    job.status = 'canceled';
    job.message = 'Process not found, marking as canceled.';
    jobs.set(jobId, job);
    return {
      success: true,
      message: 'Process was not running, job marked as canceled.',
    };
  }
}

// FIX: Rewrite the entire function to be async and properly await stream completion.
export async function runTranscriptionProcess(
  job_id: string,
  input_path: string,
  output_path: string,
  model_name: string
): Promise<void> {
  const job = jobs.get(job_id);
  if (!job) {
    console.error(`[ProcessRunner] Job ${job_id} not found in map at start.`);
    return;
  }

  job.status = 'model_loading';
  job.message = `Initializing model '${model_name}'...`;
  job.start_time = Date.now();
  jobs.set(job_id, job);

  const cmd = 'python3';
  const args = ['-u', 'transcribe.py', input_path, output_path, model_name];
  const process = spawn(cmd, args);
  processes.set(job_id, process);
  console.log(
    `[ProcessRunner] Job ${job_id}: Subprocess started (PID: ${process.pid}).`
  );

  const progressRegex =
    /^\[(\d{1,2}:\d{2}\.\d{3})\s*-->\s*(\d{1,2}:\d{2}\.\d{3})\]/;

  const streamClosedPromises = [];

  if (process.stdout) {
    const stdoutPromise = new Promise<void>((resolve) => {
      process.stdout.on('data', (data: Buffer) => {
        const lines = data
          .toString()
          .split('\n')
          .filter((line) => line.trim());
        for (const line of lines) {
          console.log(`[Job ${job_id} STDOUT]: ${line}`);
          try {
            const statusUpdate = JSON.parse(line);
            const currentJob = jobs.get(job_id);
            if (!currentJob) continue;

            // ==========================================================
            // CHANGE START: Prevent premature 'completed' status update
            // ==========================================================
            if (statusUpdate.status && statusUpdate.status !== 'completed') {
              currentJob.status = statusUpdate.status;
            }
            // ==========================================================
            // CHANGE END
            // ==========================================================

            if (statusUpdate.message) currentJob.message = statusUpdate.message;
            if (statusUpdate.progress)
              currentJob.progress = statusUpdate.progress;
            if (
              statusUpdate.status === 'info' &&
              statusUpdate.code === 'audio_duration'
            ) {
              currentJob.duration = parseDurationString(
                statusUpdate.message || ''
              );
            } else if (statusUpdate.status === 'error') {
              currentJob.status = 'failed';
              currentJob.error = statusUpdate.message || 'Error from script.';
              if (process.pid) process.kill();
            }
          } catch (e) {
            const match = line.match(progressRegex);
            const currentJob = jobs.get(job_id);
            if (match && currentJob && currentJob.duration) {
              const endTimeStr = match[2];
              const currentTimestamp = parseWhisperTime(endTimeStr);
              const progressVal = Math.min(
                (currentTimestamp / currentJob.duration) * 100,
                100
              );
              if (progressVal > (currentJob.progress || 0)) {
                currentJob.status = 'transcribing';
                currentJob.progress = parseFloat(progressVal.toFixed(2));
                currentJob.message = `Transcribing: ${line.split(']')[0].trim()}]`;
              }
            }
          }
        }
      });
      process.stdout.on('end', resolve);
    });
    streamClosedPromises.push(stdoutPromise);
  }

  if (process.stderr) {
    const stderrPromise = new Promise<void>((resolve) => {
      process.stderr.on('data', (data: Buffer) => {
        const line = data.toString().trim();
        console.log(`[Job ${job_id} STDERR]: ${line}`);
        const currentJob = jobs.get(job_id);
        if (
          currentJob &&
          (currentJob.status === 'model_loading' ||
            currentJob.status === 'model_downloading')
        ) {
          if (line.includes('downloading') || line.includes('%')) {
            currentJob.status = 'model_downloading';
            currentJob.message = `Model download: ${line.substring(0, 150)}`;
          }
        }
      });
      process.stderr.on('end', resolve);
    });
    streamClosedPromises.push(stderrPromise);
  }

  const exitPromise = new Promise<number | null>((resolve) => {
    process.on('exit', (code) => resolve(code));
    process.on('error', (err) => {
      console.error(
        `[ProcessRunner] Failed to start subprocess for job ${job_id}:`,
        err
      );
      const currentJob = jobs.get(job_id);
      if (currentJob) {
        currentJob.status = 'failed';
        currentJob.error = `Failed to start process: ${err.message}`;
      }
      resolve(null); // Resolve with null on spawn error
    });
  });

  // Wait for streams to close *and* for the process to exit.
  const [exitCode] = await Promise.all([exitPromise, ...streamClosedPromises]);

  console.log(
    `[ProcessRunner] Job ${job_id}: All streams closed. Process exited with code ${exitCode}.`
  );
  const finalJobState = jobs.get(job_id);
  if (!finalJobState) return;

  // ==========================================================
  // CHANGE START: Update final job state logic
  // ==========================================================
  if (exitCode === 0) {
    try {
      if (existsSync(output_path)) {
        const resultData = await fs.readFile(output_path, 'utf-8');
        finalJobState.result = JSON.parse(resultData);
        finalJobState.progress = 100;
        finalJobState.status = 'completed'; // Set status to 'completed' ONLY after result is attached
        finalJobState.message = 'Transcription and result processing complete.';
      } else {
        throw new Error('Output file not found after successful exit.');
      }
    } catch (err: any) {
      finalJobState.status = 'failed';
      finalJobState.error = `Failed to read or parse result file: ${err.message}`;
    }
  } else if (
    finalJobState.status !== 'canceled' &&
    finalJobState.status !== 'failed'
  ) {
    finalJobState.status = 'failed';
    finalJobState.error = `Process exited with code: ${exitCode ?? 'unknown'}. The final status was '${finalJobState.status}'.`;
  }
  // ==========================================================
  // CHANGE END
  // ==========================================================

  finalJobState.end_time = Date.now();
  processes.delete(job_id);

  try {
    if (existsSync(input_path)) await fs.unlink(input_path);
    if (
      (finalJobState.status === 'completed' ||
        finalJobState.status === 'canceled') &&
      existsSync(output_path)
    ) {
      await fs.unlink(output_path);
    }
  } catch (cleanupError) {
    console.error(
      `[ProcessRunner] Job ${job_id}: Error during file cleanup:`,
      cleanupError
    );
  }
}
