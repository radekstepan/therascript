import { z } from 'zod';

export const analysisRequestSchema = z.object({
  sessionIds: z
    .array(z.number().int().positive())
    .min(1, 'At least one session ID is required')
    .max(50, 'Cannot analyze more than 50 sessions at once'),
  prompt: z
    .string()
    .min(10, 'Prompt must be at least 10 characters')
    .max(5000, 'Prompt too long'),
  modelName: z.string().optional(),
  useAdvancedStrategy: z.boolean().optional(),
});

export type AnalysisRequest = z.infer<typeof analysisRequestSchema>;
