import { z } from 'zod';

export const analysisJobSchema = z.object({
  id: z.number().int().positive(),
  original_prompt: z.string(),
  short_prompt: z.string(),
  status: z.enum([
    'pending',
    'generating_strategy',
    'mapping',
    'reducing',
    'completed',
    'failed',
    'canceling',
    'canceled',
  ]),
  final_result: z.string().nullable(),
  error_message: z.string().nullable(),
  created_at: z.number().int().nonnegative(),
  completed_at: z.number().int().nonnegative().nullable(),
  model_name: z.string().nullable(),
  context_size: z.number().int().nonnegative().nullable(),
  strategy_json: z.string().nullable(),
});

export type AnalysisJobRow = z.infer<typeof analysisJobSchema>;
