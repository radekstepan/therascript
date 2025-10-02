// packages/worker/src/redisConnection.ts
import { ConnectionOptions } from 'bullmq';
import config from './config/index.js';

export const redisConnection: ConnectionOptions = {
  host: config.redis.host,
  port: config.redis.port,
  maxRetriesPerRequest: null,
};
