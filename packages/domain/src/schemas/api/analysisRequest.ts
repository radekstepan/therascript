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
  contextSize: z.number().int().positive().optional(),
  mapPhaseSystemPrompt: z
    .string()
    .max(2000, 'Map phase system prompt is too long')
    .optional(),
  /**
   * Optional LM Studio-compatible base URL override for this analysis job.
   * When omitted, the backend's currently active base URL is used. When
   * provided, the worker uses this URL for the Map/Reduce streams so a
   * one-off analysis can target a different machine than the active chat.
   */
  baseUrl: z
    .string()
    .url('baseUrl must be a valid URL')
    .max(2048, 'baseUrl is too long')
    .optional(),
});

export type AnalysisRequest = z.infer<typeof analysisRequestSchema>;
