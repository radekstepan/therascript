import { z } from 'zod';

export const transcriptSchema = z.object({
  id: z.number().int().positive(),
  sessionId: z.number().int().positive(),
  paragraphIndex: z.number().int().nonnegative(),
  timestampMs: z.number().int().nonnegative(),
  text: z.string(),
});

export type TranscriptRow = z.infer<typeof transcriptSchema>;
