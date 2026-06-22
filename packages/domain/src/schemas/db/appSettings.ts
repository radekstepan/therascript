import { z } from 'zod';

export const appSettingsSchema = z.object({
  id: z.number().int().positive(),
  llm_base_url: z.string().nullable(),
  llm_model_name: z.string().nullable(),
  llm_context_size: z.number().int().nullable(),
  llm_temperature: z.number(),
  llm_top_p: z.number(),
  llm_repeat_penalty: z.number(),
  llm_num_gpu_layers: z.number().int().nullable(),
  llm_thinking_budget: z.number().int().nullable(),
});

export type AppSettingsRow = z.infer<typeof appSettingsSchema>;
