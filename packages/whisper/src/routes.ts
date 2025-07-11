// packages/whisper/src/routes.ts
import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import {
  createJob,
  getJob,
  cancelJob,
  runTranscriptionProcess,
} from './jobManager.js';

// --- Configuration ---
const TEMP_INPUT_DIR = process.env.TEMP_INPUT_DIR || '/app/temp_inputs';
const TEMP_OUTPUT_DIR = process.env.TEMP_OUTPUT_DIR || '/app/temp_outputs';

// --- Multer Setup for File Uploads ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, TEMP_INPUT_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(
      null,
      file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname)
    );
  },
});
const upload = multer({ storage });

// FIX (TS2345): Create a wrapper for the multer middleware.
const uploadMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const uploader = upload.single('file');
  // Cast `req` and `res` to `any` ONLY for this specific call to the uploader.
  // This resolves the deep type conflict between express and multer's dependencies.
  uploader(req as any, res as any, (err: any) => {
    if (err) {
      console.error('Multer error:', err);
      // Handle potential multer errors, e.g., file size limit.
      if (err instanceof multer.MulterError) {
        return res
          .status(400)
          .json({ error: `File upload error: ${err.message}` });
      }
      return res
        .status(500)
        .json({ error: 'An unknown file upload error occurred.' });
    }
    next();
  });
};

// --- Router Definition ---
const router = Router();

router.post(
  '/transcribe',
  // Use the new middleware wrapper
  uploadMiddleware,
  async (req: Request, res: Response) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }
    const model_name = req.body.model_name || 'tiny';
    const job_id = uuidv4();
    const input_path = req.file.path;
    const output_path = path.join(TEMP_OUTPUT_DIR, `${job_id}.json`);

    createJob(job_id);

    // This remains correct for a fire-and-forget background task.
    try {
      runTranscriptionProcess(job_id, input_path, output_path, model_name);
    } catch (err: unknown) {
      console.error(
        `[Transcribe Endpoint] Failed to initiate process for job ${job_id}:`,
        err
      );
      const job = getJob(job_id);
      if (job) {
        job.status = 'failed';
        job.error =
          'An unexpected error occurred while starting the background task.';
      }
    }

    console.log(
      `Queued job ${job_id} for file ${req.file.originalname} with model '${model_name}'`
    );
    res.status(202).json({ job_id, message: 'Transcription job queued.' });
  }
);

router.get('/status/:job_id', (req: Request, res: Response) => {
  const job_id = req.params.job_id;
  const job = getJob(job_id);
  if (!job) {
    return res.status(404).json({ error: 'Job ID not found' });
  }
  res.status(200).json(job);
});

router.post('/cancel/:job_id', (req: Request, res: Response) => {
  const job_id = req.params.job_id;
  const result = cancelJob(job_id);

  if (!result.success && result.message === 'Job ID not found') {
    return res.status(404).json({ error: result.message });
  }
  res.status(200).json({ job_id, message: result.message });
});

router.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'healthy' });
});

router.get('/', (req: Request, res: Response) => {
  res.status(200).json({ message: 'Whisper Transcription Service running.' });
});

export default router;
