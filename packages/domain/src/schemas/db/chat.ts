import { z } from 'zod';

export const chatSchema = z.object({
  id: z.number().int().positive(),
  sessionId: z.number().nullable(),
  timestamp: z.number().int().nonnegative(),
  name: z.string().nullable(),
  tags: z.array(z.string()).nullable(),
});

export type ChatRow = z.infer<typeof chatSchema>;
