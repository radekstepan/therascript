import { z } from 'zod';

export const renameChatRequestSchema = z.object({
  name: z.string().max(200, 'Chat name too long').nullable().optional(),
  tags: z
    .array(z.string().min(1).max(50))
    .max(10, 'Cannot have more than 10 tags')
    .nullable()
    .optional(),
});

export type RenameChatRequest = z.infer<typeof renameChatRequestSchema>;
