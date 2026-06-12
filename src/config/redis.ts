import { Redis, type RedisOptions } from 'ioredis';
import { env } from './env.js';
import { logger } from './logger.js';

// Opções compartilhadas. `maxRetriesPerRequest: null` é exigência do BullMQ.
const baseOptions: RedisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  lazyConnect: true,
};

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
};

export const redis = globalForRedis.redis ?? new Redis(env.REDIS_URL, baseOptions);

// Sem listener, um 'error' não tratado derruba o processo.
redis.on('error', (err: Error) => {
  logger.debug({ err }, 'redis connection error');
});

if (env.NODE_ENV !== 'production') {
  globalForRedis.redis = redis;
}

/**
 * Opções de conexão (objeto puro) para o BullMQ.
 * Passamos opções em vez de uma instância Redis porque o BullMQ traz a sua
 * própria cópia do ioredis — instâncias entre as duas cópias não são
 * estruturalmente compatíveis, mas um objeto de opções é.
 */
export function redisConnectionOptions(): {
  host: string;
  port: number;
  username?: string;
  password?: string;
  tls?: Record<string, never>;
  maxRetriesPerRequest: null;
} {
  const url = new URL(env.REDIS_URL);
  const isTls = url.protocol === 'rediss:';
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    ...(isTls ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  };
}

/** Cria uma conexão dedicada (workers BullMQ pedem conexões separadas). */
export function createRedisConnection(): Redis {
  const connection = new Redis(env.REDIS_URL, baseOptions);
  connection.on('error', (err: Error) => {
    logger.debug({ err }, 'redis connection error');
  });
  return connection;
}

export async function disconnectRedis(): Promise<void> {
  await redis.quit();
}

/** Ping com timeout curto para o health check. */
export async function checkRedis(timeoutMs = 1000): Promise<boolean> {
  try {
    const pong = await Promise.race([
      redis.ping(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('redis ping timeout')), timeoutMs),
      ),
    ]);
    return pong === 'PONG';
  } catch {
    return false;
  }
}
