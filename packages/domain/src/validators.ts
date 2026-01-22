import { chatRequestSchema } from './schemas/api/chatRequest.js';
import { analysisRequestSchema } from './schemas/api/analysisRequest.js';
import { renameChatRequestSchema } from './schemas/api/renameChatRequest.js';
import { transcriptionRequestSchema } from './schemas/api/transcriptionRequest.js';
import { transcriptionJobSchema } from './schemas/jobs/transcriptionJob.js';
import { analysisJobPayloadSchema } from './schemas/jobs/analysisJob.js';
import { sessionSchema } from './schemas/db/session.js';
import { messageSchema } from './schemas/db/message.js';
import { transcriptSchema } from './schemas/db/transcript.js';
import { chatSchema } from './schemas/db/chat.js';
import { analysisJobSchema as analysisJobRowSchema } from './schemas/db/analysisJob.js';
import { intermediateSummarySchema } from './schemas/db/intermediateSummary.js';

export const validateChatRequest = chatRequestSchema.parse;
export const safeValidateChatRequest = chatRequestSchema.safeParse;

export const validateAnalysisRequest = analysisRequestSchema.parse;
export const safeValidateAnalysisRequest = analysisRequestSchema.safeParse;

export const validateRenameChatRequest = renameChatRequestSchema.parse;
export const safeValidateRenameChatRequest = renameChatRequestSchema.safeParse;

export const validateTranscriptionRequest = transcriptionRequestSchema.parse;
export const safeValidateTranscriptionRequest =
  transcriptionRequestSchema.safeParse;

export const validateTranscriptionJob = transcriptionJobSchema.parse;
export const safeValidateTranscriptionJob = transcriptionJobSchema.safeParse;

export const validateAnalysisJob = analysisJobPayloadSchema.parse;
export const safeValidateAnalysisJob = analysisJobPayloadSchema.safeParse;

export const validateSessionRow = sessionSchema.parse;
export const safeValidateSessionRow = sessionSchema.safeParse;

export const validateMessageRow = messageSchema.parse;
export const safeValidateMessageRow = messageSchema.safeParse;

export const validateTranscriptRow = transcriptSchema.parse;
export const safeValidateTranscriptRow = transcriptSchema.safeParse;

export const validateChatRow = chatSchema.parse;
export const safeValidateChatRow = chatSchema.safeParse;

export const validateAnalysisJobRow = analysisJobRowSchema.parse;
export const safeValidateAnalysisJobRow = analysisJobRowSchema.safeParse;

export const validateIntermediateSummaryRow = intermediateSummarySchema.parse;
export const safeValidateIntermediateSummaryRow =
  intermediateSummarySchema.safeParse;
