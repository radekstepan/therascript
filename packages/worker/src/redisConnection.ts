// packages/worker/src/redisConnection.ts
import { ConnectionOptions } from 'bullmq';
import config from '@therascript/config';

export const redisConnection: ConnectionOptions = {
  host: config.redis.host,
  port: config.redis.port,
  maxRetriesPerRequest: null,
};
