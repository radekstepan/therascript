// @vitest-environment node
// packages/api/src/api/metaHandler.test.ts
//
// Readiness must short-circuit while the vault is locked: every check
// below touches the detached database (the LLM check reads app_settings),
// so a locked server would spam VaultLockedError on each poll.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockCheckDatabaseHealth,
  mockIsDbUnlocked,
  mockIsProtectionActive,
  mockCheckEsHealth,
  mockCheckLlmApiHealth,
  mockCheckWhisperApiHealth,
} = vi.hoisted(() => ({
  mockCheckDatabaseHealth: vi.fn(),
  mockIsDbUnlocked: vi.fn(),
  mockIsProtectionActive: vi.fn(),
  mockCheckEsHealth: vi.fn(),
  mockCheckLlmApiHealth: vi.fn(),
  mockCheckWhisperApiHealth: vi.fn(),
}));

vi.mock('@therascript/db', () => ({
  checkDatabaseHealth: mockCheckDatabaseHealth,
  isDbUnlocked: mockIsDbUnlocked,
}));

vi.mock('../services/vaultManager.js', () => ({
  getVaultManager: () => ({ isProtectionActive: mockIsProtectionActive }),
}));

vi.mock('@therascript/elasticsearch-client', () => ({
  getElasticsearchClient: vi.fn(() => ({})),
  checkEsHealth: mockCheckEsHealth,
}));

vi.mock('../services/llamaCppService.js', () => ({
  checkLlmApiHealth: mockCheckLlmApiHealth,
}));

vi.mock('../services/transcriptionService.js', () => ({
  checkWhisperApiHealth: mockCheckWhisperApiHealth,
}));

vi.mock('@therascript/config', () => ({
  default: { elasticsearch: { url: 'http://es-test:9200' } },
}));

import { getReadinessStatus } from './metaHandler.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDbUnlocked.mockReturnValue(true);
  mockIsProtectionActive.mockReturnValue(false);
});

describe('getReadinessStatus', () => {
  it('short-circuits to 503 while the vault is locked', async () => {
    mockIsProtectionActive.mockReturnValue(true);
    mockIsDbUnlocked.mockReturnValue(false);
    const set: { status?: number | string } = {};

    const result = await getReadinessStatus({ set } as never);

    expect(set.status).toBe(503);
    expect(result.ready).toBe(false);
    expect(result.services).toEqual({
      database: 'disconnected',
      elasticsearch: 'disconnected',
      llm: 'disconnected',
      whisper: 'disconnected',
    });
    expect(typeof result.timestamp).toBe('string');
    expect(mockCheckDatabaseHealth).not.toHaveBeenCalled();
    expect(mockCheckLlmApiHealth).not.toHaveBeenCalled();
    expect(mockCheckEsHealth).not.toHaveBeenCalled();
    expect(mockCheckWhisperApiHealth).not.toHaveBeenCalled();
  });

  it('runs the full checks when unlocked', async () => {
    mockIsProtectionActive.mockReturnValue(true);
    mockIsDbUnlocked.mockReturnValue(true);
    mockCheckEsHealth.mockResolvedValue(true);
    mockCheckLlmApiHealth.mockResolvedValue(true);
    mockCheckWhisperApiHealth.mockResolvedValue(true);
    const set: { status?: number | string } = {};

    const result = await getReadinessStatus({ set } as never);

    expect(set.status).toBe(200);
    expect(result.ready).toBe(true);
    expect(result.services).toEqual({
      database: 'connected',
      elasticsearch: 'connected',
      llm: 'connected',
      whisper: 'connected',
    });
  });

  it('runs the full checks in legacy fallback mode', async () => {
    mockIsProtectionActive.mockReturnValue(false);
    mockIsDbUnlocked.mockReturnValue(true);
    mockCheckEsHealth.mockResolvedValue(false);
    mockCheckLlmApiHealth.mockResolvedValue(false);
    mockCheckWhisperApiHealth.mockResolvedValue(false);
    const set: { status?: number | string } = {};

    const result = await getReadinessStatus({ set } as never);

    // Only the database gates readiness; auxiliaries stay informative.
    expect(set.status).toBe(200);
    expect(result.ready).toBe(true);
    expect(result.services.database).toBe('connected');
    expect(mockCheckDatabaseHealth).toHaveBeenCalled();
  });
});
