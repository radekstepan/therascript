import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs/promises';
import axios from 'axios';
import {
  createJob,
  getJob,
  cancelJob,
  submitTranscriptionJob,
  unloadModel,
  getModelStatus,
} from './jobManager.js';

const PYTHON_API_URL =
  process.env.WHISPER_PYTHON_URL || 'http://localhost:8001';

const TEMP_INPUT_DIR = process.env.TEMP_INPUT_DIR || '/app/temp_inputs';
const TEMP_OUTPUT_DIR = process.env.TEMP_OUTPUT_DIR || '/app/temp_outputs';

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

const uploadMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const uploader = upload.single('file');
  uploader(req as any, res as any, (err: any) => {
    if (err) {
      console.error('Multer error:', err);
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

const router = Router();

router.post(
  '/transcribe',
  uploadMiddleware,
  async (req: Request, res: Response) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }
    const model_name = req.body.model_name || 'tiny';
    const input_path = req.file.path;

    try {
      const job_id = await submitTranscriptionJob(input_path, model_name);

      console.log(
        `Queued job ${job_id} for file ${req.file.originalname} with model '${model_name}'`
      );
      res.status(202).json({ job_id, message: 'Transcription job queued.' });
    } catch (err: unknown) {
      console.error(
        `[Transcribe Endpoint] Failed to submit transcription:`,
        err
      );
      res.status(500).json({ error: 'Failed to submit transcription job' });
    } finally {
      try {
        await fs.unlink(input_path);
      } catch (unlinkErr) {
        console.warn(
          `[Transcribe Endpoint] Failed to delete temp file: ${input_path}`
        );
      }
    }
  }
);

router.get('/status/:job_id', async (req: Request, res: Response) => {
  const job_id = req.params.job_id;
  let job = getJob(job_id);

  if (!job) {
    try {
      const response = await axios.get(`${PYTHON_API_URL}/status/${job_id}`);
      return res.status(200).json(response.data);
    } catch {
      return res.status(404).json({ error: 'Job ID not found' });
    }
  }
  res.status(200).json(job);
});

router.post('/cancel/:job_id', async (req: Request, res: Response) => {
  const job_id = req.params.job_id;
  const result = await cancelJob(job_id);

  if (!result.success && result.message === 'Job ID not found') {
    return res.status(404).json({ error: result.message });
  }
  res.status(200).json({ job_id, message: result.message });
});

router.post('/model/unload', async (req: Request, res: Response) => {
  try {
    const result = await unloadModel();
    res.status(200).json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/model/status', async (req: Request, res: Response) => {
  try {
    const status = await getModelStatus();
    res.status(200).json(status);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'healthy' });
});

router.get('/ready', async (req: Request, res: Response) => {
  try {
    await axios.get(`${PYTHON_API_URL}/model/status`, { timeout: 5000 });
    res.status(200).json({ status: 'ready' });
  } catch (error: any) {
    console.error('[Ready Check] Python API not reachable:', error.message);
    res
      .status(503)
      .json({ status: 'not ready', reason: 'Python API not reachable' });
  }
});

router.get('/', (req: Request, res: Response) => {
  res.status(200).json({ message: 'Whisper Transcription Service running.' });
});

export default router;
