import { z } from 'zod';

export const transcriptionJobSchema = z.object({
  sessionId: z.number().int().positive(),
  numSpeakers: z.number().int().positive().max(10).default(2).optional(),
});

export type TranscriptionJob = z.infer<typeof transcriptionJobSchema>;
