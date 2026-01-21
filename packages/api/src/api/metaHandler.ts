// =========================================
// File: packages/api/src/api/metaHandler.ts
// =========================================
import { checkDatabaseHealth } from '@therascript/db';
import {
  getElasticsearchClient,
  checkEsHealth,
} from '@therascript/elasticsearch-client';
import { checkOllamaApiHealth } from '../services/ollamaService.js';
import { checkWhisperApiHealth } from '../services/transcriptionService.js';
import config from '@therascript/config';

interface ServiceStatus {
  database: 'connected' | 'disconnected';
  elasticsearch: 'connected' | 'disconnected';
  ollama: 'connected' | 'disconnected';
  whisper: 'connected' | 'disconnected';
}

export const getReadinessStatus = async ({ set }: any) => {
  const statuses: ServiceStatus = {
    database: 'disconnected',
    elasticsearch: 'disconnected',
    ollama: 'disconnected',
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
      if (await checkOllamaApiHealth()) {
        statuses.ollama = 'connected';
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
