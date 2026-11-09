// =========================================
// File: packages/api/src/api/metaHandler.ts
// =========================================
import { checkDatabaseHealth, isDbUnlocked } from '@therascript/db';
import { getVaultManager } from '../services/vaultManager.js';
import {
  getElasticsearchClient,
  checkEsHealth,
} from '@therascript/elasticsearch-client';
import { checkLlmApiHealth } from '../services/llamaCppService.js';
import { checkWhisperApiHealth } from '../services/transcriptionService.js';
import config from '@therascript/config';

interface ServiceStatus {
  database: 'connected' | 'disconnected';
  elasticsearch: 'connected' | 'disconnected';
  llm: 'connected' | 'disconnected';
  whisper: 'connected' | 'disconnected';
}

interface MetaHandlerContext {
  set: { status?: number | string };
}

export const getReadinessStatus = async ({ set }: MetaHandlerContext) => {
  // Locked vault: nothing is usable, and every check below would throw
  // against the detached database (the LLM check reads app_settings).
  // Short-circuit quietly instead of spamming the logs on every poll.
  if (getVaultManager().isProtectionActive() && !isDbUnlocked()) {
    set.status = 503;
    return {
      ready: false,
      services: {
        database: 'disconnected',
        elasticsearch: 'disconnected',
        llm: 'disconnected',
        whisper: 'disconnected',
      } as ServiceStatus,
      timestamp: new Date().toISOString(),
    };
  }

  const statuses: ServiceStatus = {
    database: 'disconnected',
    elasticsearch: 'disconnected',
    llm: 'disconnected',
    whisper: 'disconnected',
  };

  // Parallelize checks
  await Promise.allSettled([
    (async () => {
      try {
        checkDatabaseHealth();
        statuses.database = 'connected';
      } catch (e) {
        console.warn('[Readiness] DB check failed.');
      }
    })(),
    (async () => {
      try {
        const esClient = getElasticsearchClient(config.elasticsearch.url);
        if (await checkEsHealth(esClient)) {
          statuses.elasticsearch = 'connected';
        }
      } catch (e) {
        console.warn('[Readiness] ES check failed.');
      }
    })(),
    (async () => {
      if (await checkLlmApiHealth()) {
        statuses.llm = 'connected';
      }
    })(),
    (async () => {
      if (await checkWhisperApiHealth()) {
        statuses.whisper = 'connected';
      }
    })(),
  ]);

  // The system is considered "ready" if the database is connected.
  // Other services are on-demand and their disconnected status should not block the UI.
  const isReady = statuses.database === 'connected';

  set.status = isReady ? 200 : 503;

  return {
    ready: isReady,
    services: statuses,
    timestamp: new Date().toISOString(),
  };
};
