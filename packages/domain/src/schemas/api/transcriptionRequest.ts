import { z } from 'zod';

export const transcriptionRequestSchema = z.object({
  clientName: z.string().min(1, 'Client name is required'),
  sessionName: z.string().min(1, 'Session name is required'),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  sessionType: z.string().min(1, 'Session type is required'),
  therapy: z.string().min(1, 'Therapy type is required'),
});

export type TranscriptionRequest = z.infer<typeof transcriptionRequestSchema>;
