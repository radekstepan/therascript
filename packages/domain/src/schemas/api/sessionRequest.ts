import { z } from 'zod';

export const updateSessionRequestSchema = z.object({
  clientName: z.string().min(1).optional(),
  sessionName: z.string().min(1).optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
    .optional(),
  sessionType: z.string().min(1).optional(),
  therapy: z.string().min(1).optional(),
  fileName: z.string().optional(),
  audioPath: z.string().nullable().optional(),
});

export const updateTranscriptParagraphRequestSchema = z.object({
  paragraphIndex: z.number().int().nonnegative(),
  newText: z.string().min(1, 'Text cannot be empty'),
});

export type UpdateSessionRequest = z.infer<typeof updateSessionRequestSchema>;
export type UpdateTranscriptParagraphRequest = z.infer<
  typeof updateTranscriptParagraphRequestSchema
>;
