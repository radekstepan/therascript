import { z } from 'zod';

export const transcriptionJobSchema = z.object({
  sessionId: z.number().int().positive(),
});

export type TranscriptionJob = z.infer<typeof transcriptionJobSchema>;
