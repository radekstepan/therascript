import { z } from 'zod';

export const messageSchema = z.object({
  id: z.number().int().positive(),
  chatId: z.number().int().positive(),
  sender: z.enum(['user', 'ai', 'system']),
  text: z.string(),
  timestamp: z.number().int().nonnegative(),
  promptTokens: z.number().nullable(),
  completionTokens: z.number().nullable(),
});

export type MessageRow = z.infer<typeof messageSchema>;
