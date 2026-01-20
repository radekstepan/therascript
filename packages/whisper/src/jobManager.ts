import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import { JobStatus } from './types.js';

const PYTHON_API_URL =
  process.env.WHISPER_PYTHON_URL || 'http://localhost:8001';

const jobs = new Map<string, JobStatus>();

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

export async function cancelJob(
  jobId: string
): Promise<{ success: boolean; message: string }> {
  try {
    const response = await axios.post(`${PYTHON_API_URL}/cancel/${jobId}`);
    const job = jobs.get(jobId);

    if (job && response.data.message === 'Cancellation request sent') {
      job.status = 'canceling';
      job.message = response.data.message;
    }

    return { success: true, message: response.data.message };
  } catch (error: any) {
    if (error.response?.status === 404) {
      return { success: false, message: 'Job ID not found' };
    }
    return { success: false, message: error.message };
  }
}

export async function submitTranscriptionJob(
  inputPath: string,
  modelName: string,
  maxRetries: number = 3
): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const form = new FormData();
      form.append('file', fs.createReadStream(inputPath));
      form.append('model_name', modelName);

      const response = await axios.post(`${PYTHON_API_URL}/transcribe`, form, {
        headers: form.getHeaders(),
        timeout: 5 * 60 * 1000,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });

      if (response.status !== 200 || !response.data.job_id) {
        throw new Error('Failed to submit job to Python Whisper service');
      }

      const jobId = response.data.job_id;
      createJob(jobId);

      pollJobStatus(jobId);

      return jobId;
    } catch (error: any) {
      lastError = error;
      if (error.code === 'ECONNREFUSED' && attempt < maxRetries - 1) {
        console.log(`[JobManager] Python API not ready, retrying in 2s...`);
        await new Promise((resolve) => setTimeout(resolve, 2000));
        continue;
      }
      throw error;
    }
  }

  throw lastError;
}

async function pollJobStatus(jobId: string): Promise<void> {
  const pollInterval = 2000;
  const maxConsecutiveErrors = 5;
  let consecutiveErrors = 0;

  while (true) {
    try {
      const response = await axios.get(`${PYTHON_API_URL}/status/${jobId}`);
      consecutiveErrors = 0;
      const status = response.data;

      const job = jobs.get(jobId);
      if (job) {
        job.status = status.status;
        job.progress = status.progress;
        job.message = status.message;
        job.duration = status.duration;
        job.result = status.result;
        job.error = status.error;
        job.start_time = status.start_time;
        job.end_time = status.end_time;
      }

      if (['completed', 'failed', 'canceled'].includes(status.status)) {
        break;
      }
    } catch (error: any) {
      consecutiveErrors++;
      console.error(`[JobManager] Error polling job ${jobId}:`, error.message);

      if (error.response?.status === 404) {
        const job = jobs.get(jobId);
        if (job) {
          job.status = 'failed';
          job.error = 'Job lost - transcription service restarted';
          job.end_time = Date.now();
        }
        break;
      }

      if (consecutiveErrors >= maxConsecutiveErrors) {
        const job = jobs.get(jobId);
        if (job) {
          job.status = 'failed';
          job.error = 'Lost connection to transcription service';
          job.end_time = Date.now();
        }
        break;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }
}

export async function unloadModel(): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    const response = await axios.post(`${PYTHON_API_URL}/model/unload`);
    return { success: true, message: response.data.message };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function getModelStatus(): Promise<any> {
  const response = await axios.get(`${PYTHON_API_URL}/model/status`);
  return response.data;
}
