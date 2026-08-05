import { fastify, type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * O `/health/ready` ganhou schema de resposta zod. Schema de saída não é
 * checado pelo typecheck: se o handler mandar um campo fora do formato, a
 * quebra só aparece em runtime como `ResponseSerializationError` (500) — e
 * logo no endpoint que existe para diagnosticar incidente. Daí este teste de
 * rota, cobrindo 200 e 503.
 */

const { checkDatabaseMock, checkRedisMock } = vi.hoisted(() => ({
  checkDatabaseMock: vi.fn<() => Promise<boolean>>(),
  checkRedisMock: vi.fn<() => Promise<RedisHealthShape>>(),
}));

interface RedisHealthShape {
  ok: boolean;
  responds: boolean;
  acceptsWrites: boolean;
  error?: string;
}

vi.mock('../src/config/prisma.js', () => ({ checkDatabase: checkDatabaseMock }));
vi.mock('../src/config/redis.js', () => ({ checkRedis: checkRedisMock }));

import { registerHealthRoutes } from '../src/modules/health/health.routes.js';

let app: FastifyInstance;

beforeEach(async () => {
  checkDatabaseMock.mockReset().mockResolvedValue(true);
  checkRedisMock.mockReset().mockResolvedValue({ ok: true, responds: true, acceptsWrites: true });

  // Mesmos compilers do app.ts — é o serializer que valida a resposta.
  app = fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerHealthRoutes(app);
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe('GET /health (liveness)', () => {
  it('responde 200 sem tocar em banco nem Redis', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ status: string }>().status).toBe('ok');
    // É este o endpoint do healthcheck do Railway: ele NÃO pode gastar cota do
    // Redis, senão uma cota estourada derruba o deploy inteiro da API.
    expect(checkRedisMock).not.toHaveBeenCalled();
    expect(checkDatabaseMock).not.toHaveBeenCalled();
  });
});

describe('GET /health/ready', () => {
  it('tudo no ar: 200 ready, sem campo error', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      status: string;
      checks: { database: boolean; redis: boolean };
      redis: RedisHealthShape;
      timestamp: string;
    }>();
    expect(body.status).toBe('ready');
    expect(body.checks).toEqual({ database: true, redis: true });
    // `error` ausente no caminho feliz — o schema o declara opcional.
    expect(body.redis).toEqual({ responds: true, acceptsWrites: true });
    expect(typeof body.timestamp).toBe('string');
  });

  it('Redis responde mas recusa escrita: 503 degraded com a causa', async () => {
    checkRedisMock.mockResolvedValue({
      ok: false,
      responds: true,
      acceptsWrites: false,
      error: 'ERR max requests limit exceeded. Limit: 500000, Usage: 500000',
    });

    const res = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(res.statusCode).toBe(503);
    const body = res.json<{
      status: string;
      checks: { database: boolean; redis: boolean };
      redis: RedisHealthShape;
    }>();
    expect(body.status).toBe('degraded');
    expect(body.checks).toEqual({ database: true, redis: false });
    expect(body.redis.responds).toBe(true);
    expect(body.redis.acceptsWrites).toBe(false);
    expect(body.redis.error).toContain('max requests limit exceeded');
  });

  it('banco fora do ar: 503 mesmo com o Redis saudável', async () => {
    checkDatabaseMock.mockResolvedValue(false);

    const res = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(res.statusCode).toBe(503);
    expect(res.json<{ checks: { database: boolean } }>().checks.database).toBe(false);
  });
});
