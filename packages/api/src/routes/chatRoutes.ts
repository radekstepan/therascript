// packages/api/src/routes/chatRoutes.ts
import { Elysia, t, type Static, type Cookie } from 'elysia';
import {
  chatRepository,
  messageRepository,
  sessionRepository,
} from '@therascript/data';
import {
  createSessionChat,
  addSessionChatMessage,
  renameSessionChat,
  deleteSessionChat,
  getSessionChatDetails,
} from '../api/sessionChatHandler.js';
import { NotFoundError, BadRequestError, ApiError } from '../errors.js';
import type {
  BackendChatSession,
  BackendChatMessage,
  ChatMetadata,
  BackendSession,
} from '@therascript/domain'; // Added BackendChatSession
import { computeContextUsageForChat } from '../services/contextUsageService.js';
import {
  getChatVerificationsHandler,
  verifySingleChatHandler,
} from '../api/verificationHandler.js';

// --- Schemas ---
const SessionIdParamSchema = t.Object({
  sessionId: t.String({
    pattern: '^[0-9]+$',
    error: 'Session ID must be a positive number',
  }),
});

const ChatIdParamSchema = t.Object({
  chatId: t.String({
    pattern: '^[0-9]+$',
    error: 'Chat ID must be a positive number',
  }),
});

const SessionAndChatParamsSchema = t.Intersect([
  SessionIdParamSchema,
  ChatIdParamSchema,
]);

const ChatMessageBodySchema = t.Object({
  text: t.String({ minLength: 1, error: 'Message text cannot be empty' }),
});

const ChatRenameBodySchema = t.Object({
  name: t.Optional(t.Union([t.String({ minLength: 1 }), t.Null()])),
});

const SessionChatMetadataResponseSchema = t.Object({
  id: t.Number(),
  sessionId: t.Number(),
  timestamp: t.Number(),
  name: t.Optional(t.Union([t.String(), t.Null()])),
});

const ChatMessageResponseSchema = t.Object({
  id: t.Number(),
  chatId: t.Number(),
  sender: t.Union([t.Literal('user'), t.Literal('ai'), t.Literal('system')]), // <-- THE FIX IS HERE
  text: t.String(),
  timestamp: t.Number(),
  promptTokens: t.Optional(t.Union([t.Number(), t.Null()])),
  completionTokens: t.Optional(t.Union([t.Number(), t.Null()])),
  duration: t.Optional(t.Union([t.Number(), t.Null()])),
  isTruncated: t.Optional(t.Union([t.Boolean(), t.Null()])),
  model: t.Optional(t.Union([t.String(), t.Null()])),
});

const FullSessionChatResponseSchema = t.Object({
  id: t.Number(),
  sessionId: t.Number(),
  timestamp: t.Number(),
  name: t.Optional(t.Union([t.String(), t.Null()])),
  messages: t.Array(ChatMessageResponseSchema),
});

const DeleteChatResponseSchema = t.Object({ message: t.String() });

// --- Verification Schemas ---
const ChatTranscriptEvidenceItemSchema = t.Object({
  paragraphIndex: t.Union([t.Number(), t.Null()]),
  timestampMs: t.Union([t.Number(), t.Null()]),
  speaker: t.Union([t.String(), t.Null()]),
  quote: t.String(),
});

const ChatVerifiedStatementSchema = t.Object({
  id: t.Number(),
  message_verification_id: t.Number(),
  message_id: t.Number(),
  session_id: t.Number(),
  statement_index: t.Number(),
  kind: t.Union([t.Literal('claim'), t.Literal('omission')]),
  exact_quote: t.String(),
  normalized_claim: t.String(),
  start_char: t.Union([t.Number(), t.Null()]),
  end_char: t.Union([t.Number(), t.Null()]),
  verdict: t.Union([
    t.Literal('supported'),
    t.Literal('partially_supported'),
    t.Literal('contradicted'),
    t.Literal('fabricated'),
    t.Literal('omission'),
  ]),
  severity: t.Union([
    t.Literal('none'),
    t.Literal('low'),
    t.Literal('medium'),
    t.Literal('high'),
    t.Literal('critical'),
  ]),
  confidence: t.Number(),
  reasoning: t.String(),
  transcript_evidence_json: t.Union([t.String(), t.Null()]),
  evidence: t.Optional(t.Array(ChatTranscriptEvidenceItemSchema)),
  created_at: t.Number(),
  review_status: t.Union([t.Literal('unreviewed'), t.Literal('confirmed')]),
  confirmed_at: t.Union([t.Number(), t.Null()]),
  review_id: t.Union([t.Number(), t.Null()]),
  review_token: t.Union([t.String(), t.Null()]),
});

const ChatMessageVerificationSchema = t.Object({
  id: t.Number(),
  message_id: t.Number(),
  chat_id: t.Number(),
  session_id: t.Number(),
  verification_job_id: t.Union([t.Number(), t.Null()]),
  authored_model: t.Union([t.String(), t.Null()]),
  judge_model: t.String(),
  status: t.Union([
    t.Literal('completed'),
    t.Literal('failed'),
    t.Literal('skipped'),
  ]),
  total_claims: t.Number(),
  supported_claims: t.Number(),
  partial_claims: t.Number(),
  contradicted_claims: t.Number(),
  fabricated_claims: t.Number(),
  omissions_count: t.Number(),
  accuracy_score: t.Number(),
  summary_assessment: t.Union([t.String(), t.Null()]),
  prompt_tokens: t.Union([t.Number(), t.Null()]),
  completion_tokens: t.Union([t.Number(), t.Null()]),
  duration_ms: t.Union([t.Number(), t.Null()]),
  verified_at: t.Number(),
  error_message: t.Union([t.String(), t.Null()]),
  error_code: t.Optional(t.Union([t.String(), t.Null()])),
  material_revision: t.Optional(t.Union([t.String(), t.Null()])),
  statements: t.Optional(t.Array(ChatVerifiedStatementSchema)),
});

const VerifySingleChatBodySchema = t.Object({
  skipVerified: t.Optional(t.Boolean()),
  modelName: t.Optional(t.String({ minLength: 1 })),
  contextSize: t.Optional(t.Union([t.Number({ minimum: 1 }), t.Null()])),
  thinkingBudget: t.Optional(t.Union([t.Number(), t.Null()])),
  temperature: t.Optional(t.Number({ minimum: 0, maximum: 2 })),
  topP: t.Optional(t.Number({ minimum: 0, maximum: 1 })),
  repeatPenalty: t.Optional(t.Number({ minimum: 0.5, maximum: 2 })),
  numGpuLayers: t.Optional(t.Union([t.Number({ minimum: 0 }), t.Null()])),
  baseUrl: t.Optional(t.String({ maxLength: 2048 })),
});

// --- NEW: Context Usage Schemas ---
const NullableNumber = t.Union([t.Number(), t.Null()]);
const ContextUsageResponseSchema = t.Object({
  model: t.Object({
    name: t.String(),
    configuredContextSize: t.Optional(NullableNumber),
    defaultContextSize: t.Optional(NullableNumber),
    effectiveContextSize: t.Optional(NullableNumber),
  }),
  breakdown: t.Object({
    systemTokens: NullableNumber,
    transcriptTokens: NullableNumber,
    chatHistoryTokens: NullableNumber,
    inputDraftTokens: NullableNumber,
  }),
  reserved: t.Object({ outputTokens: t.Number() }),
  totals: t.Object({
    promptTokens: NullableNumber,
    percentUsed: NullableNumber,
    remainingForPrompt: NullableNumber,
    remainingForOutput: NullableNumber,
  }),
  thresholds: t.Object({ warnAt: t.Number(), dangerAt: t.Number() }),
});

export const chatRoutes = new Elysia({
  prefix: '/api/sessions/:sessionId/chats',
})
  .model({
    sessionIdParam: SessionIdParamSchema,
    chatIdParam: ChatIdParamSchema,
    sessionAndChatParams: SessionAndChatParamsSchema,
    chatMessageBody: ChatMessageBodySchema,
    chatRenameBody: ChatRenameBodySchema,
    sessionChatMetadataResponse: SessionChatMetadataResponseSchema,
    chatMessageResponse: ChatMessageResponseSchema,
    fullSessionChatResponse: FullSessionChatResponseSchema,
    deleteChatResponse: DeleteChatResponseSchema,
    contextUsageResponse: ContextUsageResponseSchema,
    chatMessageVerification: ChatMessageVerificationSchema,
    verifySingleChatBody: VerifySingleChatBodySchema,
  })
  .guard(
    { params: 'sessionIdParam' }, // Ensures params.sessionId is a string and matches pattern
    (app) =>
      app
        // Derive sessionData for all routes within this guard
        .derive((context) => {
          // Elysia infers context type
          const { params } = context;
          // params.sessionId is guaranteed to be a string by the guard's schema
          const sessionIdNum = parseInt(params.sessionId!, 10);
          if (isNaN(sessionIdNum)) {
            // This case should technically be caught by the param schema regex, but defense in depth
            throw new BadRequestError('Invalid session ID format in path.');
          }
          const session = sessionRepository.findById(sessionIdNum);
          if (!session) {
            throw new NotFoundError(`Session with ID ${sessionIdNum}`);
          }
          return { sessionData: session }; // Adds sessionData to the context
        })
        .group(
          '', // No additional prefix for this group
          { detail: { tags: ['Chat'] } },
          (app) =>
            app
              .post('/', (context) => createSessionChat(context as any), {
                // Using 'as any' for context, relying on Elysia's inference
                response: { 201: 'sessionChatMetadataResponse' },
                detail: { summary: 'Create a new chat within a session' },
              })
              .guard(
                { params: 'sessionAndChatParams' }, // Ensures params.sessionId and params.chatId are strings
                (app) =>
                  app
                    .derive((context) => {
                      // Elysia infers context
                      const { params, sessionData } = context; // sessionData comes from the outer derive
                      const chatIdNum = parseInt(params.chatId!, 10);
                      if (isNaN(chatIdNum)) {
                        throw new BadRequestError(
                          'Invalid chat ID format in path.'
                        );
                      }
                      const chat = chatRepository.findChatById(chatIdNum);
                      if (!chat || chat.sessionId !== sessionData.id) {
                        throw new NotFoundError(
                          `Chat ${chatIdNum} not found in session ${sessionData.id}`
                        );
                      }
                      return { chatData: chat }; // Adds chatData to the context
                    })
                    .get(
                      '/:chatId',
                      (context) => getSessionChatDetails(context as any),
                      {
                        response: { 200: 'fullSessionChatResponse' },
                        detail: {
                          summary:
                            'Get full details for a specific session chat',
                        },
                      }
                    )
                    .get(
                      '/:chatId/context-usage',
                      async (context) => {
                        const { chatData, sessionData, query } = context as any;
                        const inputDraft = query?.inputDraft ?? null;
                        const reservedOutputTokens = query?.reservedOutputTokens
                          ? parseInt(String(query.reservedOutputTokens), 10)
                          : undefined;
                        const messages = chatData
                          ? (chatData.messages as BackendChatMessage[])
                          : [];
                        const usage = await computeContextUsageForChat({
                          isStandalone: false,
                          sessionData,
                          messages,
                          inputDraft,
                          reservedOutputTokens,
                        });
                        return usage;
                      },
                      {
                        query: t.Optional(
                          t.Object({
                            inputDraft: t.Optional(t.String()),
                            reservedOutputTokens: t.Optional(t.String()),
                          })
                        ),
                        response: { 200: 'contextUsageResponse' },
                        detail: {
                          summary:
                            'Estimate context usage for this session chat (LM Studio–style)',
                        },
                      }
                    )
                    .post(
                      '/:chatId/messages',
                      (context) => addSessionChatMessage(context as any),
                      {
                        body: 'chatMessageBody',
                        detail: {
                          summary:
                            'Add user message & get AI response for session chat (stream)',
                          produces: ['text/event-stream'],
                        },
                      }
                    )
                    .patch(
                      '/:chatId/name',
                      (context) => renameSessionChat(context as any),
                      {
                        body: 'chatRenameBody',
                        response: { 200: 'sessionChatMetadataResponse' },
                        detail: { summary: 'Rename a session chat' },
                      }
                    )
                    .delete(
                      '/:chatId',
                      (context) => deleteSessionChat(context as any),
                      {
                        response: { 200: 'deleteChatResponse' },
                        detail: {
                          summary: 'Delete a session chat and its messages',
                        },
                      }
                    )
                    .get(
                      '/:chatId/verifications',
                      (context) => getChatVerificationsHandler(context as any),
                      {
                        response: {
                          200: t.Array(ChatMessageVerificationSchema),
                        },
                        detail: {
                          summary:
                            'Get fact-verification verdicts for all AI messages in a chat',
                        },
                      }
                    )
                    .post(
                      '/:chatId/verify',
                      (context) => verifySingleChatHandler(context as any),
                      {
                        body: t.Optional(VerifySingleChatBodySchema),
                        response: { 202: t.Object({ jobId: t.Number() }) },
                        detail: {
                          summary:
                            'Trigger a single-chat fact-verification job',
                        },
                      }
                    )
              ) // End chat-specific guard
        ) // End group for /api/sessions/:sessionId/chats
  ); // End sessionID guard
