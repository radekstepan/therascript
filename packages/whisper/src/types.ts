// packages/whisper/src/types.ts

// The result object from a successful transcription.
export interface TranscriptionResult {
  text: string;
  segments: any[]; // Can be defined more strictly if needed
  language: string;
}

// The possible states a transcription job can be in.
export type JobStatusState =
  | 'queued'
  | 'model_loading'
  | 'model_downloading'
  | 'processing'
  | 'transcribing'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'canceling';

// The full status object for a transcription job.
export interface JobStatus {
  job_id: string;
  status: JobStatusState;
  progress: number;
  duration: number | null;
  result: TranscriptionResult | null;
  error: string | null;
  start_time: number | null;
  end_time: number | null;
  message: string | null;
}
