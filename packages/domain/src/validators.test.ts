import { describe, it, expect } from 'vitest';
import {
  safeValidateChatRequest,
  safeValidateAnalysisRequest,
  safeValidateRenameChatRequest,
  safeValidateTranscriptionJob,
  safeValidateAnalysisJob,
  safeValidateSessionRow,
  safeValidateMessageRow,
  safeValidateTranscriptRow,
  safeValidateChatRow,
  safeValidateAnalysisJobRow,
  safeValidateIntermediateSummaryRow,
} from './validators.js';

describe('API Request Schemas', () => {
  describe('chatRequestSchema', () => {
    it('validates valid chat request', () => {
      const result = safeValidateChatRequest({ text: 'Hello world' });
      expect(result.success).toBe(true);
    });

    it('rejects empty text', () => {
      const result = safeValidateChatRequest({ text: '' });
      expect(result.success).toBe(false);
    });

    it('rejects missing text', () => {
      const result = safeValidateChatRequest({});
      expect(result.success).toBe(false);
    });

    it('rejects text that is too long', () => {
      const result = safeValidateChatRequest({ text: 'a'.repeat(10001) });
      expect(result.success).toBe(false);
    });
  });

  describe('analysisRequestSchema', () => {
    it('validates valid analysis request', () => {
      const result = safeValidateAnalysisRequest({
        sessionIds: [1, 2, 3],
        prompt: 'Analyze the therapy sessions for themes',
      });
      expect(result.success).toBe(true);
    });

    it('validates with optional fields', () => {
      const result = safeValidateAnalysisRequest({
        sessionIds: [1],
        prompt: 'Analyze for patterns',
        modelName: 'llama3',
        useAdvancedStrategy: true,
      });
      expect(result.success).toBe(true);
    });

    it('rejects empty sessionIds', () => {
      const result = safeValidateAnalysisRequest({
        sessionIds: [],
        prompt: 'Analyze the sessions',
      });
      expect(result.success).toBe(false);
    });

    it('rejects prompt that is too short', () => {
      const result = safeValidateAnalysisRequest({
        sessionIds: [1],
        prompt: 'short',
      });
      expect(result.success).toBe(false);
    });

    it('rejects too many sessions', () => {
      const result = safeValidateAnalysisRequest({
        sessionIds: Array.from({ length: 51 }, (_, i) => i + 1),
        prompt: 'Analyze all these sessions',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('renameChatRequestSchema', () => {
    it('validates valid rename request', () => {
      const result = safeValidateRenameChatRequest({
        name: 'My Chat',
        tags: ['therapy', 'anxiety'],
      });
      expect(result.success).toBe(true);
    });

    it('validates with null values', () => {
      const result = safeValidateRenameChatRequest({
        name: null,
        tags: null,
      });
      expect(result.success).toBe(true);
    });

    it('validates empty object', () => {
      const result = safeValidateRenameChatRequest({});
      expect(result.success).toBe(true);
    });

    it('rejects name that is too long', () => {
      const result = safeValidateRenameChatRequest({
        name: 'a'.repeat(201),
      });
      expect(result.success).toBe(false);
    });

    it('rejects too many tags', () => {
      const result = safeValidateRenameChatRequest({
        tags: Array.from({ length: 11 }, (_, i) => `tag${i}`),
      });
      expect(result.success).toBe(false);
    });
  });
});

describe('Job Payload Schemas', () => {
  describe('transcriptionJobSchema', () => {
    it('validates valid transcription job', () => {
      const result = safeValidateTranscriptionJob({ sessionId: 1 });
      expect(result.success).toBe(true);
    });

    it('rejects negative sessionId', () => {
      const result = safeValidateTranscriptionJob({ sessionId: -1 });
      expect(result.success).toBe(false);
    });

    it('rejects non-integer sessionId', () => {
      const result = safeValidateTranscriptionJob({ sessionId: 1.5 });
      expect(result.success).toBe(false);
    });

    it('rejects missing sessionId', () => {
      const result = safeValidateTranscriptionJob({});
      expect(result.success).toBe(false);
    });
  });

  describe('analysisJobPayloadSchema', () => {
    it('validates valid analysis job payload', () => {
      const result = safeValidateAnalysisJob({ jobId: 42 });
      expect(result.success).toBe(true);
    });

    it('rejects zero jobId', () => {
      const result = safeValidateAnalysisJob({ jobId: 0 });
      expect(result.success).toBe(false);
    });

    it('rejects negative jobId', () => {
      const result = safeValidateAnalysisJob({ jobId: -5 });
      expect(result.success).toBe(false);
    });
  });
});

describe('Database Entity Schemas', () => {
  describe('sessionSchema', () => {
    it('validates valid session row', () => {
      const result = safeValidateSessionRow({
        id: 1,
        fileName: 'session_001.mp3',
        clientName: 'John Doe',
        sessionName: 'Initial Consultation',
        date: '2024-01-15',
        sessionType: 'individual',
        therapy: 'CBT',
        audioPath: '/uploads/session_001.mp3',
        status: 'completed',
        whisperJobId: null,
        transcriptTokenCount: 5000,
      });
      expect(result.success).toBe(true);
    });

    it('validates all status values', () => {
      const statuses = [
        'pending',
        'queued',
        'transcribing',
        'completed',
        'failed',
      ];
      for (const status of statuses) {
        const result = safeValidateSessionRow({
          id: 1,
          fileName: 'test.mp3',
          clientName: 'Test',
          sessionName: 'Test Session',
          date: '2024-01-01',
          sessionType: 'individual',
          therapy: 'CBT',
          audioPath: null,
          status,
          whisperJobId: null,
          transcriptTokenCount: null,
        });
        expect(result.success).toBe(true);
      }
    });

    it('rejects invalid status', () => {
      const result = safeValidateSessionRow({
        id: 1,
        fileName: 'test.mp3',
        clientName: 'Test',
        sessionName: 'Test Session',
        date: '2024-01-01',
        sessionType: 'individual',
        therapy: 'CBT',
        audioPath: null,
        status: 'invalid_status',
        whisperJobId: null,
        transcriptTokenCount: null,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('messageSchema', () => {
    it('validates valid message row', () => {
      const result = safeValidateMessageRow({
        id: 1,
        chatId: 10,
        sender: 'user',
        text: 'Hello, how are you?',
        timestamp: Date.now(),
        promptTokens: 50,
        completionTokens: 100,
      });
      expect(result.success).toBe(true);
    });

    it('validates all sender types', () => {
      const senders = ['user', 'ai', 'system'];
      for (const sender of senders) {
        const result = safeValidateMessageRow({
          id: 1,
          chatId: 1,
          sender,
          text: 'Test message',
          timestamp: Date.now(),
          promptTokens: null,
          completionTokens: null,
        });
        expect(result.success).toBe(true);
      }
    });

    it('rejects invalid sender', () => {
      const result = safeValidateMessageRow({
        id: 1,
        chatId: 1,
        sender: 'bot',
        text: 'Test',
        timestamp: Date.now(),
        promptTokens: null,
        completionTokens: null,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('transcriptSchema', () => {
    it('validates valid transcript row', () => {
      const result = safeValidateTranscriptRow({
        id: 1,
        sessionId: 5,
        paragraphIndex: 0,
        timestampMs: 15000,
        text: 'Patient describes feeling anxious.',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('chatSchema', () => {
    it('validates valid chat row', () => {
      const result = safeValidateChatRow({
        id: 1,
        sessionId: null,
        timestamp: Date.now(),
        name: 'My Chat',
        tags: ['therapy', 'notes'],
      });
      expect(result.success).toBe(true);
    });

    it('validates session-linked chat', () => {
      const result = safeValidateChatRow({
        id: 1,
        sessionId: 5,
        timestamp: Date.now(),
        name: null,
        tags: null,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('analysisJobSchema', () => {
    it('validates valid analysis job row', () => {
      const result = safeValidateAnalysisJobRow({
        id: 1,
        original_prompt: 'Analyze anxiety patterns',
        short_prompt: 'Anxiety Analysis',
        status: 'completed',
        final_result: 'The analysis found...',
        error_message: null,
        created_at: Date.now(),
        completed_at: Date.now(),
        model_name: 'llama3',
        context_size: 8192,
        strategy_json: null,
      });
      expect(result.success).toBe(true);
    });

    it('validates all status values', () => {
      const statuses = [
        'pending',
        'generating_strategy',
        'mapping',
        'reducing',
        'completed',
        'failed',
        'canceling',
        'canceled',
      ];
      for (const status of statuses) {
        const result = safeValidateAnalysisJobRow({
          id: 1,
          original_prompt: 'Test',
          short_prompt: 'Test',
          status,
          final_result: null,
          error_message: null,
          created_at: Date.now(),
          completed_at: null,
          model_name: null,
          context_size: null,
          strategy_json: null,
        });
        expect(result.success).toBe(true);
      }
    });
  });

  describe('intermediateSummarySchema', () => {
    it('validates valid intermediate summary row', () => {
      const result = safeValidateIntermediateSummaryRow({
        id: 1,
        analysis_job_id: 5,
        session_id: 10,
        summary_text: 'Summary of session findings...',
        status: 'completed',
        error_message: null,
      });
      expect(result.success).toBe(true);
    });

    it('validates all status values', () => {
      const statuses = ['pending', 'processing', 'completed', 'failed'];
      for (const status of statuses) {
        const result = safeValidateIntermediateSummaryRow({
          id: 1,
          analysis_job_id: 1,
          session_id: 1,
          summary_text: null,
          status,
          error_message: null,
        });
        expect(result.success).toBe(true);
      }
    });
  });
});
