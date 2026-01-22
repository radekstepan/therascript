import { z } from 'zod';

export const templateSchema = z.object({
  id: z.number().int().positive(),
  title: z.string().min(1),
  text: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
});

export type TemplateRow = z.infer<typeof templateSchema>;
