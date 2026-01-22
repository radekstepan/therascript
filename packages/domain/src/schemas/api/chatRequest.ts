import { z } from 'zod';

export const chatRequestSchema = z.object({
  text: z
    .string()
    .min(1, 'Message text is required')
    .max(10000, 'Message text too long'),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;
