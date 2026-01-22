import { ConnectionOptions } from 'bullmq';
import { Redis } from 'ioredis';
import config from '@therascript/config';

export const redisConnection: ConnectionOptions = {
  host: config.redis.host,
  port: config.redis.port,
  maxRetriesPerRequest: null,
};

export function createRedisClient(): Redis {
  return new Redis({
    host: config.redis.host,
    port: config.redis.port,
  });
}
