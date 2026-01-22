import { z } from 'zod';

export const createTemplateSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
  text: z.string().min(1, 'Text is required').max(10000, 'Text too long'),
});

export const updateTemplateSchema = createTemplateSchema;

export type CreateTemplateRequest = z.infer<typeof createTemplateSchema>;
export type UpdateTemplateRequest = z.infer<typeof updateTemplateSchema>;
