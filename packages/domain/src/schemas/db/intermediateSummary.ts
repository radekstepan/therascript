import { z } from 'zod';

export const intermediateSummarySchema = z.object({
  id: z.number().int().positive(),
  analysis_job_id: z.number().int().positive(),
  session_id: z.number().int().positive(),
  summary_text: z.string().nullable(),
  status: z.enum(['pending', 'processing', 'completed', 'failed']),
  error_message: z.string().nullable(),
});

export type IntermediateSummaryRow = z.infer<typeof intermediateSummarySchema>;
