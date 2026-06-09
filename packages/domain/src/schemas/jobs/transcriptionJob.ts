import { z } from 'zod';

export const transcriptionJobSchema = z.object({
  sessionId: z.number().int().positive(),
  // 0 = diarization disabled; >=2 = speaker count. 1 is treated as disabled (nonsensical).
  numSpeakers: z.number().int().min(0).max(10).default(0),
});

export type TranscriptionJob = z.infer<typeof transcriptionJobSchema>;
