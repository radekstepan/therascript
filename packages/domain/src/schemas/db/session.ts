import { z } from 'zod';

export const sessionSchema = z.object({
  id: z.number().int().positive(),
  fileName: z.string().min(1),
  clientName: z.string(),
  sessionName: z.string(),
  date: z.string(),
  sessionType: z.string(),
  therapy: z.string(),
  audioPath: z.string().nullable(),
  status: z.enum(['pending', 'queued', 'transcribing', 'completed', 'failed']),
  whisperJobId: z.string().nullable(),
  transcriptTokenCount: z.number().nullable(),
  chats: z
    .array(
      z.object({
        id: z.number().int().positive(),
        sessionId: z.number().int().positive(),
        timestamp: z.number().int().nonnegative(),
        name: z.string().nullable(),
      })
    )
    .optional(),
});

export type SessionRow = z.infer<typeof sessionSchema>;
