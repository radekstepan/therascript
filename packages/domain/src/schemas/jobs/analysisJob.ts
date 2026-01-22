import { z } from 'zod';

export const analysisJobPayloadSchema = z.object({
  jobId: z.number().int().positive(),
});

export type AnalysisJobPayload = z.infer<typeof analysisJobPayloadSchema>;
