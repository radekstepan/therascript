// @vitest-environment jsdom
// packages/ui/src/api/verification.test.ts
//
// Covers the chat-scoped coverage helpers behind the session chat
// header's passive verified-status icon: backend eligibility mirroring
// (`VERIFIABLE_AI_MESSAGE_FILTER`) and per-chat rollups.
import { describe, it, expect } from 'vitest';
import {
  isVerifiableChatAiMessage,
  summarizeChatVerifications,
  type MessageVerification,
} from './verification';
import type { ChatMessage } from '../types';

const user = (id: number, text = 'What did the patient say?'): ChatMessage => ({
  id,
  chatId: 5,
  sender: 'user',
  text,
  timestamp: id,
});

const ai = (
  id: number,
  text: string,
  extra?: Partial<ChatMessage>
): ChatMessage => ({
  id,
  chatId: 5,
  sender: 'ai',
  text,
  timestamp: id,
  completionTokens: 10,
  ...extra,
});

const WELCOME_TEXT =
  'Session "Intake" has been transcribed and is ready for analysis.';

const verification = (
  messageId: number,
  overrides?: Partial<MessageVerification>
): MessageVerification => ({
  id: messageId * 10,
  message_id: messageId,
  chat_id: 5,
  session_id: 1,
  verification_job_id: 7,
  authored_model: 'llama',
  judge_model: 'judge-1',
  status: 'completed',
  total_claims: 2,
  supported_claims: 2,
  partial_claims: 0,
  contradicted_claims: 0,
  fabricated_claims: 0,
  omissions_count: 0,
  accuracy_score: 1,
  summary_assessment: null,
  prompt_tokens: null,
  completion_tokens: null,
  duration_ms: null,
  verified_at: 1,
  error_message: null,
  ...overrides,
});

describe('isVerifiableChatAiMessage', () => {
  it('excludes therapist/user messages', () => {
    const messages = [user(1), ai(2, 'An answer.')];
    expect(isVerifiableChatAiMessage(messages[0]!, messages)).toBe(false);
  });

  it('includes an AI note answering a preceding user message', () => {
    const messages = [user(1), ai(2, 'An answer.')];
    expect(isVerifiableChatAiMessage(messages[1]!, messages)).toBe(true);
  });

  it('excludes persisted AI messages with empty text', () => {
    const messages = [user(1), ai(2, '   ')];
    expect(isVerifiableChatAiMessage(messages[1]!, messages)).toBe(false);
  });

  it('excludes the automatic welcome message', () => {
    const welcome = ai(1, WELCOME_TEXT, { completionTokens: null });
    expect(isVerifiableChatAiMessage(welcome, [welcome])).toBe(false);
  });

  it('excludes AI notes with no preceding user message', () => {
    const messages = [ai(1, 'A note with no prompt.')];
    expect(isVerifiableChatAiMessage(messages[0]!, messages)).toBe(false);
  });

  it('counts optimistic (streaming) AI notes even before text arrives', () => {
    const tempUser: ChatMessage = { ...user(-9), id: -9 };
    const tempAi: ChatMessage = { ...ai(-7, ''), id: -7 };
    const messages = [user(1), ai(2, 'Done.'), tempUser, tempAi];
    expect(isVerifiableChatAiMessage(tempAi, messages)).toBe(true);
  });

  it('does not exclude trivial conversational greetings', () => {
    // The worker fast-paths greetings to a `completed` row, so they are
    // eligible and count as checked once audited.
    const messages = [user(1), ai(2, 'Hello! How can I help you today?')];
    expect(isVerifiableChatAiMessage(messages[1]!, messages)).toBe(true);
  });

  it('still counts welcome-shaped text from a real generation', () => {
    // Backend excludes only NULL-completionTokens rows matching the pattern.
    const messages = [user(1), ai(2, WELCOME_TEXT)];
    expect(isVerifiableChatAiMessage(messages[1]!, messages)).toBe(true);
  });
});

describe('summarizeChatVerifications', () => {
  it('marks fully checked chats verified, including flagged completions', () => {
    const messages = [
      user(1),
      ai(2, 'The patient takes aspirin.'),
      user(3),
      ai(4, 'They mentioned sleep issues.'),
    ];
    const summary = summarizeChatVerifications(messages, [
      verification(2),
      verification(4, {
        total_claims: 2,
        supported_claims: 1,
        fabricated_claims: 1,
        accuracy_score: 0.5,
      }),
    ]);
    expect(summary.eligibleMessageIds).toEqual([2, 4]);
    expect(summary.checkedMessageIds).toEqual([2, 4]);
    expect(summary.failedMessageIds).toEqual([]);
    expect(summary.uncheckedMessageIds).toEqual([]);
    expect(summary.allVerified).toBe(true);
    expect(summary.totalClaims).toBe(4);
    expect(summary.supportedClaims).toBe(3);
    expect(summary.fabricatedClaims).toBe(1);
    // Pooled: (3 + 0.5 * 0) / 4 * 100.
    expect(summary.accuracyPercent).toBeCloseTo(75, 5);
  });

  it('marks partially checked chats unverified', () => {
    const messages = [user(1), ai(2, 'First.'), user(3), ai(4, 'Second.')];
    const summary = summarizeChatVerifications(messages, [verification(2)]);
    expect(summary.allVerified).toBe(false);
    expect(summary.checkedMessageIds).toEqual([2]);
    expect(summary.uncheckedMessageIds).toEqual([4]);
  });

  it('marks chats with failed assessments unverified', () => {
    const messages = [user(1), ai(2, 'An answer.')];
    const summary = summarizeChatVerifications(messages, [
      verification(2, { status: 'failed', error_message: 'Judge blew up' }),
    ]);
    expect(summary.allVerified).toBe(false);
    expect(summary.failedMessageIds).toEqual([2]);
    // Failed rows contribute no claim totals.
    expect(summary.totalClaims).toBe(0);
    expect(summary.accuracyPercent).toBeNull();
  });

  it('treats skipped assessments as unchecked, not checked', () => {
    const messages = [user(1), ai(2, 'An answer.')];
    const summary = summarizeChatVerifications(messages, [
      verification(2, { status: 'skipped' }),
    ]);
    expect(summary.allVerified).toBe(false);
    expect(summary.uncheckedMessageIds).toEqual([2]);
    expect(summary.failedMessageIds).toEqual([]);
  });

  it('never reports empty chats as verified', () => {
    const summary = summarizeChatVerifications([], []);
    expect(summary.allVerified).toBe(false);
    expect(summary.accuracyPercent).toBeNull();
  });

  it('never reports chats with no eligible AI notes as verified', () => {
    const welcome = ai(1, WELCOME_TEXT, { completionTokens: null });
    const messages = [welcome, user(2)];
    const summary = summarizeChatVerifications(messages, []);
    expect(summary.eligibleMessageIds).toEqual([]);
    expect(summary.allVerified).toBe(false);
  });

  it('reports unknown accuracy when only claim-less checks exist', () => {
    const messages = [user(1), ai(2, 'Hello! How can I help?')];
    const summary = summarizeChatVerifications(messages, [
      verification(2, {
        total_claims: 0,
        supported_claims: 0,
        omissions_count: 0,
        accuracy_score: 1,
      }),
    ]);
    expect(summary.allVerified).toBe(true);
    // Unknown — callers label it; never a numeric zero.
    expect(summary.accuracyPercent).toBeNull();
  });

  it('weights partial claims and omissions like the worker', () => {
    const messages = [user(1), ai(2, 'Mixed.')];
    const summary = summarizeChatVerifications(messages, [
      verification(2, {
        total_claims: 4,
        supported_claims: 2,
        partial_claims: 1,
        contradicted_claims: 1,
        fabricated_claims: 0,
        omissions_count: 1,
        accuracy_score: 0.5,
      }),
    ]);
    // (2 + 0.5 * 1) / (4 + 1) * 100 = 50.
    expect(summary.accuracyPercent).toBeCloseTo(50, 5);
    expect(summary.omissionsCount).toBe(1);
    expect(summary.contradictedClaims).toBe(1);
  });

  it('ignores user messages and verifications for other messages', () => {
    const messages = [user(1), ai(2, 'Answer.')];
    const summary = summarizeChatVerifications(messages, [
      verification(2),
      verification(999, { status: 'failed' }),
    ]);
    expect(summary.allVerified).toBe(true);
    expect(summary.failedMessageIds).toEqual([]);
  });
});
